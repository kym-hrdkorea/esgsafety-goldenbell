import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getParticipantId } from "@/lib/session";
import { apiError } from "@/lib/quiz";

export const dynamic = "force-dynamic";

// 내 기록 화면 데이터 (T11): 영역별 정답률 + 사전학습 열람 회차.
// ★ category가 NULL인 문항(사전·사후 측정 문항)은 집계에서 제외한다 —
//   별도 묶음으로 노출하면 참가자가 측정 문항군의 존재·규모를 식별할 수 있어
//   규칙 2-1(성과측정 무결성)의 취지에 어긋난다.
export async function GET(req: NextRequest) {
  const pid = getParticipantId(req);
  if (!pid) return apiError(401, "UNAUTHENTICATED");

  try {
    const db = getDb();

    // 확정 세션(completed·expired)의 확정 문항(답변 또는 시간초과)만 집계한다
    const { data: sessions, error: sErr } = await db
      .from("quiz_session")
      .select("id")
      .eq("participant_id", pid)
      .in("status", ["completed", "expired"]);
    if (sErr) throw new Error(sErr.message);

    const categories = new Map<string, { total: number; correct: number }>();
    if (sessions && sessions.length > 0) {
      const { data: items, error: iErr } = await db
        .from("quiz_session_item")
        .select("is_correct, is_timeout, answered_at, item:item_id(category)")
        .in(
          "session_id",
          sessions.map((s) => s.id)
        );
      if (iErr) throw new Error(iErr.message);

      for (const si of items ?? []) {
        const category = (si.item as unknown as { category: string | null })
          .category;
        if (category === null) continue; // 측정 문항 제외
        if (si.answered_at === null && !si.is_timeout) continue; // 미확정 제외
        const agg = categories.get(category) ?? { total: 0, correct: 0 };
        agg.total += 1;
        if (si.is_correct) agg.correct += 1;
        categories.set(category, agg);
      }
    }

    const { data: viewed, error: vErr } = await db
      .from("prelearning_view")
      .select("round_no")
      .eq("participant_id", pid);
    if (vErr) throw new Error(vErr.message);

    return NextResponse.json({
      categories: [...categories.entries()].map(([category, agg]) => ({
        category,
        total: agg.total,
        correct: agg.correct,
        pct: Math.round((agg.correct / agg.total) * 100),
      })),
      prelearningViewed: (viewed ?? []).map((v) => v.round_no),
    });
  } catch (err) {
    console.error("[me/stats]", err instanceof Error ? err.message : err);
    return apiError(500, "INTERNAL");
  }
}
