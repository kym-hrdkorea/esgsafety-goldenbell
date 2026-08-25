-- 회차 일정 복구용 (2026-08-25 생성)
-- 종료 상황 재현 DML(회차 1~3 closes_at 과거로 UPDATE) 직전의 실DB 실측값이다.
-- 검증이 끝나면 이 6줄을 그대로 실행해 원상복구한다.
-- ※ 이 값은 임시 테스트용 전체 개방 일정(2026-08-19 00:00 ~ 09-26 KST 직전)이다.
--    운영 일정(9/1~10/9)이 반영된 뒤에는 이 파일을 쓰지 말 것 —
--    tasks/회차일정-복구용-2026-08-19.sql과 같은 이유로 만료된 기록이 된다.
UPDATE quiz_round SET opens_at = '2026-08-18T15:00:00+00:00', closes_at = '2026-09-25T14:59:59+00:00', is_published = true WHERE round_no = 1;
UPDATE quiz_round SET opens_at = '2026-08-18T15:00:00+00:00', closes_at = '2026-09-25T14:59:59+00:00', is_published = true WHERE round_no = 2;
UPDATE quiz_round SET opens_at = '2026-08-18T15:00:00+00:00', closes_at = '2026-09-25T14:59:59+00:00', is_published = true WHERE round_no = 3;
UPDATE quiz_round SET opens_at = '2026-08-18T15:00:00+00:00', closes_at = '2026-09-25T14:59:59+00:00', is_published = true WHERE round_no = 4;
UPDATE quiz_round SET opens_at = '2026-08-18T15:00:00+00:00', closes_at = '2026-09-25T14:59:59+00:00', is_published = true WHERE round_no = 5;
UPDATE quiz_round SET opens_at = '2026-08-18T15:00:00+00:00', closes_at = '2026-09-25T14:59:59+00:00', is_published = true WHERE round_no = 6;
