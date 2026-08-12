-- =====================================================================
-- 05_views.sql : 순위 · 성과분석 뷰
--
-- ★ 대시보드는 이 뷰를 직접 조회하지 않는다.
--   refresh-rankings 작업이 뷰를 읽어 ranking_snapshot에 적재하고,
--   대시보드는 snapshot만 읽는다. (집계 부하 차단)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 기초: 참가자 × 회차 점수 + 포인트 (N항, business-rules 5.0)
--   points = Σ 문항 포인트.
--     정답:        point_base + ROUND(point_time_bonus_max
--                  × GREATEST(제한시간ms - elapsed_ms, 0) / 제한시간ms)
--     오답·시간초과: 0
--   시간 요소는 문항별 답변 시간(elapsed_ms)뿐 — 해설 열람 시간·세션 총
--   소요시간은 어떤 지표에도 쓰지 않는다. 산식 파라미터 3종은 app_config에서
--   읽으며(규칙 7) lib/grading.ts calcItemPoints와 동일식이다.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_round_score AS
WITH cfg AS (
  SELECT (SELECT (value)::int FROM app_config WHERE key = 'point_base')                 AS base,
         (SELECT (value)::int FROM app_config WHERE key = 'point_time_bonus_max')       AS bonus,
         (SELECT (value)::int FROM app_config WHERE key = 'item_time_limit_sec') * 1000 AS limit_ms
),
item_points AS (
  SELECT si.session_id,
         SUM(CASE WHEN si.is_correct AND NOT si.is_timeout
                  THEN c.base + ROUND(c.bonus * GREATEST(c.limit_ms - COALESCE(si.elapsed_ms, c.limit_ms), 0)::numeric / c.limit_ms)
                  ELSE 0 END)::int AS points
  FROM quiz_session_item si
  CROSS JOIN cfg c
  GROUP BY si.session_id
)
SELECT s.participant_id,
       s.round_no,
       s.score,
       s.total_items,
       ROUND(s.score::numeric / NULLIF(s.total_items, 0) * 100, 1) AS pct,
       s.completed_at,
       COALESCE(ip.points, 0) AS points
FROM quiz_session s
LEFT JOIN item_points ip ON ip.session_id = s.id
WHERE s.status IN ('completed', 'expired');
-- expired(30분 초과)도 포함한다. 미응답은 오답으로 확정되어 있으므로
-- 점수에 이미 반영되어 있고, 제외하면 소속 평균이 왜곡된다.
-- score·pct 컬럼은 유지한다 — 성과분석(⑪ 등)·결과 화면은 정답 수 기준이다(N항).

-- ---------------------------------------------------------------------
-- 최소 응시 회차 임계값
-- 결정③: 기본 3회. 단 캠페인 공개 회차가 2 이하인 기간에는 0(조건 없음).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_min_rounds() RETURNS int
LANGUAGE sql STABLE AS $$
  SELECT CASE
           WHEN (SELECT count(*) FROM quiz_round
                  WHERE is_published AND opens_at <= now()) <= 2
             THEN 0
           ELSE (SELECT (value)::int FROM app_config
                  WHERE key = 'min_rounds_for_ranking')
         END;
$$;

-- ---------------------------------------------------------------------
-- ① 전체 회차 누적 순위 (N항: 포인트 기준)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_rank_total AS
WITH agg AS (
  SELECT participant_id,
         SUM(score)   AS total_score,
         COUNT(*)     AS rounds_taken,
         SUM(total_items) AS total_possible,
         SUM(points)  AS total_points
  FROM v_round_score
  GROUP BY participant_id
)
SELECT RANK() OVER (ORDER BY a.total_points DESC) AS rank,
       p.nickname, u.name AS org_unit_name, d.name AS department_name,
       a.total_score, a.rounds_taken, a.total_possible, p.id AS participant_id,
       a.total_points
FROM agg a
JOIN participant p ON p.id = a.participant_id
JOIN org_unit   u ON u.id = p.org_unit_id
JOIN department d ON d.id = p.department_id
WHERE a.rounds_taken >= fn_min_rounds()
ORDER BY rank;
-- 동점자는 RANK()로 공동 순위(1,2,2,4).
-- 세션 총 소요시간·해설 열람 시간 정렬은 쓰지 않는다(N항 정밀화) —
-- 시간 변별은 v_round_score.points(문항별 답변 시간)로만 반영된다.

