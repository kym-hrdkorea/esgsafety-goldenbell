import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getParticipantId } from "@/lib/session";
import { answerLabel, type ItemType } from "@/lib/grading";
import {
  apiError,
  expireIfIdle,
  loadRound,
  loadSession,
  parseRoundNo,
  roundState,
  MSG,
} from "@/lib/quiz";

export const dynamic = "force-dynamic";

type MyResult = "correct" | "wrong" | "timeout";

function myAnswerLabel(
  itemType: ItemType,
  submitted: unknown,
  choices: string[] | null
): string | null {
  // 저장값은 원본 인덱스 공간(E4) — 복습은 원본 순서로 보여주므로 그대로 라벨링한다
  switch (itemType) {
    case "OX":
      return submitted === true ? "O" : "X";
    case "MC4":
      return typeof submitted === "number"
        ? (choices?.[submitted] ?? null)
        : null;
    case "ORDER":
      return Array.isArray(submitted)
        ? (submitted as number[])
            .map((o) => choices?.[o] ?? String(o + 1))
            .join(" → ")
        : null;
    case "SHORT":
      return typeof submitted === "string" ? submitted : null;
  }
}

// 종료 회차 복습: 전체 문항·정답·해설 + 내 결과 (business-rules 2절 복습 모드).
// 문항은 원본 순서(seq_no)·원본 선택지 순서로 보여준다 — 저장값이 원본 공간이라 셔플 불필요.
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
    const round = await loadRound(no);
    if (!round) return apiError(404, "NOT_FOUND");
    if (roundState(round) !== "closed") {
      // 미종료(미개방 포함) 복습 차단 (api-contract)
      return apiError(403, "ROUND_NOT_CLOSED", MSG.notOpen);
    }

    // 마감 직전 시작한 세션(B4)이 아직 진행 중이면 정답 유출 — 복습을 막는다 (규칙 2).
    // 30분 방치면 여기서 만료 확정되어 통과된다.
    let session = await loadSession(pid, no);
    if (session) session = await expireIfIdle(session);
    if (session?.status === "in_progress") {
      return apiError(409, "IN_PROGRESS", MSG.generic, {
        status: session.status,
      });
    }
    const participated = session !== null;

    const db = getDb();
    // ★ measure_code / anchor_code / level은 SELECT 자체를 하지 않는다 (규칙 2-1, I2)
    const { data: items, error } = await db
      .from("quiz_item")
      .select("id, seq_no, item_type, stem, choices, answer, explanation, legal_ref")
      .eq("round_no", no)
      .order("seq_no");
    if (error) throw new Error(error.message);

    const myByItem = new Map<
      number,
      { is_correct: boolean | null; is_timeout: boolean; submitted: unknown }
    >();
    if (session) {
      const { data: rows, error: sErr } = await db
        .from("quiz_session_item")
        .select("item_id, is_correct, is_timeout, submitted")
        .eq("session_id", session.id);
      if (sErr) throw new Error(sErr.message);
      for (const r of rows ?? []) myByItem.set(r.item_id, r);
    }

    return NextResponse.json({
      roundNo: round.round_no,
      theme: round.theme,
      participated,
      items: (items ?? []).map((it, idx) => {
        const itemType = it.item_type as ItemType;
        const choices = it.choices as string[] | null;
        const mine = myByItem.get(it.id);
        const result: MyResult | null = mine
          ? mine.is_timeout
            ? "timeout"
            : mine.is_correct === true
              ? "correct"
              : "wrong"
          : null;
        return {
          no: idx + 1,
          itemType,
          stem: it.stem,
          correctAnswerLabel: answerLabel(itemType, it.answer, choices, null),
          explanation: it.explanation,
          legalRef: it.legal_ref,
          my:
            participated && result
              ? {
                  result,
                  // 내 답은 오답일 때만 병기한다 (design/mocks/복습)
                  myAnswerLabel:
                    result === "wrong"
                      ? myAnswerLabel(itemType, mine!.submitted, choices)
                      : null,
                }
              : null,
        };
      }),
    });
  } catch (err) {
    console.error("[rounds/review]", err instanceof Error ? err.message : err);
    return apiError(500, "INTERNAL");
  }
}
