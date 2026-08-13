import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 필요합니다.");
}

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function expect(condition, message) {
  if (!condition) throw new Error(`T21 실DB 검증 실패: ${message}`);
}

async function count(table) {
  const { count: value, error } = await db
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return value ?? 0;
}

async function rows(table, columns = "*") {
  const { data, error } = await db.from(table).select(columns);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data ?? [];
}

const [
  configN,
  categoryN,
  unitN,
  departmentN,
  participantN,
  sessionN,
  sessionItemN,
  prelearningViewN,
  rankingN,
  adminN,
] = await Promise.all([
  count("app_config"),
  count("org_category"),
  count("org_unit"),
  count("department"),
  count("participant"),
  count("quiz_session"),
  count("quiz_session_item"),
  count("prelearning_view"),
  count("ranking_snapshot"),
  count("admin_user"),
]);

expect(configN === 14, `app_config=${configN}, 기대값=14`);
expect(categoryN === 4 && unitN === 50 && departmentN === 193,
  `조직=${categoryN}/${unitN}/${departmentN}, 기대값=4/50/193`);
expect(
  [participantN, sessionN, sessionItemN, prelearningViewN]
    .every((value) => value === 0),
  "개시 전 참가자·응시·응답·열람 데이터가 0행이 아님"
);
expect(
  rankingN === 0 || rankingN === 4,
  `개시 전 순위 스냅샷=${rankingN}, 기대값=첫 Cron 전 0 또는 후 4`
);
expect(adminN <= 1, `관리자 계정=${adminN}, 기대값=0 또는 1`);

const rankingRows = await rows("ranking_snapshot", "kind,round_no,payload");
if (rankingRows.length > 0) {
  expect(
    rankingRows
      .map((row) => row.kind)
      .sort()
      .join(",") === "average,department,org_unit,total",
    "개시 전 순위 스냅샷 종류가 기준 4종과 다름"
  );
  expect(
    rankingRows.every(
      (row) => row.round_no === null &&
        Array.isArray(row.payload) &&
        row.payload.length === 0
    ),
    "개시 전 순위 스냅샷에 회차 또는 참가자 payload가 존재함"
  );
}

const rounds = await rows(
  "quiz_round",
  "round_no,season,opens_at,closes_at,prelearning_body,is_published"
);
expect(rounds.length === 6, `quiz_round=${rounds.length}, 기대값=6`);
expect(
  rounds.map((round) => round.round_no).sort((a, b) => a - b).join(",") ===
    "1,2,3,4,5,6",
  "회차 범위가 1~6이 아님"
);
expect(rounds.every((round) => round.prelearning_body?.trim()), "사전학습 본문 누락");
expect(rounds.every((round) => round.is_published === false), "개시 전 공개 회차 존재");
const expectedSchedule = [
  ["2026-08-16T15:00:00.000Z", "2026-08-21T14:59:59.000Z"],
  ["2026-08-23T15:00:00.000Z", "2026-08-28T14:59:59.000Z"],
  ["2026-08-30T15:00:00.000Z", "2026-09-04T14:59:59.000Z"],
  ["2026-09-06T15:00:00.000Z", "2026-09-11T14:59:59.000Z"],
  ["2026-09-13T15:00:00.000Z", "2026-09-18T14:59:59.000Z"],
  ["2026-09-20T15:00:00.000Z", "2026-09-25T14:59:59.000Z"],
];
for (const round of rounds) {
  const expected = expectedSchedule[round.round_no - 1];
  expect(
    new Date(round.opens_at).toISOString() === expected[0] &&
      new Date(round.closes_at).toISOString() === expected[1],
    `${round.round_no}회차 일정 불일치`
  );
}

const items = await rows(
  "quiz_item",
  "item_code,round_no,seq_no,item_type,level,anchor_code,measure_code"
);
expect(items.length === 72, `quiz_item=${items.length}, 기대값=72`);

const perRound = new Map();
const types = new Map();
const levels = new Map();
const anchors = new Map();
for (const item of items) {
  perRound.set(item.round_no, (perRound.get(item.round_no) ?? 0) + 1);
  types.set(item.item_type, (types.get(item.item_type) ?? 0) + 1);
  levels.set(item.level, (levels.get(item.level) ?? 0) + 1);
  if (item.anchor_code) {
    anchors.set(item.round_no, (anchors.get(item.round_no) ?? 0) + 1);
  }
}
expect(
  [...Array(6)].every((_, index) => perRound.get(index + 1) === 12),
  "회차당 12문항 불일치"
);
expect(
  types.get("OX") === 14 &&
    types.get("SHORT") === 1 &&
    types.get("MC4") === 55 &&
    types.get("ORDER") === 2,
  `유형 분포 불일치: ${JSON.stringify(Object.fromEntries(types))}`
);
expect(
  levels.get("L1") === 26 &&
    levels.get("L2") === 35 &&
    levels.get("L3") === 11,
  `난이도 분포 불일치: ${JSON.stringify(Object.fromEntries(levels))}`
);
expect(
  [...Array(6)].every((_, index) => anchors.get(index + 1) === 2),
  "앵커가 회차당 2문항이 아님"
);

const preN = items.filter((item) => /^M(?:0[1-9]|1[0-2])$/.test(item.measure_code ?? "")).length;
const postN = items.filter((item) => /^M(?:0[1-9]|1[0-2])P$/.test(item.measure_code ?? "")).length;
expect(preN === 12 && postN === 12, `측정문항=${preN}+${postN}, 기대값=12+12`);
const measurePairs = new Map();
for (const item of items.filter((row) => /^M(?:0[1-9]|1[0-2])P?$/.test(row.measure_code ?? ""))) {
  const code = item.measure_code.replace(/P$/, "");
  const pair = measurePairs.get(code) ?? [];
  pair.push(item);
  measurePairs.set(code, pair);
}
expect(measurePairs.size === 12, `측정 쌍=${measurePairs.size}, 기대값=12`);
for (const [code, pair] of measurePairs) {
  expect(
    pair.length === 2 && pair.every((item) => item.item_type === "MC4") &&
      pair[0].level === pair[1].level,
    `${code} 문항쌍의 유형·난이도 불일치`
  );
}

const [summary, pairStats, participation] = await Promise.all([
  rows("v_matched_summary"),
  rows("v_measure_pair_stats"),
  rows("v_participation"),
]);
expect(summary.length === 1 && summary[0].matched_n === 0 && summary[0].pair_count === 12,
  "성과 요약 뷰 초기값 불일치");
expect(pairStats.length === 12, `문항쌍 통계=${pairStats.length}, 기대값=12`);
expect(participation.length === 6, `참여 지표=${participation.length}, 기대값=6`);

const { data: minRounds, error: minRoundsError } = await db.rpc("fn_min_rounds");
if (minRoundsError) throw new Error(`fn_min_rounds: ${minRoundsError.message}`);
expect(minRounds === 0, `개시 전 fn_min_rounds=${minRounds}, 기대값=0`);

console.log("T21 실DB 검증 통과");
console.log("회차 6 / 문항 72 / 회차당 12 / 측정 12+12 / 앵커 회차당 2 / 사전학습 6");
console.log(`조직 4/50/193 / 참가자 활동 데이터 0 / 빈 순위 스냅샷 ${rankingN} / 관리자 ${adminN} / is_published=false 6`);
console.log("성과 요약·문항쌍·참여 뷰 및 fn_min_rounds 정상");
