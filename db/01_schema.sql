-- =====================================================================
-- HRDK 안전 골든벨 퀴즈 리그 — 스키마 DDL
-- 대상: Supabase (PostgreSQL 15+)
-- 실행: Supabase SQL Editor에서 01 → 02 → 03 → 04 → 05 순서로 실행
--
-- [설계 원칙]
--  1. RLS 사용하지 않음. 모든 DB 접근은 Next.js Route Handler(서버)에서
--     service_role 키로만 수행한다. 브라우저에서 Supabase 직접 호출 금지.
--  2. 타이머·채점·셔플은 전부 서버 권위(server-authoritative).
--     클라이언트가 보낸 시간·정답 여부는 신뢰하지 않는다.
--  3. 정답·해설은 답변 전(answered_at IS NULL)에는 응답에 포함하지 않는다.
--     답변 후(해설 단계)에는 반환한다(해설 새로고침 복구). measure_code /
--     anchor_code / level 은 단계 무관 영구 금지. → CLAUDE.md 규칙 2·2-1, addendum A항
--  4. 시각은 전부 timestamptz. 애플리케이션 기준 시간대는 Asia/Seoul.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. 운영 파라미터 (재배포 없이 조정 가능)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_config (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_config (key, value, description) VALUES
  ('item_time_limit_sec',       '45',   '문항당 제한시간(초)'),
  ('session_timeout_min',       '30',   '해설 화면 방치 허용 시간(분). 초과 시 회차 종료 처리'),
  ('items_per_round',           '12',   '회차당 문항 수'),
  ('min_rounds_for_ranking',    '3',    '누적·평균 순위 반영 최소 응시 회차'),
  ('min_participants_for_dept', '3',    '부서 순위 노출 최소 참여자 수'),
  ('min_participants_for_unit', '5',    '소속 순위 노출 최소 참여자 수'),
  ('rank_visible_rows',         '5',    '순위표 기본 표시 행 수(더보기 전)'),
  ('rank_max_rows',             '20',   '순위표 최대 표시 행 수'),
  ('login_max_attempts',        '5',    '로그인 연속 실패 허용 횟수'),
  ('login_lock_minutes',        '15',   '로그인 잠금 시간(분)'),
  ('admin_max_attempts',        '10',   '관리자 로그인 연속 실패 허용 횟수'),
  ('admin_lock_minutes',        '10',   '관리자 로그인 잠금 시간(분)'),
  -- 아래 2건은 T03에서 승인된 DML(addendum N항)로 실DB에 먼저 추가된 키다.
  -- P5 2회차 감사 지적에 따라 시드 파일을 실DB와 정합시킨다 (fresh DB 재구축 대비).
  ('point_base',                '100',  '포인트 기본점(정답 시). business-rules 5.0, addendum N항'),
  ('point_time_bonus_max',      '100',  '포인트 시간 보너스 최대치(잔여시간 비례). business-rules 5.0, addendum N항')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 1. 조직 (2단 드롭다운: org_unit → department)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_category (
  code       text PRIMARY KEY,           -- HQ / AFF / BR / EPS
  name       text NOT NULL,
  sort_order int  NOT NULL
);

CREATE TABLE IF NOT EXISTS org_unit (
  id            serial PRIMARY KEY,
  category_code text NOT NULL REFERENCES org_category(code),
  name          text NOT NULL,
  sort_order    int  NOT NULL,
  UNIQUE (category_code, name)
);

CREATE TABLE IF NOT EXISTS department (
  id          serial PRIMARY KEY,
  org_unit_id int  NOT NULL REFERENCES org_unit(id),
  name        text NOT NULL,
  sort_order  int  NOT NULL,
  UNIQUE (org_unit_id, name)
);
CREATE INDEX IF NOT EXISTS idx_department_unit ON department(org_unit_id);

-- 부서 구분이 없는 소속(ESG안전센터·홍보미디어실·국외 EPS 등)은
-- 소속과 동일한 이름의 department 1건을 갖는다. 드롭다운 2단 구조를 균일하게 유지.

-- ---------------------------------------------------------------------
-- 2. 참가자
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS participant (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emp_no          text NOT NULL UNIQUE,           -- 사번
  nickname        text NOT NULL UNIQUE,           -- 가입 후 변경 불가 (수정 API 없음)
  password_hash   text NOT NULL,                  -- bcrypt(4자리 PIN). 평문 저장 금지
  department_id   int  NOT NULL REFERENCES department(id),
  org_unit_id     int  NOT NULL REFERENCES org_unit(id),  -- 비정규화(순위 쿼리용)
  failed_attempts int  NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_participant_dept ON participant(department_id);
CREATE INDEX IF NOT EXISTS idx_participant_unit ON participant(org_unit_id);

-- 수집 항목은 사번·닉네임·PIN해시·소속/부서뿐. 이름·이메일·연락처는 수집하지 않는다.

-- ---------------------------------------------------------------------
-- 3. 회차
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quiz_round (
  round_no          int  PRIMARY KEY CHECK (round_no BETWEEN 1 AND 8),
  season            int  NOT NULL CHECK (season IN (1, 2)),
  theme             text NOT NULL,
  opens_at          timestamptz NOT NULL,   -- 월요일 00:00 KST
  closes_at         timestamptz NOT NULL,   -- 금요일 23:59:59 KST
  prelearning_title text,
  prelearning_body  text,                   -- 사전학습 정적 페이지 본문(markdown)
  is_published      boolean NOT NULL DEFAULT false,
  CHECK (closes_at > opens_at)
);

-- 개방 판정은 항상 서버에서: is_published AND now() BETWEEN opens_at AND closes_at
-- 종료된 회차의 문항·해설은 복습 모드로 계속 열람 가능(점수 미반영).

-- ---------------------------------------------------------------------
-- 4. 문항
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quiz_item (
  id           serial PRIMARY KEY,
  item_code    text NOT NULL UNIQUE,          -- '1-01'
  round_no     int  NOT NULL REFERENCES quiz_round(round_no),
  seq_no       int  NOT NULL,                 -- 마스터 시트상 관리 번호
  item_type    text NOT NULL CHECK (item_type IN ('OX','MC4','ORDER','SHORT')),
  level        text NOT NULL CHECK (level IN ('L1','L2','L3')),
  category     text,                          -- F/E/G/O/H/L/K/S (측정문항은 NULL)
  anchor_code  text CHECK (anchor_code IN ('A1','A2')),
  measure_code text,                          -- M01~M12 / M01P~M12P / T01~T04
  stem         text NOT NULL,
  choices      jsonb,                         -- MC4/ORDER만. OX·SHORT는 NULL
  answer       jsonb NOT NULL,                -- ★ 절대 클라이언트로 전송 금지
  explanation  text NOT NULL,
  legal_ref    text,
  admin_note   text,
  UNIQUE (round_no, seq_no)
);
CREATE INDEX IF NOT EXISTS idx_item_round ON quiz_item(round_no);

-- answer 자료형 (item_type별)
--   OX    : true | false
--   MC4   : 0~3 (choices 배열의 원본 인덱스)
--   ORDER : [1,3,0,2]  (choices 원본 인덱스의 정답 순서)
--   SHORT : ["아차사고","아차 사고"]  (허용 문자열 배열, 정규화 후 완전일치)

-- ---------------------------------------------------------------------
-- 5. 응시 세션
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quiz_session (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id   uuid NOT NULL REFERENCES participant(id),
  round_no         int  NOT NULL REFERENCES quiz_round(round_no),
  status           text NOT NULL DEFAULT 'in_progress'
                     CHECK (status IN ('in_progress','completed','expired')),
  current_index    int  NOT NULL DEFAULT 0,    -- 0부터. 다음에 서빙할 seq
  total_items      int  NOT NULL,
  score            int  NOT NULL DEFAULT 0,
  started_at       timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  UNIQUE (participant_id, round_no)            -- ★ 1인 1회차 1회. 재응시 불가
);
CREATE INDEX IF NOT EXISTS idx_session_round ON quiz_session(round_no, status);

CREATE TABLE IF NOT EXISTS quiz_session_item (
  id           bigserial PRIMARY KEY,
  session_id   uuid NOT NULL REFERENCES quiz_session(id) ON DELETE CASCADE,
  item_id      int  NOT NULL REFERENCES quiz_item(id),
  seq          int  NOT NULL,                 -- 이 세션에서의 출제 순번 0~11
  choice_order jsonb,                         -- 셔플 결과. 표시순 → 원본 인덱스 매핑
  served_at    timestamptz,                   -- ★ 서버 타이머 기준점
  answered_at  timestamptz,
  submitted    jsonb,                         -- 사용자 응답(표시순 기준 아님, 원본 인덱스로 변환 저장)
  is_correct   boolean,
  is_timeout   boolean NOT NULL DEFAULT false,
  elapsed_ms   int,
  UNIQUE (session_id, seq),
  UNIQUE (session_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_sitem_item ON quiz_session_item(item_id);

-- 세션 생성 시 12개 행을 미리 만들고 문항 순서·선택지 순서를 확정 저장한다.
-- 매 요청마다 다시 섞으면 정답 판정이 어긋난다.

-- ---------------------------------------------------------------------
-- 6. 사전학습 열람 로그  (성과지표: 열람자 vs 미열람자 정답률)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prelearning_view (
  id             bigserial PRIMARY KEY,
  participant_id uuid NOT NULL REFERENCES participant(id),
  round_no       int  NOT NULL REFERENCES quiz_round(round_no),
  viewed_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_prelearn
  ON prelearning_view(participant_id, round_no);

-- ---------------------------------------------------------------------
-- 7. 순위 스냅샷 (대시보드 부하 차단용)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ranking_snapshot (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN
                ('total','round','average','department','org_unit')),
  round_no    int,                             -- kind='round'일 때만
  payload     jsonb NOT NULL,                  -- 순위 배열(최대 rank_max_rows)
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ranking
  ON ranking_snapshot(kind, COALESCE(round_no, -1));

-- 대시보드는 이 테이블만 읽는다. 뷰를 직접 조회하지 않는다.
-- 갱신: /api/cron/refresh-rankings (60초 주기 또는 제출 시 debounce)

-- ---------------------------------------------------------------------
-- 8. 관리자
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_user (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login_id        text NOT NULL UNIQUE,
  password_hash   text NOT NULL,
  failed_attempts int  NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at   timestamptz
);

-- 잠금 컬럼은 participant와 동일 패턴이다. 로그인 잠금 로직을 그대로 재사용한다.
-- 임계값은 참가자보다 완화한다: 10회 실패 → 10분 잠금 (app_config 참조).
-- ★ 운영자가 잠기면 Supabase 대시보드에서 아래로 즉시 해제할 수 있다.
--   UPDATE admin_user SET failed_attempts = 0, locked_until = NULL WHERE login_id = '...';

-- 관리자 기능은 조회·CSV 내려받기만. 문항 CRUD UI는 만들지 않는다.
-- 문항 수정은 Supabase 대시보드에서 직접 수행.
