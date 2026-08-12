-- =====================================================================
-- 07_session_functions.sql : 세션 생성·점수·만료 원자 함수 (T19)
--
-- 이 파일은 로컬 변경분이다. Supabase SQL Editor에는 T21의 백업·행 수
-- 확인과 별도 승인 후에만 실행한다.
--
-- fn_create_quiz_session
--   세션 1행과 quiz_session_item 12행을 하나의 DB 트랜잭션에서 생성한다.
--   (participant_id, round_no) UNIQUE 경합은 함수 호출 전체가 대기한 뒤
--   23505로 끝나므로, 호출자는 이미 커밋된 세션을 다시 읽을 수 있다.
--
-- fn_reconcile_quiz_session
--   세션 행을 FOR UPDATE로 잠근 뒤 확정 문항에서 score를 재계산한다.
--   동시에 답변이 확정되어도 오래된 score가 나중에 덮어쓰이지 않는다.
--
-- fn_expire_quiz_session
--   세션 행을 잠근 뒤 미응답 문항을 timeout으로 확정하고 score/status를
--   함께 갱신한다. 이미 완료·만료된 세션은 멱등적으로 그대로 반환한다.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_create_quiz_session(
  p_participant_id uuid,
  p_round_no integer,
  p_items jsonb
)
RETURNS TABLE (
  id uuid,
  participant_id uuid,
  round_no integer,
  status text,
  current_index integer,
  total_items integer,
  score integer,
  last_activity_at timestamptz
)
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_session_id uuid;
  v_row_count integer;
BEGIN
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_items) <> 12 THEN
    RAISE EXCEPTION '세션 문항 수는 12개여야 합니다' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items)
      AS item(item_id integer, seq integer, choice_order jsonb)
    WHERE item.item_id IS NULL
       OR item.seq IS NULL
       OR item.seq < 0
       OR item.seq > 11
  ) THEN
    RAISE EXCEPTION '세션 문항 형식이 올바르지 않습니다' USING ERRCODE = '22023';
  END IF;

  IF (
    SELECT COUNT(DISTINCT item.item_id)
    FROM jsonb_to_recordset(p_items)
      AS item(item_id integer, seq integer, choice_order jsonb)
  ) <> 12
  OR (
    SELECT COUNT(DISTINCT item.seq)
    FROM jsonb_to_recordset(p_items)
      AS item(item_id integer, seq integer, choice_order jsonb)
  ) <> 12 THEN
    RAISE EXCEPTION '세션 문항 ID와 순번은 중복될 수 없습니다' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items)
      AS item(item_id integer, seq integer, choice_order jsonb)
    LEFT JOIN public.quiz_item AS qi
      ON qi.id = item.item_id
     AND qi.round_no = p_round_no
    WHERE qi.id IS NULL
  ) THEN
    RAISE EXCEPTION '세션 문항이 해당 회차에 속하지 않습니다' USING ERRCODE = '23503';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items)
      AS item(item_id integer, seq integer, choice_order jsonb)
    JOIN public.quiz_item AS qi ON qi.id = item.item_id
    WHERE (qi.item_type IN ('MC4', 'ORDER')
           AND jsonb_typeof(item.choice_order) IS DISTINCT FROM 'array')
       OR (qi.item_type IN ('OX', 'SHORT')
           AND item.choice_order IS NOT NULL)
  ) THEN
    RAISE EXCEPTION '문항 선택지 셔플 형식이 올바르지 않습니다' USING ERRCODE = '22023';
  END IF;

  -- UNIQUE(participant_id, round_no)가 동시 요청을 직렬화한다.
  INSERT INTO public.quiz_session
    (participant_id, round_no, total_items)
  VALUES
    (p_participant_id, p_round_no, 12)
  RETURNING quiz_session.id INTO v_session_id;

  INSERT INTO public.quiz_session_item
    (session_id, item_id, seq, choice_order)
  SELECT v_session_id, item.item_id, item.seq, item.choice_order
  FROM jsonb_to_recordset(p_items)
    AS item(item_id integer, seq integer, choice_order jsonb);

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count <> 12 THEN
    RAISE EXCEPTION '세션 문항 생성 수가 12개가 아닙니다' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT s.id, s.participant_id, s.round_no, s.status,
         s.current_index, s.total_items, s.score, s.last_activity_at
  FROM public.quiz_session AS s
  WHERE s.id = v_session_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_reconcile_quiz_session(
  p_session_id uuid,
  p_complete boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  participant_id uuid,
  round_no integer,
  status text,
  current_index integer,
  total_items integer,
  score integer,
  last_activity_at timestamptz
)
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_session public.quiz_session%ROWTYPE;
  v_score integer;
  v_confirmed integer;