-- ---------------------------------------------------------------------
-- ② 회차별 순위 (N항: 포인트 기준. score·pct는 표시용으로 유지 — G10 계약)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_rank_round AS
SELECT r.round_no,
       RANK() OVER (PARTITION BY r.round_no ORDER BY r.points DESC) AS rank,
       p.nickname, u.name AS org_unit_name, d.name AS department_name,
       r.score, r.total_items, r.pct, p.id AS participant_id,
       r.points
FROM v_round_score r
JOIN participant p ON p.id = r.participant_id
JOIN org_unit   u ON u.id = p.org_unit_id
JOIN department d ON d.id = p.department_id
ORDER BY r.round_no, rank;

-- ---------------------------------------------------------------------
-- ③ 평균 포인트 순위 (누적과 동일한 최소 회차 조건 적용, N항)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_rank_average AS
WITH agg AS (
  SELECT participant_id,
         COUNT(*) AS rounds_taken,
         ROUND(AVG(pct), 1) AS avg_pct,
         SUM(score) AS total_score,
         ROUND(AVG(points), 1) AS avg_points
  FROM v_round_score
  GROUP BY participant_id
)
SELECT RANK() OVER (ORDER BY a.avg_points DESC, a.rounds_taken DESC) AS rank,
       p.nickname, u.name AS org_unit_name, d.name AS department_name,
       a.avg_pct, a.rounds_taken, p.id AS participant_id,
       a.avg_points
FROM agg a
JOIN participant p ON p.id = a.participant_id
JOIN org_unit   u ON u.id = p.org_unit_id
JOIN department d ON d.id = p.department_id
WHERE a.rounds_taken >= fn_min_rounds()
ORDER BY rank;
-- 동점 시 응시 회차 많은 쪽 우선 — 지속 참여를 보상한다(5.2).

-- ---------------------------------------------------------------------
-- ④ 부서 순위 (결정④: 참여자 3명 이상)
--    지표는 평균 포인트(N항). 정원 데이터가 없으므로 참여율은 쓰지 않는다.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_rank_department AS
WITH agg AS (
  SELECT p.department_id,
         COUNT(DISTINCT r.participant_id) AS participants,
         COUNT(*)                         AS sessions,
         ROUND(AVG(r.pct), 1)             AS avg_pct,
         ROUND(AVG(r.points), 1)          AS avg_points
  FROM v_round_score r
  JOIN participant p ON p.id = r.participant_id
  GROUP BY p.department_id
)
SELECT RANK() OVER (ORDER BY a.avg_points DESC, a.participants DESC) AS rank,
       d.name AS department_name, u.name AS org_unit_name,
       a.participants, a.sessions, a.avg_pct, d.id AS department_id,
       a.avg_points
FROM agg a
JOIN department d ON d.id = a.department_id
JOIN org_unit   u ON u.id = d.org_unit_id
WHERE a.participants >= (SELECT (value)::int FROM app_config
                          WHERE key = 'min_participants_for_dept')
ORDER BY rank;

-- ---------------------------------------------------------------------
-- ⑤ 소속 순위 (선택 노출. 부서 순위가 3명 미만으로 대부분 제외될 경우 대안)
--    지표는 평균 포인트(N항). F항에 따라 refresh-rankings가 함께 적재한다.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_rank_org_unit AS
WITH agg AS (
  SELECT p.org_unit_id,
         COUNT(DISTINCT r.participant_id) AS participants,
         ROUND(AVG(r.pct), 1)             AS avg_pct,
         ROUND(AVG(r.points), 1)          AS avg_points
  FROM v_round_score r
  JOIN participant p ON p.id = r.participant_id
  GROUP BY p.org_unit_id
)
SELECT RANK() OVER (ORDER BY a.avg_points DESC, a.participants DESC) AS rank,
       u.name AS org_unit_name, c.name AS category_name,
       a.participants, a.avg_pct, u.id AS org_unit_id,
       a.avg_points
