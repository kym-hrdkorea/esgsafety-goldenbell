import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminId } from "@/lib/session";
import { apiError } from "@/lib/quiz";

export const dynamic = "force-dynamic";

// 참여 지표 (v_participation): 회차별 시작·완료·전체 가입자 수
export async function GET(req: NextRequest) {
  if (!getAdminId(req)) return apiError(401, "UNAUTHENTICATED");

  try {
    const { data, error } = await getDb()
      .from("v_participation")
      .select("round_no, started, finished, registered")
      .order("round_no");
    if (error) throw new Error(error.message);

    return NextResponse.json(
      (data ?? []).map((r) => ({
        roundNo: r.round_no,
        started: Number(r.started),
        finished: Number(r.finished),
        registered: Number(r.registered),
      }))
    );
  } catch (err) {
    console.error(
      "[admin/participation]",
      err instanceof Error ? err.message : err
    );
    return apiError(500, "INTERNAL");
  }
}
