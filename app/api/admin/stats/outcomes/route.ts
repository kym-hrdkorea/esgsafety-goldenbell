import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminId } from "@/lib/session";
import { apiError } from "@/lib/quiz";

export const dynamic = "force-dynamic";

// 캠페인 핵심 성과 요약.
// 1차 KPI는 사전·사후 M01~M12 12쌍을 모두 확정한 동일인만 포함한다.
// 이 API는 관리자 전용이며 measure/anchor 코드는 참가자 API에 보내지 않는다.

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  if (!getAdminId(req)) return apiError(401, "UNAUTHENTICATED");

  try {
    const db = getDb();
    const [summaryRes, pairsRes, anchorsRes, transfersRes] = await Promise.all([
      db
        .from("v_matched_summary")
        .select(
          "matched_n, pair_count, pre_avg_pct, post_avg_pct, mean_gain_pp, median_gain_pp, improved_n, improved_pct"
        )
        .maybeSingle(),
      db
        .from("v_measure_pair_stats")
        .select(
          "measure_code, pre_item_code, post_item_code, n, pre_pct, post_pct, gain_pp"
        )
        .order("measure_code"),
      db
        .from("v_anchor_trend")
        .select("round_no, anchor_code, n, pct")
        .order("anchor_code")
        .order("round_no"),
      db
        .from("v_transfer_outcome_stats")
        .select("measure_code, item_code, round_no, n, pct")
        .order("measure_code"),
    ]);

    for (const result of [summaryRes, pairsRes, anchorsRes, transfersRes]) {
      if (result.error) throw new Error(result.error.message);
    }

    const s = summaryRes.data;
    return NextResponse.json({
      summary: {
        matchedN: Number(s?.matched_n ?? 0),
        pairCount: Number(s?.pair_count ?? 12),
        preAvgPct: nullableNumber(s?.pre_avg_pct),
        postAvgPct: nullableNumber(s?.post_avg_pct),
        meanGainPp: nullableNumber(s?.mean_gain_pp),
        medianGainPp: nullableNumber(s?.median_gain_pp),
        improvedN: Number(s?.improved_n ?? 0),
        improvedPct: nullableNumber(s?.improved_pct),
      },
      pairs: (pairsRes.data ?? []).map((r) => ({
        measureCode: r.measure_code,
        preItemCode: r.pre_item_code,
        postItemCode: r.post_item_code,
        n: Number(r.n),
        prePct: nullableNumber(r.pre_pct),
        postPct: nullableNumber(r.post_pct),
        gainPp: nullableNumber(r.gain_pp),
      })),
      anchors: (anchorsRes.data ?? []).map((r) => ({
        roundNo: r.round_no,
        anchorCode: r.anchor_code,
        n: Number(r.n),
        pct: nullableNumber(r.pct),
      })),
      transfers: (transfersRes.data ?? []).map((r) => ({
        measureCode: r.measure_code,
        itemCode: r.item_code,
        roundNo: r.round_no,
        n: Number(r.n),
        pct: nullableNumber(r.pct),
      })),
    });
  } catch (err) {
    console.error("[admin/outcomes]", err instanceof Error ? err.message : err);
    return apiError(500, "INTERNAL");
  }
}
