-- 2026-08-25 청렴 도입 개편에 따른 뷰 재생성 (사용자 승인 하 1회 실행)
-- 완전대응 쌍 수를 12로 하드코딩하던 것을 quiz_item에서 유도하도록 바꾼다.
-- 이 변경이 없으면 측정 9쌍 구성에서 v_matched_pre_post가 영구히 0행이 된다.

CREATE OR REPLACE VIEW v_matched_pre_post AS
-- 2026-08-25: 완전대응 기준 쌍 수를 12로 박아두면 문항 구성이 바뀔 때
-- 이 뷰가 조용히 0행이 된다(KPI 소멸). quiz_item에서 실제 쌍 수를 세어 쓴다.
WITH pair_count AS (
  SELECT COUNT(*)::int AS n FROM quiz_item WHERE measure_code ~ '^M\d{2}$'
),
scored AS (
  SELECT s.participant_id,
         CASE WHEN i.measure_code ~ '^M\d{2}$'  THEN 'pre'
              WHEN i.measure_code ~ '^M\d{2}P$' THEN 'post' END AS phase,
         i.measure_code,
         COALESCE(si.is_correct, false) AS is_correct
  FROM quiz_session_item si
  JOIN quiz_session s ON s.id = si.session_id
  JOIN quiz_item    i ON i.id = si.item_id
  WHERE s.status IN ('completed', 'expired')
    AND i.measure_code ~ '^M(0[1-9]|1[0-2])P?$'
    AND (si.answered_at IS NOT NULL OR si.is_timeout)
),
agg AS (
  SELECT participant_id,
         COUNT(DISTINCT measure_code) FILTER (WHERE phase = 'pre') AS pre_n,
         COUNT(DISTINCT measure_code) FILTER (WHERE phase = 'post') AS post_n,
         SUM(CASE WHEN phase = 'pre'  AND is_correct THEN 1 ELSE 0 END) AS pre_correct,
         SUM(CASE WHEN phase = 'post' AND is_correct THEN 1 ELSE 0 END) AS post_correct
  FROM scored GROUP BY participant_id
),
matched AS (
  SELECT a.participant_id, a.pre_n, a.post_n,
         ROUND((a.pre_correct::numeric / NULLIF(pc.n, 0)) * 100, 1) AS pre_pct,
         ROUND((a.post_correct::numeric / NULLIF(pc.n, 0)) * 100, 1) AS post_pct
  FROM agg a CROSS JOIN pair_count pc
  WHERE a.pre_n = pc.n AND a.post_n = pc.n
)
SELECT m.participant_id, p.nickname, u.name AS org_unit_name,
       m.pre_n, m.post_n,
       m.pre_pct,
       m.post_pct,
       ROUND(m.post_pct - m.pre_pct, 1) AS gain_pp
FROM matched m
JOIN participant p ON p.id = m.participant_id
JOIN org_unit    u ON u.id = p.org_unit_id
ORDER BY gain_pp DESC;

CREATE OR REPLACE VIEW v_matched_summary AS
SELECT COUNT(*)::int AS matched_n,
       (SELECT COUNT(*)::int FROM quiz_item WHERE measure_code ~ '^M\d{2}$') AS pair_count,
       ROUND(AVG(pre_pct), 1) AS pre_avg_pct,
       ROUND(AVG(post_pct), 1) AS post_avg_pct,
       ROUND(AVG(gain_pp), 1) AS mean_gain_pp,
       ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY gain_pp::double precision))::numeric, 1)
         AS median_gain_pp,
       COUNT(*) FILTER (WHERE gain_pp > 0)::int AS improved_n,
       ROUND(
         (COUNT(*) FILTER (WHERE gain_pp > 0)::numeric
           / NULLIF(COUNT(*), 0)::numeric) * 100,
         1
       ) AS improved_pct
FROM v_matched_pre_post;

CREATE OR REPLACE VIEW v_measure_pair_stats AS
WITH pair_codes AS (
  -- 실제 투입된 측정 코드만 행으로 만든다(미투입 코드의 빈 행 방지)
  SELECT DISTINCT regexp_replace(measure_code, 'P$', '') AS measure_code
  FROM quiz_item
  WHERE measure_code ~ '^M\d{2}P?$'
),
item_codes AS (
  SELECT regexp_replace(measure_code, 'P$', '') AS measure_code,
         MAX(item_code) FILTER (WHERE measure_code !~ 'P$') AS pre_item_code,
         MAX(item_code) FILTER (WHERE measure_code ~ 'P$')  AS post_item_code
  FROM quiz_item
  WHERE measure_code ~ '^M(0[1-9]|1[0-2])P?$'
  GROUP BY regexp_replace(measure_code, 'P$', '')
),
matched AS (
  SELECT participant_id
  FROM v_matched_pre_post
),
responses AS (
  SELECT s.participant_id,
         regexp_replace(i.measure_code, 'P$', '') AS measure_code,
         CASE WHEN i.measure_code ~ 'P$' THEN 'post' ELSE 'pre' END AS phase,
         (COALESCE(si.is_correct, false))::int AS is_correct
  FROM quiz_session_item si
  JOIN quiz_session s ON s.id = si.session_id
  JOIN quiz_item i ON i.id = si.item_id
  JOIN matched m ON m.participant_id = s.participant_id
  WHERE s.status IN ('completed', 'expired')
    AND i.measure_code ~ '^M(0[1-9]|1[0-2])P?$'
    AND (si.answered_at IS NOT NULL OR si.is_timeout)
),
pivoted AS (
  SELECT participant_id, measure_code,
         MAX(is_correct) FILTER (WHERE phase = 'pre')  AS pre_correct,
         MAX(is_correct) FILTER (WHERE phase = 'post') AS post_correct
  FROM responses
  GROUP BY participant_id, measure_code
)
SELECT p.measure_code,
       ic.pre_item_code,
       ic.post_item_code,
       COUNT(v.participant_id)::int AS n,
       ROUND((AVG(v.pre_correct)::numeric) * 100, 1) AS pre_pct,
       ROUND((AVG(v.post_correct)::numeric) * 100, 1) AS post_pct,
       ROUND(((AVG(v.post_correct) - AVG(v.pre_correct))::numeric) * 100, 1)
         AS gain_pp
FROM pair_codes p
LEFT JOIN pivoted v ON v.measure_code = p.measure_code
LEFT JOIN item_codes ic ON ic.measure_code = p.measure_code
GROUP BY p.measure_code, ic.pre_item_code, ic.post_item_code
ORDER BY p.measure_code;
