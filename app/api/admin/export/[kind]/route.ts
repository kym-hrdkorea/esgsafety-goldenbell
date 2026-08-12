import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminId } from "@/lib/session";
import { fetchAll, participantMap, toCsv } from "@/lib/admin";
import { apiError } from "@/lib/quiz";

export const dynamic = "force-dynamic";

// CSV 내려받기 (business-rules 7절). UTF-8 BOM 포함 — Excel 한글 깨짐 방지.
// 사번(emp_no)은 포상·행정 대조용으로 CSV에만 포함한다(운영자 확정 결정, T11).
// 관리자 화면 API에는 닉네임만 노출한다(addendum H항).
const KINDS = [
  "answers", // 응답 원본
  "scores", // 회차별 점수·포인트
  "items", // 문항 통계 (P·D)
  "matched", // 동일인 사전·사후 대조
  "outcomes", // 12쌍 완전대응 성과 요약
  "heatmap", // 소속 × 영역 히트맵
  "participation", // 참여 지표
] as const;
type Kind = (typeof KINDS)[number];

async function buildCsv(kind: Kind): Promise<string> {
  const db = getDb();

  switch (kind) {
    case "answers": {
      const pmap = await participantMap();
      const rows = await fetchAll((from, to) =>
        db
          .from("quiz_session_item")
          .select(
            "seq, submitted, is_correct, is_timeout, elapsed_ms, answered_at, session:session_id(round_no, participant_id), item:item_id(item_code, item_type)"
          )
          .order("id")
          .range(from, to)
      );
      return toCsv(
        [
          "사번",
          "닉네임",
          "회차",
          "문항코드",
          "유형",
          "표시순번",
          "제출값",
          "정답",
          "시간초과",
          "경과ms",
          "답변시각",
        ],
        rows.map((r) => {
          const ses = r.session as unknown as {
            round_no: number;
            participant_id: string;
          };
          const item = r.item as unknown as {
            item_code: string;
            item_type: string;
          };
          const p = pmap.get(ses.participant_id);
          return [
            p?.empNo,
            p?.nickname,
            ses.round_no,
            item.item_code,
            item.item_type,
            r.seq,
            r.submitted,
            r.is_correct === null ? "" : r.is_correct ? 1 : 0,
            r.is_timeout ? 1 : 0,
            r.elapsed_ms,
            r.answered_at,
          ];
        })
      );
    }

    case "scores": {
      const pmap = await participantMap();
      const rows = await fetchAll((from, to) =>
        db
          .from("v_round_score")
          .select("participant_id, round_no, score, total_items, pct, points, completed_at")
          .order("round_no")
          .order("participant_id")
          .range(from, to)
      );
      return toCsv(
        ["사번", "닉네임", "소속", "부서", "회차", "점수", "문항수", "정답률", "포인트", "종료시각"],
        rows.map((r) => {
          const p = pmap.get(r.participant_id);
          return [
            p?.empNo,
            p?.nickname,
            p?.orgUnitName,
            p?.departmentName,
            r.round_no,
            r.score,
            r.total_items,
            r.pct,
            r.points,
            r.completed_at,
          ];
        })
      );
    }

    case "items": {
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
      return toCsv(
        ["문항코드", "회차", "난이도", "유형", "영역", "앵커", "측정코드", "응답수", "정답률P", "시간초과율", "변별도D"],
        rows.map((r) => [
          r.item_code,
          r.round_no,
          r.level,
          r.item_type,
          r.category,
          r.anchor_code,
          r.measure_code,
          r.n,
          r.p_value,
          r.timeout_pct,
          r.discrimination,
        ])
      );
    }

    case "matched": {
      const pmap = await participantMap();
      const rows = await fetchAll((from, to) =>
        db
          .from("v_matched_pre_post")
          .select("participant_id, nickname, org_unit_name, pre_n, post_n, pre_pct, post_pct, gain_pp")
          .order("gain_pp", { ascending: false })
          .range(from, to)
      );
      return toCsv(
        ["사번", "닉네임", "소속", "사전문항수", "사후문항수", "사전정답률", "사후정답률", "향상폭pp"],
        rows.map((r) => [
          pmap.get(r.participant_id)?.empNo,
          r.nickname,
          r.org_unit_name,
          r.pre_n,
          r.post_n,
          r.pre_pct,
          r.post_pct,
          r.gain_pp,
        ])
      );
    }

    case "outcomes": {
      const [summaryRes, pairs, anchors, transfers] = await Promise.all([
        db
          .from("v_matched_summary")
          .select(
            "matched_n, pair_count, pre_avg_pct, post_avg_pct, mean_gain_pp, median_gain_pp, improved_n, improved_pct"
          )
          .maybeSingle(),
        fetchAll((from, to) =>
          db
            .from("v_measure_pair_stats")
            .select("measure_code, pre_item_code, post_item_code, n, pre_pct, post_pct, gain_pp")
            .order("measure_code")
            .range(from, to)
        ),
        fetchAll((from, to) =>
          db
            .from("v_anchor_trend")
            .select("round_no, anchor_code, n, pct")
            .order("anchor_code")
            .order("round_no")
            .range(from, to)
        ),
        fetchAll((from, to) =>
          db
            .from("v_transfer_outcome_stats")
            .select("measure_code, item_code, round_no, n, pct")
            .order("measure_code")
            .range(from, to)
        ),
      ]);
      if (summaryRes.error) throw new Error(summaryRes.error.message);
      const s = summaryRes.data;
      const rows: unknown[][] = [
        ["요약", "matchedN", "", "", "", s?.matched_n ?? "", "", "", "", "", "12쌍을 모두 확정한 동일인 수"],
        ["요약", "pairCount", "", "", "", s?.pair_count ?? 12, "", "", "", "", "사전·사후 측정 문항쌍 수"],
        ["요약", "preAvgPct", "", "", "", "", s?.pre_avg_pct ?? "", "", "", "", "완전대응 표본의 사전 평균 정답률"],
        ["요약", "postAvgPct", "", "", "", "", "", s?.post_avg_pct ?? "", "", "", "완전대응 표본의 사후 평균 정답률"],
        ["요약", "meanGainPp", "", "", "", "", "", "", s?.mean_gain_pp ?? "", "", "참가자별 향상폭의 평균"],
        ["요약", "medianGainPp", "", "", "", "", "", "", s?.median_gain_pp ?? "", "", "참가자별 향상폭의 중앙값"],
        ["요약", "improvedN", "", "", "", s?.improved_n ?? "", "", "", "", "", "사전 대비 사후 향상폭이 0보다 큰 사람 수"],
        ["요약", "improvedPct", "", "", "", "", "", "", "", s?.improved_pct ?? "", "향상자 수 ÷ 대응 표본 수"],
        ...pairs.map((r) => [
          "문항쌍", r.measure_code, r.pre_item_code, r.post_item_code, "", r.n,
          r.pre_pct ?? "", r.post_pct ?? "", r.gain_pp ?? "", "", "완전대응 참가자 기준",
        ]),
        ...anchors.map((r) => [
          "앵커", r.anchor_code, "", "", r.round_no, r.n, "", "", "", r.pct ?? "", "회차 완료·만료 세션의 확정 응답 기준",
        ]),
        ...transfers.map((r) => [
          "전이", r.measure_code, r.item_code, "", r.round_no, r.n, "", "", "", r.pct ?? "", "회차 완료·만료 세션의 확정 응답 기준",
        ]),
      ];
      return toCsv(
        ["구분", "코드", "사전 문항", "사후 문항", "회차", "n", "사전 정답률(%)", "사후 정답률(%)", "향상폭(pp)", "정답률(%)", "산식·범위"],
        rows
      );
    }

    case "heatmap": {
      const rows = await fetchAll((from, to) =>
        db
          .from("v_heatmap")
          .select("org_unit_name, category, n, pct")
          .order("org_unit_name")
          .order("category")
          .range(from, to)
      );
      return toCsv(
        ["소속", "영역", "응답수", "정답률"],
        rows.map((r) => [r.org_unit_name, r.category, r.n, r.pct])
      );
    }

    case "participation": {
      const rows = await fetchAll((from, to) =>
        db
          .from("v_participation")
          .select("round_no, started, finished, registered")
          .order("round_no")
          .range(from, to)
      );
      return toCsv(
        ["회차", "시작", "완료", "가입자"],
        rows.map((r) => [r.round_no, r.started, r.finished, r.registered])
      );
    }
  }
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ kind: string }> }
) {
  if (!getAdminId(req)) return apiError(401, "UNAUTHENTICATED");

  const { kind } = await ctx.params;
  if (!(KINDS as readonly string[]).includes(kind)) {
    return apiError(404, "NOT_FOUND");
  }

  try {
    const csv = await buildCsv(kind as Kind);
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="hrdk_${kind}.csv"`,
      },
    });
  } catch (err) {
    console.error("[admin/export]", err instanceof Error ? err.message : err);
    return apiError(500, "INTERNAL");
  }
}
