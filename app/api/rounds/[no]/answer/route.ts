import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getConfigValue } from "@/lib/config";
import { getParticipantId } from "@/lib/session";
import {
  calcItemPoints,
  gradeMc4,
  gradeOrder,
  gradeOx,
  gradeShort,
  type ItemType,
} from "@/lib/grading";
import {
  apiError,
  explainExtras,
  loadSession,
  parseRoundNo,
  MSG,
} from "@/lib/quiz";

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
        "id, seq, choice_order, served_at, answered_at, submitted, is_correct, is_timeout, elapsed_ms, item:item_id(item_type, stem, choices, answer, explanation, legal_ref)"
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

    // 운영 파라미터는 전부 app_config에서 (규칙 7)
    const limitSec = await getConfigValue("item_time_limit_sec");
    const basePoints = await getConfigValue("point_base");
    const timeBonusMax = await getConfigValue("point_time_bonus_max");

    // 해설 응답 공통 형태. 정답·해설은 채점이 확정된 뒤에만 이 함수로 나간다 (규칙 2).
    // points는 저장하지 않는 파생값 — is_correct·elapsed_ms에서 매번 계산 (5.0)
    const result = (
      isCorrect: boolean,
      isTimeout: boolean,
      score: number,
      elapsedMs: number,
      submittedStored: unknown
    ) =>
      NextResponse.json({
        isCorrect,
        isTimeout,
        ...explainExtras(
          item.item_type,
          item.answer,
          item.choices,
          choiceOrder,
          submittedStored
        ),
        explanation: item.explanation,
        legalRef: item.legal_ref,
        score,
        points: calcItemPoints({
          isCorrect,
          isTimeout,
          elapsedMs,
          limitSec,
          basePoints,
          timeBonusMax,
        }),
        seq: si.seq,
        isLast,
      });

    // 이미 답한 문항이면 기존 결과 반환 — 점수 중복 가산 없음 (E10, 멱등)
    if (si.answered_at !== null || si.is_timeout) {
      // 부분 실패 자가 복구: 문항은 확정됐는데 세션 점수·완료 갱신이 누락된 경우
      // (finalize 실패 후 재제출) 여기서 재시도한다 (addendum D항 보강)
      let score = session.score;
      if (session.status === "in_progress") {
        score = await finalizeSession(
          session.id,
          isLast,
          new Date().toISOString()
        );
      }
      return result(
        si.is_correct === true,
        si.is_timeout,
        score,
        si.elapsed_ms ?? limitSec * 1000,
        si.submitted
      );
    }

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
      if (!claimed || claimed.length === 0) {
        // 경합 패배: 다른 요청이 이미 확정 — 저장된 결과를 그대로 반환 (E10)
        const { data: cur } = await db
          .from("quiz_session_item")
          .select("is_correct, is_timeout, submitted, elapsed_ms")
          .eq("id", si.id)
          .single();
        return result(
          cur?.is_correct === true,
          cur?.is_timeout ?? false,
          session.score,
          cur?.elapsed_ms ?? elapsedMs,
          cur?.submitted ?? null
        );
      }
      const score = await finalizeSession(session.id, isLast, nowIso);
      return result(false, true, score, elapsedMs, null);
    }

    // 유형별 채점 (business-rules 4절). 저장은 항상 원본 인덱스 공간 (E4)
    let isCorrect: boolean;
    let store: number | boolean | number[] | string;

    if (item.item_type === "MC4") {
      if (
        typeof body.submitted !== "number" ||
        !Number.isInteger(body.submitted) ||
        !choiceOrder ||
        body.submitted < 0 ||
        body.submitted >= choiceOrder.length
      ) {
        return apiError(400, "VALIDATION");
      }
      const g = gradeMc4(choiceOrder, body.submitted, item.answer as number);
      isCorrect = g.isCorrect;
      store = g.submittedOriginal;
    } else if (item.item_type === "OX") {
      if (typeof body.submitted !== "boolean") {
        return apiError(400, "VALIDATION");
      }
      isCorrect = gradeOx(body.submitted, item.answer as boolean);
      store = body.submitted;
    } else if (item.item_type === "ORDER") {
      const s = body.submitted;
      if (
        !Array.isArray(s) ||
        !choiceOrder ||
        s.length !== choiceOrder.length ||
        !s.every(
          (v) =>
            typeof v === "number" &&
            Number.isInteger(v) &&
            v >= 0 &&
            v < choiceOrder.length
        ) ||
        new Set(s).size !== s.length
      ) {
        return apiError(400, "VALIDATION");
      }
      const g = gradeOrder(choiceOrder, s as number[], item.answer as number[]);
      isCorrect = g.isCorrect;
      store = g.submittedOriginal;
    } else {
      // SHORT: 원문 그대로 저장한다 — 관리자 미매칭 검토용 (business-rules 4절)
      if (
        typeof body.submitted !== "string" ||
        body.submitted.trim().length === 0 ||
        body.submitted.length > 100
      ) {
        return apiError(400, "VALIDATION");
      }
      isCorrect = gradeShort(body.submitted, item.answer as string[]);
      store = body.submitted;
    }

    const { data: claimed, error: updErr } = await db
      .from("quiz_session_item")
      .update({
        answered_at: nowIso,
        submitted: store,
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
        .select("is_correct, is_timeout, submitted, elapsed_ms")
        .eq("id", si.id)
        .single();
      return result(
        cur?.is_correct === true,
        cur?.is_timeout ?? false,
        session.score,
        cur?.elapsed_ms ?? elapsedMs,
        cur?.submitted ?? null
      );
    }

    const newScore = await finalizeSession(session.id, isLast, nowIso);
    return result(isCorrect, false, newScore, elapsedMs, store);
  } catch (err) {
    console.error("[rounds/answer]", err instanceof Error ? err.message : err);
    return apiError(500, "INTERNAL");
  }
}

// 12번째 문항 제출 시점에 즉시 완료 처리한다. [결과 보기] 클릭을 기다리지 않는다 (addendum D항).
// 점수는 메모리 증분이 아니라 확정된 문항(is_correct)의 DB 집계로 계산한다 —
// 문항 확정과 세션 갱신 사이의 부분 실패가 있어도 다음 호출에서 자가 복구된다.
async function finalizeSession(
  sessionId: string,
  isLast: boolean,
  nowIso: string
): Promise<number> {
  const db = getDb();
  const { count, error: cntErr } = await db
    .from("quiz_session_item")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .eq("is_correct", true);
  if (cntErr) throw new Error(cntErr.message);
  const score = count ?? 0;

  const patch: Record<string, unknown> = {
    score,
    last_activity_at: nowIso,
  };
  if (isLast) {
    patch.status = "completed";
    patch.completed_at = nowIso;
  }
  const { error } = await db
    .from("quiz_session")
    .update(patch)
    .eq("id", sessionId);
  if (error) throw new Error(error.message);
  return score;
}
