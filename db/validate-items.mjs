import fs from "node:fs";

const items = JSON.parse(fs.readFileSync("db/items.json", "utf8"));
const itemSql = fs.readFileSync("db/04_seed_items.sql", "utf8");
const roundSql = fs.readFileSync("db/03_seed_rounds.sql", "utf8");
const errors = [];
const expect = (condition, message) => {
  if (!condition) errors.push(message);
};
const exactCounts = (values) =>
  Object.fromEntries(
    [...new Set(values)].map((value) => [value, values.filter((item) => item === value).length])
  );
const countsEqual = (actual, expected) =>
  JSON.stringify(Object.entries(actual).sort()) === JSON.stringify(Object.entries(expected).sort());
const sorted = (values) => [...values].sort((a, b) => a - b);

expect(items.length === 72, `문항 수: ${items.length} (기대 72)`);
expect(new Set(items.map((item) => item.item_code)).size === items.length, "문항 코드 중복");
expect(new Set(items.map((item) => `${item.round_no}:${item.seq_no}`)).size === items.length, "회차·순번 중복");
expect(JSON.stringify([...new Set(items.map((item) => item.round_no))].sort((a, b) => a - b)) === JSON.stringify([1, 2, 3, 4, 5, 6]), "회차 범위가 1~6이 아님");
expect(!items.some((item) => item.round_no === 7 || item.round_no === 8), "7·8회차 문항이 남아 있음");

for (let round = 1; round <= 6; round += 1) {
  const roundItems = items.filter((item) => item.round_no === round);
  expect(roundItems.length === 12, `${round}회차 문항 수: ${roundItems.length} (기대 12)`);
  expect(JSON.stringify(sorted(roundItems.map((item) => item.seq_no))) === JSON.stringify([...Array(12)].map((_, index) => index + 1)), `${round}회차 순번 불일치`);
  for (const anchor of ["A1", "A2"]) {
    expect(roundItems.filter((item) => item.anchor_code === anchor).length === 1, `${round}회차 ${anchor} 앵커 수 불일치`);
  }
}

// 2026-08-25 청렴 도입 구성: 안전 43 + 청렴 29 (6:4)
expect(countsEqual(exactCounts(items.map((item) => item.item_type)), { OX: 14, MC4: 53, SHORT: 1, ORDER: 4 }), "문항 유형 분포 불일치");
expect(countsEqual(exactCounts(items.map((item) => item.level)), { L1: 22, L2: 39, L3: 11 }), "난이도 분포 불일치");

// 주제 비중 — category "C"가 청렴, 나머지(측정문항 포함)가 안전
const integrity = items.filter((item) => item.category === "C");
expect(integrity.length === 29, `청렴 문항 수: ${integrity.length} (기대 29)`);
expect(items.length - integrity.length === 43, "안전 문항 수 불일치 (기대 43)");
expect(integrity.every((item) => !item.anchor_code && !item.measure_code), "청렴 문항에 앵커·측정 코드가 붙어 있음");

for (const item of items) {
  if (item.item_type === "OX") {
    expect(typeof item.answer === "boolean", `${item.item_code} OX 정답 자료형 오류`);
    expect(item.choices === null, `${item.item_code} OX choices 오류`);
  } else if (item.item_type === "MC4") {
    expect(Array.isArray(item.choices) && item.choices.length === 4, `${item.item_code} MC4 choices 오류`);
    expect(Number.isInteger(item.answer) && item.answer >= 0 && item.answer <= 3, `${item.item_code} MC4 정답 자료형·범위 오류`);
  } else if (item.item_type === "ORDER") {
    expect(Array.isArray(item.choices) && Array.isArray(item.answer), `${item.item_code} ORDER 자료형 오류`);
    const expectedOrder = [...Array(item.choices?.length ?? 0)].map((_, index) => index);
    expect(JSON.stringify(sorted(item.answer ?? [])) === JSON.stringify(expectedOrder), `${item.item_code} ORDER 정답 순열 오류`);
  } else if (item.item_type === "SHORT") {
    expect(item.choices === null && Array.isArray(item.answer) && item.answer.every((value) => typeof value === "string"), `${item.item_code} SHORT 자료형 오류`);
  } else {
    errors.push(`${item.item_code} 알 수 없는 문항 유형: ${item.item_type}`);
  }
}