BEGIN
  SELECT s.* INTO v_session
  FROM public.quiz_session AS s
  WHERE s.id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '세션을 찾을 수 없습니다' USING ERRCODE = 'P0002';
  END IF;

  SELECT
    (COUNT(*) FILTER (WHERE si.is_correct IS TRUE))::integer,
    (COUNT(*) FILTER (
      WHERE si.answered_at IS NOT NULL OR si.is_timeout
    ))::integer
  INTO v_score, v_confirmed
  FROM public.quiz_session_item AS si
  WHERE si.session_id = p_session_id;

  IF v_session.status = 'in_progress' THEN
    -- p_complete은 마지막 문항 재시도 의도이지만, 확정 12개가 없으면
    -- 어떤 호출도 미완료 세션을 completed로 만들 수 없다.
    IF v_confirmed >= v_session.total_items
       AND (p_complete OR v_confirmed = v_session.total_items) THEN
      UPDATE public.quiz_session AS s
      SET score = v_score,
          status = 'completed',
          completed_at = COALESCE(s.completed_at, now()),
          last_activity_at = now()
      WHERE s.id = p_session_id;
    ELSE
      UPDATE public.quiz_session AS s
      SET score = v_score,
          last_activity_at = now()
      WHERE s.id = p_session_id;
    END IF;
  ELSE
    -- 완료·만료 상태는 되돌리지 않되, 부분 실패로 남은 score는 복구한다.
    UPDATE public.quiz_session AS s
    SET score = v_score
    WHERE s.id = p_session_id;
  END IF;

  RETURN QUERY
  SELECT s.id, s.participant_id, s.round_no, s.status,
         s.current_index, s.total_items, s.score, s.last_activity_at
  FROM public.quiz_session AS s
  WHERE s.id = p_session_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_expire_quiz_session(
  p_session_id uuid
)
RETURNS TABLE (
  id uuid,
  participant_id uuid,
  round_no integer,
  status text,
  current_index integer,
  total_items integer,
  score integer,
  last_activity_at timestamptz
)
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_session public.quiz_session%ROWTYPE;
  v_score integer;
BEGIN
  SELECT s.* INTO v_session
  FROM public.quiz_session AS s
  WHERE s.id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '세션을 찾을 수 없습니다' USING ERRCODE = 'P0002';
  END IF;

  IF v_session.status = 'in_progress' THEN
    UPDATE public.quiz_session_item AS si
    SET is_timeout = true,
        is_correct = false,
        submitted = NULL
    WHERE si.session_id = p_session_id
      AND si.answered_at IS NULL
      AND si.is_timeout = false;

    SELECT COUNT(*) FILTER (WHERE si.is_correct IS TRUE)::integer
    INTO v_score
    FROM public.quiz_session_item AS si
    WHERE si.session_id = p_session_id;

    UPDATE public.quiz_session AS s
    SET status = 'expired',
        completed_at = COALESCE(s.completed_at, now()),
        score = v_score
    WHERE s.id = p_session_id;
  END IF;

  RETURN QUERY
  SELECT s.id, s.participant_id, s.round_no, s.status,
         s.current_index, s.total_items, s.score, s.last_activity_at
  FROM public.quiz_session AS s
  WHERE s.id = p_session_id;
END;
$function$;

COMMENT ON FUNCTION public.fn_create_quiz_session(uuid, integer, jsonb)
  IS 'T19: 세션 1행과 회차 문항 12행을 원자적으로 생성';
COMMENT ON FUNCTION public.fn_reconcile_quiz_session(uuid, boolean)
  IS 'T19: 세션 잠금 후 확정 문항에서 점수·완료 상태를 재계산';
COMMENT ON FUNCTION public.fn_expire_quiz_session(uuid)
  IS 'T19: 세션 잠금 후 미응답 문항을 timeout 처리하고 만료';

-- 함수는 클라이언트에서 직접 호출하지 않고 service_role 서버 경로에서만 호출한다.
REVOKE ALL ON FUNCTION public.fn_create_quiz_session(uuid, integer, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_reconcile_quiz_session(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_expire_quiz_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_create_quiz_session(uuid, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_reconcile_quiz_session(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_expire_quiz_session(uuid) TO service_role;

COMMIT;
