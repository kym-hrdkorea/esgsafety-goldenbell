import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outputArg = process.argv[2];
if (!outputArg) {
  throw new Error("사용법: node db/build-t21-migration.mjs <출력 SQL 경로>");
}

const output = path.resolve(outputArg);
const readSql = (name) => readFile(path.join(root, "db", name), "utf8");
const stripTransaction = (sql) =>
  sql
    .replace(/^\s*BEGIN;\s*$/m, "")
    .replace(/^\s*COMMIT;\s*$/m, "")
    .trim();

const [schema, org, rounds, items, views, prelearning, functions] =
  await Promise.all([
    readSql("01_schema.sql"),
    readSql("02_seed_org.sql"),
    readSql("03_seed_rounds.sql"),
    readSql("04_seed_items.sql"),
    readSql("05_views.sql"),
    readSql("06_seed_prelearning.sql"),
    readSql("07_session_functions.sql"),
  ]);

const preamble = `-- T21 Supabase 마이그레이션 — 자동 조립 파일
-- 원본: db/01_schema.sql ~ db/07_session_functions.sql
-- 조건: 대상 public 테이블 12개가 모두 0행일 때만 실행
BEGIN;
SET LOCAL statement_timeout = '180s';
SET LOCAL lock_timeout = '15s';

LOCK TABLE
  public.quiz_session_item,
  public.quiz_session,
  public.prelearning_view,
  public.ranking_snapshot,
  public.admin_user,
  public.participant,
  public.quiz_item,
  public.quiz_round,
  public.department,
  public.org_unit,
  public.org_category,
  public.app_config
IN ACCESS EXCLUSIVE MODE;

DO $t21_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.app_config)
     OR EXISTS (SELECT 1 FROM public.org_category)
     OR EXISTS (SELECT 1 FROM public.org_unit)
     OR EXISTS (SELECT 1 FROM public.department)
     OR EXISTS (SELECT 1 FROM public.participant)
     OR EXISTS (SELECT 1 FROM public.quiz_round)
     OR EXISTS (SELECT 1 FROM public.quiz_item)
     OR EXISTS (SELECT 1 FROM public.quiz_session)
     OR EXISTS (SELECT 1 FROM public.quiz_session_item)
     OR EXISTS (SELECT 1 FROM public.prelearning_view)
     OR EXISTS (SELECT 1 FROM public.ranking_snapshot)
     OR EXISTS (SELECT 1 FROM public.admin_user) THEN
    RAISE EXCEPTION 'T21 중단: 대상 public 테이블에 데이터가 존재합니다.';
  END IF;
END
$t21_guard$;

-- 이전 뷰는 의존관계와 열 형식 차이를 제거한 뒤 최신 정의로 재생성한다.
DROP VIEW IF EXISTS
  public.v_participation,
  public.v_prelearning_effect,
  public.v_heatmap,
  public.v_transfer_outcome_stats,
  public.v_transfer_stats,
  public.v_measure_pair_stats,
  public.v_matched_summary,
  public.v_matched_pre_post,
  public.v_anchor_trend,
  public.v_item_stats,
  public.v_rank_org_unit,
  public.v_rank_department,
  public.v_rank_average,
  public.v_rank_round,
  public.v_rank_total,
  public.v_round_score
CASCADE;

DROP FUNCTION IF EXISTS public.fn_min_rounds();
DROP FUNCTION IF EXISTS public.fn_create_quiz_session(uuid, integer, jsonb);
DROP FUNCTION IF EXISTS public.fn_reconcile_quiz_session(uuid, boolean);
DROP FUNCTION IF EXISTS public.fn_expire_quiz_session(uuid);
`;

const roundConstraint = `
-- CREATE TABLE IF NOT EXISTS는 기존 1~8 제약을 바꾸지 않으므로 명시 교체한다.
ALTER TABLE public.quiz_round
  DROP CONSTRAINT IF EXISTS quiz_round_round_no_check;
ALTER TABLE public.quiz_round
  ADD CONSTRAINT quiz_round_round_no_check
  CHECK (round_no BETWEEN 1 AND 6);
`;