const pre = items.filter((item) => /^M[0-9]{2}$/.test(item.measure_code ?? ""));
const post = items.filter((item) => /^M[0-9]{2}P$/.test(item.measure_code ?? ""));
expect(pre.length === 9 && post.length === 9, `사전·사후 측정 수: ${pre.length}+${post.length} (기대 9+9)`);
for (const preItem of pre) {
  const postItem = items.find((item) => item.measure_code === `${preItem.measure_code}P`);
  expect(Boolean(postItem), `${preItem.measure_code} 사후 문항 누락`);
  if (postItem) {
    expect(preItem.item_type === "MC4" && postItem.item_type === "MC4", `${preItem.measure_code} 측정쌍 MC4 불일치`);
    expect(preItem.level === postItem.level, `${preItem.measure_code} 측정쌍 난이도 불일치`);
  }
}
// 측정 9쌍. M04·M08·M09는 사전 정답률 천장/구성개념 불일치로 미투입,
// 전이 T01~T04는 대응 사전문항이 없어 미투입 (2026-08-25 확정)
expect(countsEqual(exactCounts(items.filter((item) => item.measure_code).map((item) => item.measure_code)), { M01: 1, M02: 1, M03: 1, M05: 1, M06: 1, M07: 1, M10: 1, M11: 1, M12: 1, M01P: 1, M02P: 1, M03P: 1, M05P: 1, M06P: 1, M07P: 1, M10P: 1, M11P: 1, M12P: 1 }), "측정 코드 분포 불일치");

// 안전은 '회차-순번'(1-01), 청렴은 'C1-NN'(C1-05) 또는 신규 'C1-NNA'(C1-27A) 형식이다.
// item_code는 위치가 아니라 고정 식별자다 — 재배치해도 코드는 바뀌지 않는다(추적성 유지).
const sqlCodes = [...itemSql.matchAll(/^ \('((?:[1-6]-[0-9]{2})|(?:C1-[0-9]{2}A?))',/gm)].map((match) => match[1]);
expect(sqlCodes.length === 72, `SQL 문항 행 수: ${sqlCodes.length} (기대 72)`);
expect(JSON.stringify(sqlCodes) === JSON.stringify(items.map((item) => item.item_code)), "JSON·SQL 문항 순서/코드 불일치");
expect(!/\('(?:7|8)-/.test(itemSql), "SQL에 7·8회차 문항이 남아 있음");

// 운영 일정 2026-09-01 ~ 10-09 (2026-08-25 운영 계획서 확정)
for (const [round, season, open, close] of [
  [1, 1, "2026-09-01", "2026-09-04"],
  [2, 1, "2026-09-07", "2026-09-11"],
  [3, 1, "2026-09-14", "2026-09-18"],
  [4, 2, "2026-09-21", "2026-09-25"],
  [5, 2, "2026-09-28", "2026-10-02"],
  [6, 2, "2026-10-05", "2026-10-09"],
]) {
  expect(roundSql.includes(`(${round}, ${season},`), `${round}회차 시즌 누락/불일치`);
  expect(roundSql.includes(`${open} 00:00:00+09`) && roundSql.includes(`${close} 23:59:59+09`), `${round}회차 일정 불일치`);
}
expect(!/\(7,|\(8,/.test(roundSql), "회차 SQL에 7·8회차가 남아 있음");

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log("문항은행 검증 통과: 6회차 × 12문항, 72문항, 9쌍 측정, SQL 정합");
