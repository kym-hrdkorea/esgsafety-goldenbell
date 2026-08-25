-- =====================================================================
-- 10. 뷰 마이그레이션 (2026-08-26) — 포상 기준 반영: 부서 종합점수 도입
--
-- 운영 계획서(ESG안전센터) 우수 부서 선정 기준 확정에 따라
-- 부서·소속 순위를 평균 포인트 단독에서 종합점수로 개편한다.
--
--   종합점수(0~100) = (평균 포인트 ÷ 회차 만점 × 100) × 0.5
--                   + (평균 참여율 × 100) × 0.5
--
-- 근거·범위: spec/decisions-addendum.md Q항, spec/business-rules.md 5.2.
-- 실행: 규칙 9-1에 따라 사용자 승인 후 Supabase SQL Editor에서 1회 실행.
-- 순서: ① 이 파일 전체 실행(구버전 앱과 호환 — 컬럼 말미 추가만)
--       ② 앱 배포(cron·dashboard·me 변경 포함)
--       ③ 파일 하단의 [배포 후 1회 DML] 블록 실행
-- 원본 db/05_views.sql도 같은 내용으로 갱신되어 있다(fresh DB 재구축 정합).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 개방 회차 수 (부서 참여율의 분모). fn_min_rounds()와 대칭 구조 — C항과
-- 같은 단일 출처 원칙: API·뷰·검증 스크립트는 이 함수만 쓴다.
-- 개방 = 공개되었고 열림 시각이 지난 회차. 종료(closes_at) 여부는 무관 —
-- 이미 닫힌 회차도 응시 기회가 있었으므로 분모에 포함한다.
-- refresh-rankings의 '시작된 회차' 판정(회차별 스냅샷 대상)과 동일 기준.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_open_rounds() RETURNS int
LANGUAGE sql STABLE AS $$
  SELECT count(*)::int
  FROM quiz_round r
  WHERE r.is_published
    AND r.opens_at <= now();
$$;

-- ---------------------------------------------------------------------
-- ④ 부서 순위 (결정④: 참여자 3명 이상)
--    종합점수(0~100) = (평균 포인트 ÷ 회차 만점 × 100) × 0.5
--                    + (평균 참여율 × 100) × 0.5
--    · 평균 포인트 : 세션(참가자×회차) 단위 AVG(points) — 기존과 동일
--    · 평균 참여율 : 참가자 단위 AVG(응시 회차 수 ÷ 개방 회차 수)
--                    — 집계 층위가 달라 CTE를 참가자→부서 2단으로 나눈다
--    · 회차 만점   : items_per_round × (point_base + point_time_bonus_max)
--                    — app_config에서 유도(규칙 7)
--    · 가중치 0.5/0.5는 운영자 확정 정책 상수(addendum Q항, 2026-08-25)
--      — app_config로 빼지 않는다(런타임 임의 변경 차단)
--    · 종합점수는 표시용 반올림값(avg_points)이 아니라 비반올림 원값으로
--      계산한다 — 반올림 후 재계산하면 표시값과 순위 근거가 어긋난다
--    · 회차 비공개 전환 등으로 응시 수 > 개방 수가 되면 참여율은 100% 클램프
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_rank_department AS
WITH cfg AS (
  SELECT (SELECT (value)::int FROM app_config WHERE key = 'items_per_round')
         * ( (SELECT (value)::int FROM app_config WHERE key = 'point_base')
           + (SELECT (value)::int FROM app_config WHERE key = 'point_time_bonus_max') )
           AS round_max_points,
         fn_open_rounds() AS open_rounds
),
-- [1단] 참가자 단위: 응시 회차 수 → 참여율.
--       개방 회차 0이면 NULL(LEAST는 NULL을 무시하므로 CASE로 명시 처리).
per_participant AS (
  SELECT p.department_id,
         r.participant_id,
         CASE WHEN c.open_rounds > 0
              THEN LEAST(COUNT(*)::numeric / c.open_rounds, 1)
              ELSE NULL END AS participation
  FROM v_round_score r
  JOIN participant p ON p.id = r.participant_id
  CROSS JOIN cfg c
  GROUP BY p.department_id, r.participant_id, c.open_rounds
),
-- [2단-a] 부서 단위: 참가자 수 · 평균 참여율 (참가자 층위)
dept_participation AS (
  SELECT department_id,
         COUNT(*)           AS participants,
         AVG(participation) AS avg_participation
  FROM per_participant
  GROUP BY department_id
),
-- [2단-b] 부서 단위: 평균 포인트 (세션 층위 — 기존 산식 유지)
dept_points AS (
  SELECT p.department_id,
         COUNT(*)                AS sessions,
         ROUND(AVG(r.pct), 1)    AS avg_pct,
         ROUND(AVG(r.points), 1) AS avg_points,
         AVG(r.points)           AS avg_points_raw
  FROM v_round_score r
  JOIN participant p ON p.id = r.participant_id
  GROUP BY p.department_id
),
agg AS (
  SELECT dp.department_id,
         pt.sessions, pt.avg_pct, pt.avg_points,
         dp.participants,
         ROUND(dp.avg_participation * 100, 1) AS avg_participation_pct,
         ROUND(
             (pt.avg_points_raw / NULLIF(c.round_max_points, 0) * 100) * 0.5
           + (dp.avg_participation * 100) * 0.5
         , 1) AS composite_score
  FROM dept_participation dp
  JOIN dept_points pt ON pt.department_id = dp.department_id
  CROSS JOIN cfg c
)
SELECT RANK() OVER (ORDER BY a.composite_score DESC, a.participants DESC) AS rank,
       d.name AS department_name, u.name AS org_unit_name,
       a.participants, a.sessions, a.avg_pct, d.id AS department_id,
       a.avg_points,
       -- 기존 8컬럼 순서·타입 유지, 신규 2컬럼은 말미 추가(REPLACE VIEW 제약)
       a.composite_score,
       a.avg_participation_pct