FROM agg a
JOIN org_unit     u ON u.id = a.org_unit_id
JOIN org_category c ON c.code = u.category_code
WHERE a.participants >= (SELECT (value)::int FROM app_config
                          WHERE key = 'min_participants_for_unit')
ORDER BY rank;

-- =====================================================================
-- 성과분석 뷰 (관리자 전용 · 대시보드 미노출)
-- =====================================================================

-- ⑥ 문항 난이도(P) · 변별도(D)
--   [수정] 사분위를 '참가자 총점' 기준으로 산출한다. 이전 버전은 문항-응답 행 집합에
--   NTILE을 걸어 사분위 경계가 참가자 단위와 어긋났다.
--   [수정] 미서빙 행(answered_at IS NULL AND NOT is_timeout)을 분모에서 제외한다.
CREATE OR REPLACE VIEW v_item_stats AS
WITH sess AS (
  SELECT participant_id, SUM(score) AS total_score
  FROM quiz_session
  WHERE status IN ('completed','expired')
  GROUP BY participant_id
),
pq AS (
  SELECT participant_id, NTILE(4) OVER (ORDER BY total_score DESC) AS quartile
  FROM sess
),
resp AS (
  SELECT si.item_id, si.is_correct, si.is_timeout, s.participant_id
  FROM quiz_session_item si
  JOIN quiz_session s ON s.id = si.session_id
  WHERE si.answered_at IS NOT NULL OR si.is_timeout
)
SELECT i.item_code, i.round_no, i.level, i.item_type, i.category,
       i.anchor_code, i.measure_code,
       COUNT(*) AS n,
       ROUND(AVG(CASE WHEN r.is_correct THEN 1.0 ELSE 0 END) * 100, 1) AS p_value,
       ROUND(SUM(CASE WHEN r.is_timeout THEN 1 ELSE 0 END)::numeric
             / COUNT(*) * 100, 1) AS timeout_pct,
       ROUND(
         COALESCE(AVG(CASE WHEN q.quartile = 1
                           THEN (CASE WHEN r.is_correct THEN 1.0 ELSE 0 END) END), 0)
       - COALESCE(AVG(CASE WHEN q.quartile = 4
                           THEN (CASE WHEN r.is_correct THEN 1.0 ELSE 0 END) END), 0)
       , 3) AS discrimination
FROM quiz_item i
JOIN resp r ON r.item_id = i.id
JOIN pq   q ON q.participant_id = r.participant_id
GROUP BY i.id, i.item_code, i.round_no, i.level, i.item_type,
         i.category, i.anchor_code, i.measure_code
ORDER BY i.round_no, i.item_code;

-- ⑦ 앵커 성장곡선 (A1·A2 회차별 정답률 → 12개 측정점)
CREATE OR REPLACE VIEW v_anchor_trend AS
SELECT i.round_no, i.anchor_code,
       COUNT(*) AS n,
       ROUND(AVG(CASE WHEN si.is_correct THEN 1.0 ELSE 0 END) * 100, 1) AS pct
FROM quiz_session_item si
JOIN quiz_item i ON i.id = si.item_id
WHERE i.anchor_code IS NOT NULL
  AND (si.answered_at IS NOT NULL OR si.is_timeout)
GROUP BY i.round_no, i.anchor_code
ORDER BY i.anchor_code, i.round_no;

