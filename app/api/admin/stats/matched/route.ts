import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminId } from "@/lib/session";
import { fetchAll } from "@/lib/admin";
import { apiError } from "@/lib/quiz";

export const dynamic = "force-dynamic";

// 동일인 사전·사후 대조 (v_matched_pre_post — 캠페인 핵심 성과지표).
// 화면에는 닉네임만 노출한다(addendum H항). 사번은 CSV export에만 실린다.
export async function GET(req: NextRequest) {
  if (!getAdminId(req)) return apiError(401, "UNAUTHENTICATED");

  try {
    const db = getDb();
    const rows = await fetchAll((from, to) =>
      db
        .from("v_matched_pre_post")
        .select(
          "nickname, org_unit_name, pre_n, post_n, pre_pct, post_pct, gain_pp"
        )
        .order("gain_pp", { ascending: false })
        .range(from, to)
    );

    return NextResponse.json(
      rows.map((r) => ({
        nickname: r.nickname,
        orgUnitName: r.org_unit_name,
        preN: Number(r.pre_n),
        postN: Number(r.post_n),
        prePct: Number(r.pre_pct),
        postPct: Number(r.post_pct),
        gainPp: Number(r.gain_pp),
      }))
    );
  } catch (err) {
    console.error("[admin/matched]", err instanceof Error ? err.message : err);
    return apiError(500, "INTERNAL");
  }
}