FROM agg a
JOIN department d ON d.id = a.department_id
JOIN org_unit   u ON u.id = d.org_unit_id
WHERE a.participants >= (SELECT (value)::int FROM app_config
                          WHERE key = 'min_participants_for_dept')
ORDER BY rank;

-- ---------------------------------------------------------------------
-- ⑤ 소속 순위 (선택 노출. 부서 순위가 3명 미만으로 대부분 제외될 경우 대안)
--    F항 대안 경로 — 산식이 같아야 대안이므로 부서와 동일한 종합점수 적용.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_rank_org_unit AS
WITH cfg AS (
  SELECT (SELECT (value)::int FROM app_config WHERE key = 'items_per_round')
         * ( (SELECT (value)::int FROM app_config WHERE key = 'point_base')
           + (SELECT (value)::int FROM app_config WHERE key = 'point_time_bonus_max') )
           AS round_max_points,
         fn_open_rounds() AS open_rounds
),
per_participant AS (
  SELECT p.org_unit_id,
         r.participant_id,
         CASE WHEN c.open_rounds > 0
              THEN LEAST(COUNT(*)::numeric / c.open_rounds, 1)
              ELSE NULL END AS participation
  FROM v_round_score r
  JOIN participant p ON p.id = r.participant_id
  CROSS JOIN cfg c
  GROUP BY p.org_unit_id, r.participant_id, c.open_rounds
),
unit_participation AS (
  SELECT org_unit_id,
         COUNT(*)           AS participants,
         AVG(participation) AS avg_participation
  FROM per_participant
  GROUP BY org_unit_id
),
unit_points AS (
  SELECT p.org_unit_id,
         ROUND(AVG(r.pct), 1)    AS avg_pct,
         ROUND(AVG(r.points), 1) AS avg_points,
         AVG(r.points)           AS avg_points_raw
  FROM v_round_score r
  JOIN participant p ON p.id = r.participant_id
  GROUP BY p.org_unit_id
),
agg AS (
  SELECT up.org_unit_id, pt.avg_pct, pt.avg_points, up.participants,
         ROUND(up.avg_participation * 100, 1) AS avg_participation_pct,
         ROUND(
             (pt.avg_points_raw / NULLIF(c.round_max_points, 0) * 100) * 0.5
           + (up.avg_participation * 100) * 0.5
         , 1) AS composite_score
  FROM unit_participation up
  JOIN unit_points pt ON pt.org_unit_id = up.org_unit_id
  CROSS JOIN cfg c
)
SELECT RANK() OVER (ORDER BY a.composite_score DESC, a.participants DESC) AS rank,
       u.name AS org_unit_name, c.name AS category_name,
       a.participants, a.avg_pct, u.id AS org_unit_id,
       a.avg_points,
       a.composite_score,
       a.avg_participation_pct
FROM agg a
JOIN org_unit     u ON u.id = a.org_unit_id
JOIN org_category c ON c.code = u.category_code
WHERE a.participants >= (SELECT (value)::int FROM app_config
                          WHERE key = 'min_participants_for_unit')
ORDER BY rank;

-- =====================================================================
-- [배포 후 1회 DML] — 신버전 앱(cron의 total 적재 제거) 배포가 끝난 뒤 실행.
-- 먼저 실행하면 구버전 cron이 1분 내에 재삽입한다.
-- 적재 중단만 하면 round 외 kind는 삭제 경로가 없어 옛 payload가 영구 잔류한다.
-- =====================================================================
-- DELETE FROM ranking_snapshot WHERE kind = 'total';

-- =====================================================================
-- [롤백] — 산식을 되돌려야 할 때만 아래 블록 전체를 실행한다.
-- 뷰가 fn_open_rounds()를 참조하므로 뷰를 먼저 구버전으로 교체한 뒤 함수를 지운다.
-- =====================================================================
-- CREATE OR REPLACE VIEW v_rank_department AS
-- WITH agg AS (
--   SELECT p.department_id,
--          COUNT(DISTINCT r.participant_id) AS participants,
--          COUNT(*)                         AS sessions,
--          ROUND(AVG(r.pct), 1)             AS avg_pct,
--          ROUND(AVG(r.points), 1)          AS avg_points
--   FROM v_round_score r
--   JOIN participant p ON p.id = r.participant_id
--   GROUP BY p.department_id
-- )
-- SELECT RANK() OVER (ORDER BY a.avg_points DESC, a.participants DESC) AS rank,
--        d.name AS department_name, u.name AS org_unit_name,
--        a.participants, a.sessions, a.avg_pct, d.id AS department_id,
--        a.avg_points
-- FROM agg a
-- JOIN department d ON d.id = a.department_id
-- JOIN org_unit   u ON u.id = d.org_unit_id
-- WHERE a.participants >= (SELECT (value)::int FROM app_config
--                           WHERE key = 'min_participants_for_dept')
-- ORDER BY rank;
-- ※ 위 구버전은 컬럼이 8개라 CREATE OR REPLACE로 10컬럼 뷰를 대체할 수 없다.
--   실제 롤백은 DROP VIEW v_rank_department; 후 CREATE VIEW로 실행할 것.
--   (v_rank_org_unit도 동일 — db/05_views.sql의 git 이력에서 원문 복원)
-- DROP FUNCTION IF EXISTS fn_open_rounds();
