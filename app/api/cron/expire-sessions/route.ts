import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getConfigValue } from "@/lib/config";
import { apiError, expireSession, type Session } from "@/lib/quiz";

export const dynamic = "force-dynamic";

// 방치 세션 주기 정리 (business-rules 3.4). lazy 검사의 보조 장치 —
// 다시 접근하지 않는 이탈 세션도 여기서 확정되어 순위 집계(F3)에 들어간다.
// Vercel Cron 등록(vercel.json)은 T09에서 refresh-rankings와 함께 한다.
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  // I6: 무인증 차단. 시크릿 미설정 시에도 전면 차단(fail-closed)
  if (!secret || auth !== `Bearer ${secret}`) {
    return apiError(401, "UNAUTHENTICATED");
  }

  try {
    const timeoutMin = await getConfigValue("session_timeout_min");
    const cutoffIso = new Date(Date.now() - timeoutMin * 60_000).toISOString();

    const { data: stale, error } = await getDb()
      .from("quiz_session")
      .select(
        "id, participant_id, round_no, status, current_index, total_items, score, last_activity_at"
      )
      .eq("status", "in_progress")
      .lt("last_activity_at", cutoffIso);
    if (error) throw new Error(error.message);

    for (const s of stale ?? []) {
      await expireSession(s as Session);
    }
    return NextResponse.json({ expired: stale?.length ?? 0 });
  } catch (err) {
    console.error(
      "[cron/expire-sessions]",
      err instanceof Error ? err.message : err
    );
    return apiError(500, "INTERNAL");
  }
}
