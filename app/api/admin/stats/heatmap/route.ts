import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminId } from "@/lib/session";
import { fetchAll } from "@/lib/admin";
import { apiError } from "@/lib/quiz";

export const dynamic = "force-dynamic";

// 취약영역 히트맵 (v_heatmap): 소속 × 영역 정답률
export async function GET(req: NextRequest) {
  if (!getAdminId(req)) return apiError(401, "UNAUTHENTICATED");

  try {
    const db = getDb();
    const rows = await fetchAll((from, to) =>
      db
        .from("v_heatmap")
        .select("org_unit_name, category, n, pct")
        .order("org_unit_name")
        .order("category")
        .range(from, to)
    );

    return NextResponse.json(
      rows.map((r) => ({
        orgUnitName: r.org_unit_name,
        category: r.category,
        n: Number(r.n),
        pct: Number(r.pct),
      }))
    );
  } catch (err) {
    console.error("[admin/heatmap]", err instanceof Error ? err.message : err);
    return apiError(500, "INTERNAL");
  }
}
