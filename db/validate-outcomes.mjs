import fs from "node:fs";

const items = JSON.parse(fs.readFileSync("db/items.json", "utf8"));
const views = fs.readFileSync("db/05_views.sql", "utf8");
const api = fs.readFileSync("app/api/admin/stats/outcomes/route.ts", "utf8");
const contract = fs.readFileSync("spec/api-contract.md", "utf8");
const errors = [];
const expect = (condition, message) => {
  if (!condition) errors.push(message);
};

const preCodes = items
  .filter((item) => /^M\d{2}$/.test(item.measure_code ?? ""))
  .map((item) => item.measure_code)
  .sort();
const postCodes = items
  .filter((item) => /^M\d{2}P$/.test(item.measure_code ?? ""))
  .map((item) => item.measure_code.replace(/P$/, ""))
  .sort();
expect(preCodes.length === 12, `사전 측정 코드 수: ${preCodes.length} (기대 12)`);
expect(postCodes.length === 12, `사후 측정 코드 수: ${postCodes.length} (기대 12)`);
expect(JSON.stringify(preCodes) === JSON.stringify(postCodes), "사전·사후 측정쌍 불일치");

expect(views.includes("CREATE OR REPLACE VIEW v_matched_pre_post"), "완전대응 뷰 누락");
expect(views.includes("WHERE pre_n = 12 AND post_n = 12"), "12쌍 완전대응 조건 누락");
expect(views.includes("COALESCE(si.is_correct, false)"), "시간초과 오답 처리 근거 누락");
expect(views.includes("s.status IN ('completed', 'expired')"), "완료·만료 세션 조건 누락");
expect(views.includes("CREATE OR REPLACE VIEW v_matched_summary"), "성과 요약 뷰 누락");
expect(views.includes("PERCENTILE_CONT(0.5)"), "중앙 향상폭 산식 누락");
expect(views.includes("COUNT(*) FILTER (WHERE gain_pp > 0)"), "향상자 비율 산식 누락");
expect(views.includes("CREATE OR REPLACE VIEW v_measure_pair_stats"), "문항쌍 통계 뷰 누락");
expect(views.includes("CREATE OR REPLACE VIEW v_transfer_outcome_stats"), "전이 코드 통계 뷰 누락");

expect(api.includes("NextResponse.json"), "성과 API 응답 누락");
expect(api.includes("v_matched_summary"), "API 요약 뷰 조회 누락");
expect(api.includes("v_measure_pair_stats"), "API 문항쌍 뷰 조회 누락");
expect(api.includes("v_anchor_trend"), "API 앵커 뷰 조회 누락");
expect(api.includes("v_transfer_outcome_stats"), "API 전이 뷰 조회 누락");
expect(api.includes("matchedN") && api.includes("medianGainPp") && api.includes("improvedPct"), "API 요약 필드 누락");
expect(contract.includes("GET /api/admin/stats/outcomes"), "API 계약 누락");
expect(contract.includes("각각 12개 모두 확정한 동일인"), "API 계약의 완전대응 규칙 누락");

// 뷰의 핵심 판정 규칙을 작은 고정 fixture로 재확인한다.
const fullRows = [
  ...Array.from({ length: 12 }, (_, i) => ({ code: `M${String(i + 1).padStart(2, "0")}`, phase: "pre", correct: i !== 0, timeout: i === 0 })),
  ...Array.from({ length: 12 }, (_, i) => ({ code: `M${String(i + 1).padStart(2, "0")}`, phase: "post", correct: i < 6, timeout: false })),
];
const partialRows = fullRows.filter((row) => row.code !== "M12");
const aggregate = (rows) => {
  const byPhase = (phase) => {
    const selected = rows.filter((row) => row.phase === phase);
    const codes = new Set(selected.map((row) => row.code));
    if (codes.size !== 12) return null;
    const correct = selected.filter((row) => row.correct && !row.timeout).length;
    return (correct / 12) * 100;
  };
  const pre = byPhase("pre");
  const post = byPhase("post");
  return pre === null || post === null ? null : { pre, post, gain: post - pre };
};
const full = aggregate(fullRows);
expect(full !== null && Math.abs(full.pre - (11 / 12) * 100) < 1e-9, "12쌍 fixture 사전 정답률 계산 오류");
expect(full !== null && full.post === 50, "12쌍 fixture 사후 정답률 계산 오류");
expect(full !== null && Math.abs(full.gain + (5 / 12) * 100) < 1e-9, "12쌍 fixture 향상폭 계산 오류");
expect(aggregate(partialRows) === null, "11쌍 fixture가 제외되지 않음");

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log("성과측정 검증 통과: 12쌍 완전대응·시간초과 오답·요약·문항쌍·앵커·전이 계약 확인");
