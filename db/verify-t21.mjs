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
expect(categoryN === 4 && unitN === 50 && departmentN === 194,
  `조직=${categoryN}/${unitN}/${departmentN}, 기대값=4/50/194 (2026-08-31 국가자격디지털혁신팀 추가)`);
expect(
  [participantN, sessionN, sessionItemN, prelearningViewN]
    .every((value) => value === 0),
  "개시 전 참가자·응시·응답·열람 데이터가 0행이 아님"
);
expect(
  rankingN === 0 || rankingN === 3,
  `개시 전 순위 스냅샷=${rankingN}, 기대값=첫 Cron 전 0 또는 후 3`
);
expect(adminN <= 1, `관리자 계정=${adminN}, 기대값=0 또는 1`);

const rankingRows = await rows("ranking_snapshot", "kind,round_no,payload");
if (rankingRows.length > 0) {
  // 'total'은 2026-08-25 개편(Q항)으로 적재 중단 — average·department·org_unit 3종
  expect(
    rankingRows
      .map((row) => row.kind)
      .sort()
      .join(",") === "average,department,org_unit",
    "개시 전 순위 스냅샷 종류가 기준 3종과 다름"
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
// 자동 개방 운영(Q항 확정): is_published=true를 유지하고 개방은 일정이 단독 결정한다
// (리뷰 A-5). 개시일 수동 publish 작업이 없다.
expect(rounds.every((round) => round.is_published === true), "회차가 공개 상태가 아님(자동 개방 운영)");
// 운영 일정 2026-09-01 ~ 10-09 (KST) — db/03_seed_rounds.sql과 동일 값(UTC 표기)
const expectedSchedule = [
  ["2026-08-31T15:00:00.000Z", "2026-09-04T14:59:59.000Z"],
  ["2026-09-06T15:00:00.000Z", "2026-09-11T14:59:59.000Z"],
  ["2026-09-13T15:00:00.000Z", "2026-09-18T14:59:59.000Z"],
  ["2026-09-20T15:00:00.000Z", "2026-09-25T14:59:59.000Z"],
  ["2026-09-27T15:00:00.000Z", "2026-10-02T14:59:59.000Z"],
  ["2026-10-04T15:00:00.000Z", "2026-10-09T14:59:59.000Z"],
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
// 2026-08-25 청렴 개편(안전 43 : 청렴 29) 반영 — tasks/최종문항구성-2026-08-25.md
expect(
  types.get("OX") === 14 &&
    types.get("SHORT") === 1 &&
    types.get("MC4") === 53 &&
    types.get("ORDER") === 4,
  `유형 분포 불일치: ${JSON.stringify(Object.fromEntries(types))}`
);
expect(
  levels.get("L1") === 22 &&
    levels.get("L2") === 39 &&
    levels.get("L3") === 11,
  `난이도 분포 불일치: ${JSON.stringify(Object.fromEntries(levels))}`
);
expect(
  [...Array(6)].every((_, index) => anchors.get(index + 1) === 2),
  "앵커가 회차당 2문항이 아님"
);

const preN = items.filter((item) => /^M(?:0[1-9]|1[0-2])$/.test(item.measure_code ?? "")).length;
const postN = items.filter((item) => /^M(?:0[1-9]|1[0-2])P$/.test(item.measure_code ?? "")).length;
// 측정쌍은 청렴 개편으로 12→9쌍 (M01·M02·M03·M05·M06·M07·M10·M11·M12)
expect(preN === 9 && postN === 9, `측정문항=${preN}+${postN}, 기대값=9+9`);
const measurePairs = new Map();
for (const item of items.filter((row) => /^M(?:0[1-9]|1[0-2])P?$/.test(row.measure_code ?? ""))) {
  const code = item.measure_code.replace(/P$/, "");
  const pair = measurePairs.get(code) ?? [];
  pair.push(item);
  measurePairs.set(code, pair);
}
expect(measurePairs.size === 9, `측정 쌍=${measurePairs.size}, 기대값=9`);
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
expect(summary.length === 1 && summary[0].matched_n === 0 && summary[0].pair_count === 9,
  "성과 요약 뷰 초기값 불일치");
expect(pairStats.length === 9, `문항쌍 통계=${pairStats.length}, 기대값=9`);
expect(participation.length === 6, `참여 지표=${participation.length}, 기대값=6`);

const { data: minRounds, error: minRoundsError } = await db.rpc("fn_min_rounds");
if (minRoundsError) throw new Error(`fn_min_rounds: ${minRoundsError.message}`);
expect(minRounds === 0, `개시 전 fn_min_rounds=${minRounds}, 기대값=0`);

// 참여율 분모 함수(Q항) — 개시 전(opens_at 미래)에는 개방 회차 0
const { data: openRounds, error: openRoundsError } = await db.rpc("fn_open_rounds");
if (openRoundsError) throw new Error(`fn_open_rounds: ${openRoundsError.message}`);
expect(openRounds === 0, `개시 전 fn_open_rounds=${openRounds}, 기대값=0`);

console.log("T21 실DB 검증 통과");
console.log("회차 6 / 문항 72 / 회차당 12 / 측정 9+9 / 앵커 회차당 2 / 사전학습 6");
console.log(`조직 4/50/193 / 참가자 활동 데이터 0 / 빈 순위 스냅샷 ${rankingN} / 관리자 ${adminN} / is_published=true 6(자동 개방)`);
console.log("성과 요약·문항쌍·참여 뷰 및 fn_min_rounds·fn_open_rounds 정상");
