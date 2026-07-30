import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getConfigValue } from "@/lib/config";
import { getParticipantId } from "@/lib/session";
import { answerLabel, gradeMc4, type ItemType } from "@/lib/grading";
import { apiError, loadSession, parseRoundNo, MSG } from "@/lib/quiz";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  seq: z.number().int().min(0),
  submitted: z.unknown().optional(),
});

type ItemRow = {
  item_type: ItemType;
  stem: string;
  choices: string[] | null;
  answer: unknown;
  explanation: string;
  legal_ref: string | null;
};

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ no: string }> }
) {
  const pid = getParticipantId(req);
  if (!pid) return apiError(401, "UNAUTHENTICATED");

  const { no: noParam } = await ctx.params;
  const no = parseRoundNo(noParam);
  if (no === null) return apiError(404, "NOT_FOUND");

  let body: z.infer<typeof BodySchema>;
  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return apiError(400, "VALIDATION");
    body = parsed.data;
  } catch {
    return apiError(400, "VALIDATION");
  }

  try {
    const session = await loadSession(pid, no);
    if (!session) return apiError(404, "NOT_FOUND");
    if (session.status !== "in_progress") {
      return apiError(409, "ALREADY_COMPLETED", MSG.alreadyCompleted, {
        status: session.status,
      });
    }

    const db = getDb();
    const { data: si, error } = await db
      .from("quiz_session_item")
      .select(
        "id, seq, choice_order, served_at, answered_at, submitted, is_correct, is_timeout, item:item_id(item_type, stem, choices, answer, explanation, legal_ref)"
      )
      .eq("session_id", session.id)
      .eq("seq", body.seq)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!si) return apiError(404, "NOT_FOUND");
    if (!si.served_at) return apiError(400, "VALIDATION");

    const item = si.item as unknown as ItemRow;
    const choiceOrder = si.choice_order as number[] | null;
    const isLast = si.seq === session.total_items - 1;

    // 해설 응답 공통 형태. 정답·해설은 채점이 확정된 뒤에만 이 함수로 나간다 (규칙 2)
    const result = (
      isCorrect: boolean,
      isTimeout: boolean,
      score: number,
      submittedOriginal: number | null
    ) =>
      NextResponse.json({
        isCorrect,
        isTimeout,
        correctAnswerLabel: answerLabel(
          item.item_type,
          item.answer,
          item.choices,
          choiceOrder
        ),
        correctDisplayIndex:
          item.item_type === "MC4" && choiceOrder
            ? choiceOrder.indexOf(item.answer as number)
            : null,
        submittedDisplayIndex:
          item.item_type === "MC4" &&
          choiceOrder &&
          submittedOriginal !== null
            ? choiceOrder.indexOf(submittedOriginal)
            : null,
        explanation: item.explanation,
        legalRef: item.legal_ref,
        score,
        seq: si.seq,
        isLast,
      });

    // 이미 답한 문항이면 기존 결과 반환 — 점수 중복 가산 없음 (E10, 멱등)
    if (si.answered_at !== null || si.is_timeout) {
      return result(
        si.is_correct === true,
        si.is_timeout,
        session.score,
        si.submitted as number | null
      );
    }

    const limitSec = await getConfigValue("item_time_limit_sec");
    const nowMs = Date.now();
    const elapsedMs = nowMs - new Date(si.served_at).getTime();
    const nowIso = new Date(nowMs).toISOString();

    // 서버 판정 시간초과 — 클라이언트가 보낸 경과시간은 쓰지 않는다 (규칙 3, D4·D5)
    if (elapsedMs > limitSec * 1000) {
      const { data: claimed, error: updErr } = await db
        .from("quiz_session_item")
        .update({
          is_timeout: true,
          is_correct: false,
          submitted: null,
          elapsed_ms: elapsedMs,
        })
        .eq("id", si.id)
        .is("answered_at", null)
        .eq("is_timeout", false)
        .select("id");
      if (updErr) throw new Error(updErr.message);
      if (claimed && claimed.length > 0) {
        await finalizeSession(session.id, session.score, isLast, nowIso);
      }
      return result(false, true, session.score, null);
    }

    // T02 범위: MC4만 채점. 나머지 유형은 T03에서 구현한다 (M항)
    if (item.item_type !== "MC4") {
      return apiError(400, "UNSUPPORTED_ITEM_TYPE");
    }
    if (
      typeof body.submitted !== "number" ||
      !Number.isInteger(body.submitted) ||
      !choiceOrder ||
      body.submitted < 0 ||
      body.submitted >= choiceOrder.length
    ) {
      return apiError(400, "VALIDATION");
    }

    // 화면 위치 → choice_order로 원본 인덱스 변환 후 채점. 저장은 원본 인덱스 (E2~E4)
    const { isCorrect, submittedOriginal } = gradeMc4(
      choiceOrder,
      body.submitted,
      item.answer as number
    );

    const { data: claimed, error: updErr } = await db
      .from("quiz_session_item")
      .update({
        answered_at: nowIso,
        submitted: submittedOriginal,
        is_correct: isCorrect,
        is_timeout: false,
        elapsed_ms: elapsedMs,
      })
      .eq("id", si.id)
      .is("answered_at", null)
      .eq("is_timeout", false)
      .select("id");
    if (updErr) throw new Error(updErr.message);

    if (!claimed || claimed.length === 0) {
      // 중복 제출 경합 → 저장된 결과로 응답 (E10)
      const { data: cur } = await db
        .from("quiz_session_item")
        .select("is_correct, is_timeout, submitted")
        .eq("id", si.id)
        .single();
      return result(
        cur?.is_correct === true,
        cur?.is_timeout ?? false,
        session.score,
        (cur?.submitted as number | null) ?? null
      );
    }

    const newScore = session.score + (isCorrect ? 1 : 0);
    await finalizeSession(session.id, newScore, isLast, nowIso);
    return result(isCorrect, false, newScore, submittedOriginal);
  } catch (err) {
    console.error("[rounds/answer]", err instanceof Error ? err.message : err);
    return apiError(500, "INTERNAL");
  }
}

// 12번째 문항 제출 시점에 즉시 완료 처리한다. [결과 보기] 클릭을 기다리지 않는다 (addendum D항)
async function finalizeSession(
  sessionId: string,
  score: number,
  isLast: boolean,
  nowIso: string
) {
  const patch: Record<string, unknown> = {
    score,
    last_activity_at: nowIso,
  };
  if (isLast) {
    patch.status = "completed";
    patch.completed_at = nowIso;
  }
  const { error } = await getDb()
    .from("quiz_session")
    .update(patch)
    .eq("id", sessionId);
  if (error) throw new Error(error.message);
}