const verification = `
DO $t21_verify$
DECLARE
  v_bad_rounds integer;
BEGIN
  IF (SELECT count(*) FROM public.app_config) <> 14 THEN
    RAISE EXCEPTION 'T21 검증 실패: app_config 14건이 아님';
  END IF;
  IF (SELECT count(*) FROM public.org_category) <> 4
     OR (SELECT count(*) FROM public.org_unit) <> 50
     OR (SELECT count(*) FROM public.department) <> 193 THEN
    RAISE EXCEPTION 'T21 검증 실패: 조직 시드 4/50/193 불일치';
  END IF;
  IF (SELECT count(*) FROM public.quiz_round) <> 6
     OR EXISTS (SELECT 1 FROM public.quiz_round WHERE round_no NOT BETWEEN 1 AND 6) THEN
    RAISE EXCEPTION 'T21 검증 실패: 회차가 1~6의 6건이 아님';
  END IF;
  IF (SELECT count(*) FROM public.quiz_item) <> 72 THEN
    RAISE EXCEPTION 'T21 검증 실패: 문항이 72건이 아님';
  END IF;
  SELECT count(*) INTO v_bad_rounds
  FROM (
    SELECT round_no
    FROM public.quiz_item
    GROUP BY round_no
    HAVING count(*) <> 12
  ) AS bad;
  IF v_bad_rounds <> 0 OR (SELECT count(DISTINCT round_no) FROM public.quiz_item) <> 6 THEN
    RAISE EXCEPTION 'T21 검증 실패: 회차당 12문항이 아님';
  END IF;
  IF (SELECT count(*) FROM public.quiz_item WHERE measure_code ~ '^M(0[1-9]|1[0-2])$') <> 12
     OR (SELECT count(*) FROM public.quiz_item WHERE measure_code ~ '^M(0[1-9]|1[0-2])P$') <> 12 THEN
    RAISE EXCEPTION 'T21 검증 실패: 사전/사후 측정문항 12+12 불일치';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.quiz_item
    WHERE anchor_code IS NOT NULL
    GROUP BY round_no
    HAVING count(*) <> 2
  ) OR (SELECT count(*) FROM public.quiz_item WHERE anchor_code IS NOT NULL) <> 12 THEN
    RAISE EXCEPTION 'T21 검증 실패: 앵커가 회차당 2개가 아님';
  END IF;
  IF (SELECT count(*) FROM public.quiz_round WHERE prelearning_body IS NOT NULL) <> 6 THEN
    RAISE EXCEPTION 'T21 검증 실패: 사전학습 본문 6건이 아님';
  END IF;
  IF EXISTS (SELECT 1 FROM public.quiz_round WHERE is_published) THEN
    RAISE EXCEPTION 'T21 검증 실패: 개시 전 회차가 공개 상태임';
  END IF;
  IF (SELECT count(*) FROM pg_views WHERE schemaname = 'public' AND viewname IN (
    'v_round_score', 'v_rank_total', 'v_rank_round', 'v_rank_average',
    'v_rank_department', 'v_rank_org_unit', 'v_item_stats', 'v_anchor_trend',
    'v_matched_pre_post', 'v_matched_summary', 'v_measure_pair_stats',
    'v_transfer_stats', 'v_transfer_outcome_stats', 'v_heatmap',
    'v_prelearning_effect', 'v_participation'
  )) <> 16 THEN
    RAISE EXCEPTION 'T21 검증 실패: 최신 뷰 16개가 아님';
  END IF;
  IF to_regprocedure('public.fn_create_quiz_session(uuid,integer,jsonb)') IS NULL
     OR to_regprocedure('public.fn_reconcile_quiz_session(uuid,boolean)') IS NULL
     OR to_regprocedure('public.fn_expire_quiz_session(uuid)') IS NULL THEN
    RAISE EXCEPTION 'T21 검증 실패: 세션 RPC 3개 누락';
  END IF;
  IF NOT has_function_privilege(
    'service_role', 'public.fn_create_quiz_session(uuid,integer,jsonb)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'T21 검증 실패: service_role RPC 권한 누락';
  END IF;
END
$t21_verify$;

COMMIT;
`;

const sql = [
  preamble,
  schema.trim(),
  roundConstraint,
  org.trim(),
  rounds.trim(),
  items.trim(),
  views.trim(),
  stripTransaction(prelearning),
  stripTransaction(functions),
  verification,
].join("\n\n");

const beginCount = (sql.match(/^BEGIN;$/gm) ?? []).length;
const commitCount = (sql.match(/^COMMIT;$/gm) ?? []).length;
if (beginCount !== 1 || commitCount !== 1) {
  throw new Error(`트랜잭션 경계 오류: BEGIN=${beginCount}, COMMIT=${commitCount}`);
}

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, sql, "utf8");
console.log(`T21 SQL 생성 완료: ${output}`);
console.log(`bytes=${Buffer.byteLength(sql, "utf8")}, BEGIN=${beginCount}, COMMIT=${commitCount}`);
