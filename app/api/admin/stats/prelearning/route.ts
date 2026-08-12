import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminId } from "@/lib/session";
import { apiError } from "@/lib/quiz";

export const dynamic = "force-dynamic";

// 사전학습 열람 효과 (v_prelearning_effect): 퀴즈 시작 전 열람자 vs 미열람자 평균 정답률
export async function GET(req: NextRequest) {
  if (!getAdminId(req)) return apiError(401, "UNAUTHENTICATED");

  try {
    const { data, error } = await getDb()
      .from("v_prelearning_effect")
      .select("round_no, viewed, n, avg_pct")
      .order("round_no")
      .order("viewed");
    if (error) throw new Error(error.message);

    return NextResponse.json(
      (data ?? []).map((r) => ({
        roundNo: r.round_no,
        viewed: Boolean(r.viewed),
        n: Number(r.n),
        avgPct: Number(r.avg_pct),
      }))
    );
  } catch (err) {
    console.error(
      "[admin/prelearning]",
      err instanceof Error ? err.message : err
    );
    return apiError(500, "INTERNAL");
  }
}
