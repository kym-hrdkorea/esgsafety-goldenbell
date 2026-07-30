import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getParticipantId } from "@/lib/session";
import { apiError, expireIfIdle, roundState, type Session } from "@/lib/quiz";

export const dynamic = "force-dynamic";

// 회차 목록. 개방 판정(state)은 항상 서버 시각으로 한다 (business-rules 2절, B5)
export async function GET(req: NextRequest) {
  const pid = getParticipantId(req);
  if (!pid) return apiError(401, "UNAUTHENTICATED");

  try {
    const db = getDb();
    const { data: rounds, error } = await db
      .from("quiz_round")
      .select("round_no, season, theme, opens_at, closes_at, is_published")
      .order("round_no");
    if (error) throw new Error(error.message);

    const { data: sessions, error: sErr } = await db
      .from("quiz_session")
      .select(
        "id, participant_id, round_no, status, current_index, total_items, score, last_activity_at"
      )
      .eq("participant_id", pid);
    if (sErr) throw new Error(sErr.message);

    const byRound = new Map<number, Session>();
    for (const s of (sessions ?? []) as Session[]) {
      // 방치 세션은 목록에서도 만료로 확정해 보여준다 (business-rules 3.4 lazy)
      byRound.set(s.round_no, await expireIfIdle(s));
    }

    return NextResponse.json(
      (rounds ?? []).map((r) => {
        const s = byRound.get(r.round_no);
        const done = s?.status === "completed" || s?.status === "expired";
        return {
          roundNo: r.round_no,
          season: r.season,
          theme: r.theme,
          opensAt: r.opens_at,
          closesAt: r.closes_at,
          state: roundState(r),
          myStatus: s?.status ?? "none",
          myScore: done ? s!.score : null,
        };
      })
    );
  } catch (err) {
    console.error("[rounds]", err instanceof Error ? err.message : err);
    return apiError(500, "INTERNAL");
  }
}
