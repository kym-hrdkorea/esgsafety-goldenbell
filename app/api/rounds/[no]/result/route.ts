import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getConfigValue } from "@/lib/config";
import { getParticipantId } from "@/lib/session";
import { answerLabel, calcItemPoints, type ItemType } from "@/lib/grading";
import { apiError, loadSession, parseRoundNo } from "@/lib/quiz";

export const dynamic = "force-dynamic";

type ItemRow = {
  item_code: string;
  item_type: ItemType;
  stem: string;
  choices: string[] | null;
  answer: unknown;
  explanation: string;
};

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ no: string }> }
) {
  const pid = getParticipantId(req);
  if (!pid) return apiError(401, "UNAUTHENTICATED");

  const { no: noParam } = await ctx.params;
  const no = parseRoundNo(noParam);
  if (no === null) return apiError(404, "NOT_FOUND");

  try {
    const session = await loadSession(pid, no);
    if (!session) return apiError(404, "NOT_FOUND");
    if (session.status === "in_progress") {
      // 결과는 완료 후에만 접근 가능 (business-rules 3.5). 클라이언트는 응시 화면으로 되돌린다.
      return apiError(409, "IN_PROGRESS", undefined, { status: session.status });
    }

    const db = getDb();
    // ★ measure_code / anchor_code / level은 SELECT 자체를 하지 않는다 (규칙 2-1)
    const { data: rows, error } = await db
      .from("quiz_session_item")
      .select(
        "seq, choice_order, answered_at, is_correct, is_timeout, elapsed_ms, item:item_id(item_code, item_type, stem, choices, answer, explanation)"
      )
      .eq("session_id", session.id)
      .order("seq");
    if (error) throw new Error(error.message);

    const limitSec = await getConfigValue("item_time_limit_sec");
    const basePoints = await getConfigValue("point_base");
    const timeBonusMax = await getConfigValue("point_time_bonus_max");

    // 회차 포인트 = Σ 문항 포인트. 저장하지 않는 파생값 (business-rules 5.0, N항)
    let points = 0;
    const items = (rows ?? []).map((si) => {
      const item = si.item as unknown as ItemRow;
      // 확정(답변 또는 시간초과)된 문항만 정답·해설을 포함한다 (규칙 2).
      // completed 세션은 전 문항 확정이지만, expired 잔여 문항(T06)을 대비해 문항 단위로 지킨다.
      const confirmed = si.answered_at !== null || si.is_timeout;
      points += calcItemPoints({
        isCorrect: si.is_correct === true,
        isTimeout: si.is_timeout,
        elapsedMs: si.elapsed_ms ?? limitSec * 1000,
        limitSec,
        basePoints,
        timeBonusMax,
      });
      return {
        seq: si.seq,
        itemCode: item.item_code,
        isCorrect: si.is_correct === true,
        isTimeout: si.is_timeout,
        stem: item.stem,
        correctAnswerLabel: confirmed
          ? answerLabel(
              item.item_type,
              item.answer,
              item.choices,
              si.choice_order as number[] | null
            )
          : null,
        explanation: confirmed ? item.explanation : null,
      };
    });

    // 회차 순위: 본인 행 1건만 뷰 직접 조회 허용 (addendum B항). 포인트 기준(N항).
    const { data: rankRow, error: rankErr } = await db
      .from("v_rank_round")
      .select("rank")
      .eq("round_no", no)
      .eq("participant_id", pid)
      .maybeSingle();
    if (rankErr) throw new Error(rankErr.message);

    return NextResponse.json({
      score: session.score,
      totalItems: session.total_items,
      pct: Math.round((session.score / session.total_items) * 1000) / 10,
      points,
      roundRank: rankRow?.rank ?? null,
      items,
    });
  } catch (err) {
    console.error("[rounds/result]", err instanceof Error ? err.message : err);
    return apiError(500, "INTERNAL");
  }
}
