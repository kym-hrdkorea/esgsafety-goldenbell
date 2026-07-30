import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getParticipantId } from "@/lib/session";
import { apiError, parseRoundNo } from "@/lib/quiz";

export const dynamic = "force-dynamic";

// 회차별 순위 — ranking_snapshot만 읽는다 (business-rules 5.3, G9).
// payload는 refresh-rankings가 계약 형태 그대로 적재한다:
// [{ rank, nickname, orgUnitName, points, score, pct }]
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
    const { data, error } = await getDb()
      .from("ranking_snapshot")
      .select("payload")
      .eq("kind", "round")
      .eq("round_no", no)
      .maybeSingle();
    if (error) throw new Error(error.message);

    // 아직 확정 세션이 없는 회차는 snapshot 행 자체가 없다 — 빈 목록
    return NextResponse.json(data?.payload ?? []);
  } catch (err) {
    console.error(
      "[dashboard/round]",
      err instanceof Error ? err.message : err
    );
    return apiError(500, "INTERNAL");
  }
}
