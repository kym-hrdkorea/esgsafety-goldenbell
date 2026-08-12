import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getParticipantId } from "@/lib/session";
import {
  apiError,
  expireIfIdle,
  loadSession,
  parseRoundNo,
  reconcileSession,
} from "@/lib/quiz";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ no: string }> }
) {
  const pid = getParticipantId(req);
  if (!pid) return apiError(401, "UNAUTHENTICATED");

  const { no: noParam } = await ctx.params;
  const no = parseRoundNo(noParam);
  if (no === null) return apiError(404, "NOT_FOUND");

  try {
    let session = await loadSession(pid, no);
    if (!session) return apiError(404, "NOT_FOUND");
    session = await expireIfIdle(session); // 30분 방치 lazy 만료 (business-rules 3.4)

    // 완료는 12번째 answer 시점에 이미 처리됨 — next는 상태를 바꾸지 않는다 (D항, 멱등)
    if (session.status === "completed") {
      // answer 응답 직후 네트워크가 끊겨도 결과 진입 전에 score를 재확정한다.
      session = await reconcileSession(session.id, false);
      return NextResponse.json({
        currentIndex: session.current_index,
        isCompleted: true,
      });
    }
    if (session.status !== "in_progress") {
      return apiError(409, "ALREADY_COMPLETED", undefined, {
        status: session.status,
      });
    }

    const db = getDb();
    const { data: si, error } = await db
      .from("quiz_session_item")
      .select("answered_at, is_timeout")
      .eq("session_id", session.id)
      .eq("seq", session.current_index)
      .maybeSingle();
    if (error) throw new Error(error.message);

    // 현재 문항이 해설 단계(답변 완료 또는 시간초과)여야 넘어갈 수 있다
    if (!si || (si.answered_at === null && !si.is_timeout)) {
      return apiError(400, "VALIDATION");
    }

    const isLastIndex = session.current_index >= session.total_items - 1;
    if (isLastIndex) {
      // 마지막 answer가 item만 확정하고 세션 갱신에 실패한 경우를 복구한다.
      // 함수가 확정 문항 수를 확인하므로 미완료 세션을 성급히 완료하지 않는다.
      session = await reconcileSession(session.id, true);
      return NextResponse.json({
        currentIndex: session.current_index,
        isCompleted: session.status !== "in_progress",
      });
    }

    // 다음 문항으로 이동하기 전 현재까지의 score를 다시 계산한다.
    // 동시에 들어온 답변이 있어도 DB 세션 잠금 순서로 최종값을 보존한다.
    session = await reconcileSession(session.id, false);
    if (session.status !== "in_progress") {
      return NextResponse.json({
        currentIndex: session.current_index,
        isCompleted: true,
      });
    }
    const nextIndex = session.current_index + 1;
    const { error: updErr } = await db
      .from("quiz_session")
      .update({
        current_index: nextIndex,
        last_activity_at: new Date().toISOString(),
      })
      .eq("id", session.id);
    if (updErr) throw new Error(updErr.message);

    return NextResponse.json({ currentIndex: nextIndex, isCompleted: false });
  } catch (err) {
    console.error("[rounds/next]", err instanceof Error ? err.message : err);
    return apiError(500, "INTERNAL");
  }
}
