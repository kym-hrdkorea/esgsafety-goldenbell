import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getParticipantId } from "@/lib/session";
import { apiError, expireIfIdle, loadSession, parseRoundNo } from "@/lib/quiz";

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
      return NextResponse.json({
        currentIndex: session.current_index,
        isCompleted: session.status !== "in_progress",
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
