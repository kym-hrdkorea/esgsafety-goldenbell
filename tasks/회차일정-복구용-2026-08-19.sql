-- 회차 일정·공개상태 원상복구 SQL
-- 생성: 2026-08-19, 임시 테스트용 전체 개방 직전의 실DB 값
-- 사용: 테스트가 끝나면 이 6줄을 Supabase SQL Editor에서 그대로 실행하면 원래대로 돌아간다.
-- 주의: 이 값은 옛 확정 일정(2026-08-17 개시)이다. 새 운영 일정이 확정되면
--       이 파일이 아니라 새 일정으로 UPDATE하고 db/03_seed_rounds.sql도 함께 고친다.

UPDATE quiz_round SET opens_at='2026-08-16 15:00:00+00', closes_at='2026-08-21 14:59:59+00', is_published=false WHERE round_no=1;
UPDATE quiz_round SET opens_at='2026-08-23 15:00:00+00', closes_at='2026-08-28 14:59:59+00', is_published=false WHERE round_no=2;
UPDATE quiz_round SET opens_at='2026-08-30 15:00:00+00', closes_at='2026-09-04 14:59:59+00', is_published=false WHERE round_no=3;
UPDATE quiz_round SET opens_at='2026-09-06 15:00:00+00', closes_at='2026-09-11 14:59:59+00', is_published=false WHERE round_no=4;
UPDATE quiz_round SET opens_at='2026-09-13 15:00:00+00', closes_at='2026-09-18 14:59:59+00', is_published=false WHERE round_no=5;
UPDATE quiz_round SET opens_at='2026-09-20 15:00:00+00', closes_at='2026-09-25 14:59:59+00', is_published=false WHERE round_no=6;
