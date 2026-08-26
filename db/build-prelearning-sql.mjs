// db/prelearning.json → db/06_seed_prelearning.sql 생성기 (2026-08-26 신설)
// 이전에는 두 파일을 손으로 동기화했다 — 공백 하나만 어긋나도 validate-prelearning의
// 바이트 완전일치 대조가 실패하고 원인 추적이 오래 걸려서 자동화했다.
//
// 방출 형식 계약: validate-prelearning.mjs의 추출 정규식
//   /SET prelearning_body = '((?:''|[^'])*)'\s+WHERE round_no = (\d+);/gs
// 과 정확히 호환되는 모양으로 방출한다. 형식을 바꾸면 검증기도 함께 수정할 것.
// 개행은 LF로 방출한다 — CRLF가 섞이면 JSON↔SQL 바이트 대조가 깨진다
// (git core.autocrlf=false 전제, tasks/점검보고서-2026-08-19.md CRLF 사고 참조).
//
// 실행: pnpm build:prelearning  (생성 후 validate-prelearning까지 연쇄 실행)
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const bodies = JSON.parse(
  fs.readFileSync(new URL("db/prelearning.json", root), "utf8")
);

if (bodies.length !== 6) {
  console.error(`prelearning.json 본문 수 ${bodies.length} (기대 6)`);
  process.exit(1);
}

const esc = (s) => s.replaceAll("'", "''");

const parts = [
  "-- =====================================================================",
  "-- 06_seed_prelearning.sql : 사전학습 본문 6건",
  "-- ★ 자동 생성 파일 — 직접 수정 금지. 원본: db/prelearning.json",
  "--   재생성: pnpm build:prelearning (db/build-prelearning-sql.mjs)",
  "-- 지원 Markdown 부분집합: ##/### 제목 · '- ' 목록 · **강조** (renderer: learn/page.tsx)",
  "-- =====================================================================",
  "",
  "BEGIN;",
  "",
];
for (const row of bodies) {
  parts.push(
    `UPDATE quiz_round`,
    `SET prelearning_body = '${esc(row.body)}'`,
    `WHERE round_no = ${row.round_no};`,
    ""
  );
}
parts.push("COMMIT;", "");

fs.writeFileSync(new URL("db/06_seed_prelearning.sql", root), parts.join("\n"));
console.log(`06_seed_prelearning.sql 재생성: ${bodies.length}건`);
