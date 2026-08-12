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
expect(learnPage.includes("/^#{2,3}\\s+(.+)$/"), "사전학습 제목 파서 범위가 바뀜");
expect(learnPage.includes('line.startsWith("- ")'), "사전학습 목록 파서가 없음");
expect(
  /pv\.viewed_at\s*<=\s*s\.started_at/.test(viewsSql),
  "퀴즈 시작 전 열람 조건이 성과 뷰에 없음"
);

console.log("사전학습 검증 통과: 6개 본문, 회차당 6카드, JSON·SQL 정합");
