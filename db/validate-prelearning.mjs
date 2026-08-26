import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bodies = JSON.parse(
  fs.readFileSync(path.join(root, "db", "prelearning.json"), "utf8")
);
const seedSql = fs.readFileSync(
  path.join(root, "db", "06_seed_prelearning.sql"),
  "utf8"
);
const viewsSql = fs.readFileSync(path.join(root, "db", "05_views.sql"), "utf8");
const roundsSql = fs.readFileSync(
  path.join(root, "db", "03_seed_rounds.sql"),
  "utf8"
);
const copyMd = fs.readFileSync(
  path.join(root, "design", "copy.md"),
  "utf8"
);
const learnPage = fs.readFileSync(
  path.join(root, "app", "(main)", "round", "[no]", "learn", "page.tsx"),
  "utf8"
);

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function parseSupportedBody(body) {
  const sections = [];
  let current = null;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    const heading = line.match(/^#{2,3}\s+(.+)$/);
    if (heading) {
      current = { title: heading[1], lines: [] };
      sections.push(current);
      continue;
    }
    expect(
      current !== null,
      "본문은 제목(## 또는 ###)으로 시작해야 합니다."
    );
    expect(
      !line.startsWith("#") || line.startsWith("##"),
      `지원하지 않는 제목 문법: ${line}`
    );
    expect(
      !line.startsWith("*") || line.startsWith("**"),
      `지원하지 않는 강조 문법: ${line}`
    );
    current.lines.push(line);
  }
  return sections;
}

const expectedRounds = [1, 2, 3, 4, 5, 6];
expect(
  bodies.length === expectedRounds.length,
  `본문 수 ${bodies.length} (기대 ${expectedRounds.length})`
);
expect(
  JSON.stringify(bodies.map((row) => row.round_no)) ===
    JSON.stringify(expectedRounds),
  "본문 회차가 1..6 순서가 아님"
);

for (const row of bodies) {
  expect(typeof row.title === "string" && row.title.length > 0, `${row.round_no}회차 제목 누락`);
  expect(typeof row.body === "string" && row.body.length >= 500, `${row.round_no}회차 본문 누락 또는 지나치게 짧음`);
  const sections = parseSupportedBody(row.body);
  expect(sections.length === 6, `${row.round_no}회차 카드 수 ${sections.length} (기대 6)`);
  expect(
    sections.every((section) => section.title.length > 0 && section.lines.length > 0),
    `${row.round_no}회차 빈 카드가 있음`
  );
  expect(!/8주|8회차|96문항/.test(row.body), `${row.round_no}회차에 이전 운영 표현이 남아 있음`);
}

const sqlRows = [...seedSql.matchAll(
  /SET prelearning_body = '((?:''|[^'])*)'\s+WHERE round_no = (\d+);/gs
)].map((match) => ({
  body: match[1].replaceAll("''", "'"),
  round_no: Number(match[2]),
}));
expect(sqlRows.length === expectedRounds.length, `본문 SQL UPDATE 수 ${sqlRows.length} (기대 6)`);
expect(
  sqlRows.every((row, index) => row.round_no === expectedRounds[index]),
  "본문 SQL 회차가 1..6 순서가 아님"
);
for (let i = 0; i < bodies.length; i += 1) {
  expect(sqlRows[i].body === bodies[i].body, `${bodies[i].round_no}회차 JSON·SQL 본문 불일치`);
}
expect(/^BEGIN;/m.test(seedSql) && /^COMMIT;/m.test(seedSql), "본문 SQL 트랜잭션 표식 누락");

// ---- 테마·제목 삼중 정합 (2026-08-26 신설 — 이전에는 어느 검증기도 대조하지 않아
//      prelearning.json의 title과 03시드의 prelearning_title이 조용히 갈라질 수 있었다)
// 03_seed_rounds.sql의 INSERT에서 (round_no, theme, prelearning_title)을 추출한다.
// 이 정규식은 03시드의 값 형식과 계약이다 — 형식 변경 시 함께 수정할 것.
const seedTuples = [...roundsSql.matchAll(
  /\((\d+), \d+, '((?:''|[^'])*)',\s*'[^']*', '[^']*',\s*'((?:''|[^'])*)', (?:true|false)\)/g
)].map((m) => ({
  round_no: Number(m[1]),
  theme: m[2].replaceAll("''", "'"),
  prelearning_title: m[3].replaceAll("''", "'"),
}));
expect(
  seedTuples.length === expectedRounds.length &&
    seedTuples.every((row, index) => row.round_no === expectedRounds[index]),
  `회차 시드 테마 튜플 ${seedTuples.length}건 추출 (기대 6·1..6 순서) — 03_seed_rounds.sql 형식 확인`
);
for (let i = 0; i < seedTuples.length; i += 1) {
  const t = seedTuples[i];
  expect(
    t.prelearning_title === bodies[i].title,
    `${t.round_no}회차 사전학습 제목 불일치: 03시드 '${t.prelearning_title}' vs JSON '${bodies[i].title}'`
  );
  // 홈 미개방 카드(line-clamp-2, 15px/700)의 폭 안전선 — tasks/ux-findings.md B-3·B-4 실측 기준
  expect(t.theme.length <= 17, `${t.round_no}회차 테마 ${t.theme.length}자 (상한 17자): ${t.theme}`);
  expect(!/8주|8회차|96문항/.test(t.theme), `${t.round_no}회차 테마에 이전 운영 표현이 남아 있음`);
  // 규칙 9: 테마 문안의 정본은 design/copy.md — 등재본과 일치해야 한다
  expect(
    copyMd.includes(`\`${t.round_no}=${t.theme}\``),
    `${t.round_no}회차 테마가 design/copy.md에 등재되지 않음: ${t.theme}`
  );
}

expect(learnPage.includes("/^#{2,3}\\s+(.+)$/"), "사전학습 제목 파서 범위가 바뀜");
expect(learnPage.includes('line.startsWith("- ")'), "사전학습 목록 파서가 없음");
expect(
  /pv\.viewed_at\s*<=\s*s\.started_at/.test(viewsSql),
  "퀴즈 시작 전 열람 조건이 성과 뷰에 없음"
);

console.log("사전학습 검증 통과: 6개 본문, 회차당 6카드, JSON·SQL·03시드·copy.md 정합");