-- ⑧ 동일인 대조 사전·사후 (★ 캠페인 핵심 성과지표)
--    사전 M01~M12(1·2회차) / 사후 M01P~M12P(5·6회차) 모두 응시한 사람만
CREATE OR REPLACE VIEW v_matched_pre_post AS
WITH scored AS (
  SELECT s.participant_id,
         CASE WHEN i.measure_code ~ '^M\d{2}$'  THEN 'pre'
              WHEN i.measure_code ~ '^M\d{2}P$' THEN 'post' END AS phase,
         si.is_correct
  FROM quiz_session_item si
  JOIN quiz_session s ON s.id = si.session_id
  JOIN quiz_item    i ON i.id = si.item_id
  WHERE i.measure_code ~ '^M\d{2}P?$'
    AND (si.answered_at IS NOT NULL OR si.is_timeout)
),
agg AS (
  SELECT participant_id,
         SUM(CASE WHEN phase = 'pre'  THEN 1 ELSE 0 END) AS pre_n,
         SUM(CASE WHEN phase = 'post' THEN 1 ELSE 0 END) AS post_n,
         AVG(CASE WHEN phase = 'pre'  AND is_correct THEN 1.0
                  WHEN phase = 'pre'  THEN 0 END) * 100 AS pre_pct,
         AVG(CASE WHEN phase = 'post' AND is_correct THEN 1.0
                  WHEN phase = 'post' THEN 0 END) * 100 AS post_pct
  FROM scored GROUP BY participant_id
)
SELECT a.participant_id, p.nickname, u.name AS org_unit_name,
       a.pre_n, a.post_n,
       ROUND(a.pre_pct, 1)  AS pre_pct,
       ROUND(a.post_pct, 1) AS post_pct,
       ROUND(a.post_pct - a.pre_pct, 1) AS gain_pp
FROM agg a
JOIN participant p ON p.id = a.participant_id
JOIN org_unit    u ON u.id = p.org_unit_id
WHERE a.pre_n > 0 AND a.post_n > 0     -- ★ 양쪽 모두 응시한 사람만
ORDER BY gain_pp DESC;

-- ⑨ 전이검증 문항 정답률 (T01~T04)
CREATE OR REPLACE VIEW v_transfer_stats AS
SELECT i.item_code, i.round_no, COUNT(*) AS n,
       ROUND(AVG(CASE WHEN si.is_correct THEN 1.0 ELSE 0 END) * 100, 1) AS pct
FROM quiz_session_item si
JOIN quiz_item i ON i.id = si.item_id
WHERE i.measure_code ~ '^T\d{2}$'
  AND (si.answered_at IS NOT NULL OR si.is_timeout)
GROUP BY i.item_code, i.round_no
ORDER BY i.item_code;

-- ⑩ 취약영역 히트맵 (소속 × 영역)
CREATE OR REPLACE VIEW v_heatmap AS
SELECT u.name AS org_unit_name,
       COALESCE(i.category, 'MEASURE') AS category,
       COUNT(*) AS n,
       ROUND(AVG(CASE WHEN si.is_correct THEN 1.0 ELSE 0 END) * 100, 1) AS pct
FROM quiz_session_item si
JOIN quiz_session s ON s.id = si.session_id
JOIN quiz_item    i ON i.id = si.item_id
JOIN participant  p ON p.id = s.participant_id
JOIN org_unit     u ON u.id = p.org_unit_id
WHERE si.answered_at IS NOT NULL OR si.is_timeout
GROUP BY u.name, COALESCE(i.category, 'MEASURE')
ORDER BY u.name, category;

-- ⑪ 사전학습 열람 효과 (퀴즈 시작 전 열람자 vs 미열람자 정답률)
CREATE OR REPLACE VIEW v_prelearning_effect AS
SELECT r.round_no,
       (pv.participant_id IS NOT NULL) AS viewed,
       COUNT(*) AS n,
       ROUND(AVG(r.pct), 1) AS avg_pct
FROM v_round_score r
JOIN quiz_session s
       ON s.participant_id = r.participant_id AND s.round_no = r.round_no
LEFT JOIN prelearning_view pv
       ON pv.participant_id = r.participant_id
      AND pv.round_no = r.round_no
      AND pv.viewed_at <= s.started_at
GROUP BY r.round_no, (pv.participant_id IS NOT NULL)
ORDER BY r.round_no, viewed;

-- ⑫ 참여 지표
CREATE OR REPLACE VIEW v_participation AS
SELECT r.round_no,
       COUNT(DISTINCT s.participant_id) FILTER
         (WHERE s.status IN ('completed','expired')) AS finished,
       COUNT(DISTINCT s.participant_id)              AS started,
       (SELECT COUNT(*) FROM participant)            AS registered
FROM quiz_round r
LEFT JOIN quiz_session s ON s.round_no = r.round_no
GROUP BY r.round_no ORDER BY r.round_no;
