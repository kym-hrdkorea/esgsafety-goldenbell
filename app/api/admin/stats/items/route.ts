import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminId } from "@/lib/session";
import { fetchAll } from "@/lib/admin";
import { apiError } from "@/lib/quiz";

export const dynamic = "force-dynamic";

// 문항 난이도(P)·변별도(D) (v_item_stats).
// measure_code·anchor_code·level은 성과분석 목적의 관리자 전용 데이터다 —
// 참가자 응답 금지(규칙 2-1)와 무관하게 hq_admin 인증 뒤에서만 제공한다.
export async function GET(req: NextRequest) {
  if (!getAdminId(req)) return apiError(401, "UNAUTHENTICATED");

  try {
    const db = getDb();
    const rows = await fetchAll((from, to) =>
      db
        .from("v_item_stats")
        .select(
          "item_code, round_no, level, item_type, category, anchor_code, measure_code, n, p_value, timeout_pct, discrimination"
        )
        .order("round_no")
        .order("item_code")
        .range(from, to)
    );

    return NextResponse.json(
      rows.map((r) => ({
        itemCode: r.item_code,
        roundNo: r.round_no,
        level: r.level,
        itemType: r.item_type,
        category: r.category,
        anchorCode: r.anchor_code,
        measureCode: r.measure_code,
        n: Number(r.n),
        pValue: Number(r.p_value),
        timeoutPct: Number(r.timeout_pct),
        discrimination: Number(r.discrimination),
      }))
    );
  } catch (err) {
    console.error("[admin/items]", err instanceof Error ? err.message : err);
    return apiError(500, "INTERNAL");
  }
}
