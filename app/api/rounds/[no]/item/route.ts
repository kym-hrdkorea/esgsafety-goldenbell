import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getConfigValue } from "@/lib/config";
import { getParticipantId } from "@/lib/session";
import { calcItemPoints, type ItemType } from "@/lib/grading";
import {
  apiError,
  explainExtras,
  loadSession,
  parseRoundNo,
  MSG,
} from "@/lib/quiz";

export const dynamic = "force-dynamic";

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
    if (session.status !== "in_progress") {
      return apiError(409, "ALREADY_COMPLETED", MSG.alreadyCompleted, {
        status: session.status,
      });
    }

    const db = getDb();
    // ★ measure_code / anchor_code / level은 SELECT 자체를 하지 않는다 (규칙 2-1).
    //   answer·explanation·legal_ref는 서버 메모리로만 가져오고, 응답 포함 여부는
    //   answered_at 상태로 결정한다 (규칙 2, addendum A항).
    const { data: si, error } = await db
      .from("quiz_session_item")
      .select(
        "id, seq, choice_order, served_at, answered_at, submitted, is_correct, is_timeout, elapsed_ms, item:item_id(item_type, stem, choices, answer, explanation, legal_ref)"
      )
      .eq("session_id", session.id)
      .eq("seq", session.current_index)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!si) return apiError(404, "NOT_FOUND");

    const item = si.item as unknown as {
      item_type: ItemType;
      stem: string;
      choices: string[] | null;
      answer: unknown;
      explanation: string;
      legal_ref: string | null;
    };

    // served_at은 최초 서빙 시 1회만 기록. 값이 있으면 절대 갱신하지 않는다 (규칙 3, D1·D2)
    let servedAt = si.served_at as string | null;
    if (!servedAt) {
      const nowIso = new Date().toISOString();
      const { data: claimed, error: updErr } = await db
        .from("quiz_session_item")
        .update({ served_at: nowIso })
        .eq("id", si.id)
        .is("served_at", null)
        .select("served_at");
      if (updErr) throw new Error(updErr.message);
      // 경합 시 이미 기록된 값을 다시 읽는다 — 어느 쪽이든 최초 값 유지
      if (claimed && claimed.length > 0) {
        servedAt = claimed[0].served_at;
      } else {
        const { data: re } = await db
          .from("quiz_session_item")
          .select("served_at")
          .eq("id", si.id)
          .single();
        servedAt = re?.served_at ?? nowIso;
      }
    }

    await db
      .from("quiz_session")
      .update({ last_activity_at: new Date().toISOString() })
      .eq("id", session.id);

    const limitSec = await getConfigValue("item_time_limit_sec");
    const elapsedMs = Date.now() - new Date(servedAt!).getTime();
    const remainingSec = Math.max(0, Math.ceil(limitSec - elapsedMs / 1000));

    const choiceOrder = si.choice_order as number[] | null;
    const displayChoices =
      item.choices && choiceOrder
        ? choiceOrder.map((origIdx) => item.choices![origIdx])
        : item.choices;

    const explained = si.answered_at !== null || si.is_timeout;

    const base = {
      seq: si.seq,
      totalItems: session.total_items,
      itemType: item.item_type,
      stem: item.stem,
      choices: displayChoices,
      remainingSec,
      timeLimitSec: limitSec,
      phase: explained ? "explained" : "answering",
    };

    if (!explained) {
      // 답변 단계: answer·explanation·legalRef 금지 (규칙 2, I1)
      return NextResponse.json(base);
    }

    // 해설 단계: 새로고침 복구를 위해 정답·해설·포인트를 포함한다 (A항, I1-b)
    const basePoints = await getConfigValue("point_base");
    const timeBonusMax = await getConfigValue("point_time_bonus_max");
    return NextResponse.json({
      ...base,
      isCorrect: si.is_correct,
      isTimeout: si.is_timeout,
      ...explainExtras(
        item.item_type,
        item.answer,
        item.choices,
        choiceOrder,
        si.submitted
      ),
      explanation: item.explanation,
      legalRef: item.legal_ref,
      score: session.score,
      points: calcItemPoints({
        isCorrect: si.is_correct === true,
        isTimeout: si.is_timeout,
        elapsedMs: si.elapsed_ms ?? limitSec * 1000,
        limitSec,
        basePoints,
        timeBonusMax,
      }),
      isLast: si.seq === session.total_items - 1,
    });
  } catch (err) {
    console.error("[rounds/item]", err instanceof Error ? err.message : err);
    return apiError(500, "INTERNAL");
  }
}
