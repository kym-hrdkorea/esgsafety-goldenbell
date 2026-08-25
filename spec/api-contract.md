# API 계약서

- 모든 엔드포인트는 `app/api/**/route.ts`에 구현한다.
- 인증은 httpOnly 쿠키 세션. 미인증 시 `401 { code: "UNAUTHENTICATED" }`.
- 오류 응답 공통: `{ code: string, message: string }` (message는 한국어, 사용자 노출용)

## 인증

### `GET /api/org/units`
소속 목록. → `[{ id, name, categoryCode, categoryName }]`

### `GET /api/org/departments?unitId=`
해당 소속의 부서. → `[{ id, name }]`
- **`unitId` 생략 시** 전체 부서 + 소속명 반환(가입 화면 소속·부서 통합 검색용):
  `[{ id, name, orgUnitId, orgUnitName }]` — 소속 sort_order → 부서 sort_order 정렬
- `unitId`가 존재하나 무효(비정수·0 이하)면 `400 VALIDATION`

### `POST /api/auth/signup`
```
req  { empNo, nickname, departmentId, phone }
res  201 { participantId, nickname }
err  409 EMP_NO_TAKEN | NICKNAME_TAKEN, 400 VALIDATION
```
- `400 VALIDATION` 응답은 `{ code, field, message }` 형식이다. `field`는 `empNo`, `nickname`, `departmentId`, `phone`, `form` 중 하나이며, 가입 화면은 해당 입력란에 오류를 표시한다.
- `phone`은 하이픈·공백 허용 입력을 서버가 숫자만으로 정규화해 저장한다(`^01[016789]\d{7,8}$`).
  **비밀번호는 서버가 휴대폰 끝 4자리로 자동 설정한다**(P항). 별도 `pin` 필드는 받지 않는다.
- `orgUnitId`는 서버가 `departmentId`로부터 조회해 채운다. 클라이언트 값 무시.

### `POST /api/auth/login`
```
req  { empNo, pin }
res  200 { nickname, orgUnitName, departmentName }
err  401 INVALID_CREDENTIALS, 423 LOCKED { lockedUntil }
```

### `POST /api/auth/reset-pin`
비밀번호 자율 재설정. → addendum O항. 2026-08-20부터 휴대폰 재입력 방식(P항).
```
req  { empNo, nickname, departmentId, phone }
res  200 { ok: true }
err  401 VERIFICATION_FAILED, 429 TOO_MANY_REQUESTS, 400 VALIDATION
```
- 서버는 `phone`을 숫자만으로 정규화한 뒤 **끝 4자리로 `password_hash`를 재설정하고
  `participant.phone`도 함께 갱신**한다(연락처 변경 경로 겸용).
- 실패 응답은 **사번 부재·닉네임 불일치·부서 불일치를 구분하지 않는다**(열거 차단).
  세 조건을 단일 쿼리 WHERE에 넣어 핸들러가 "사번은 있는데 나머지가 틀렸다"는 사실을
  아예 갖지 못하게 한다.
- **`423`을 반환하지 않으며 `lockedUntil`을 노출하지 않는다.** 잠금은 존재하는 행만 갖는
  속성이라 잠금 파생 필드는 전부 존재 여부 오라클이다. 잠금 여부와 무관하게 처리한다.
- 실패는 `failed_attempts`를 증가시키지 않는다. 성공 시 `failed_attempts=0, locked_until=NULL`.
- **세션을 발급하지 않는다.** 성공 응답에 닉네임·부서명도 담지 않는다(`{ ok: true }`만).
- 응답 시간 하한 700ms — 성공·실패·검증오류·과다요청 전 경로에 적용(타이밍 채널 차단).

### `POST /api/auth/logout` → `204`
### `GET /api/me` → `{ nickname, orgUnitName, departmentName, totalScore, roundsTaken, averageRank }`
- `averageRank` = **평균 포인트 기준** 순위(홈 요약 카드용, 2026-08-25 포상 기준 개정).
  본인 행 1건만 `v_rank_average` 직접 조회 — addendum B항. 순위 미대상(미응시·최소 회차 미달)이면 `null`.

### `GET /api/me/stats`
내 기록 화면용(T11).
```
{ categories: [{ category, total, correct, pct }], prelearningViewed: [roundNo] }
```
- `category`는 문항 영역 코드(F/E/G/O/H/K/L/S). 코드→한글 라벨은 화면 상수 — `design/copy.md` 내 기록 절.
- ★ **측정 문항(category NULL)은 집계에서 제외**하며 별도 묶음으로도 노출하지 않는다(규칙 2-1 취지 — 측정 문항군의 존재·규모 식별 차단).
- 확정 세션(completed·expired)의 확정 문항(답변 또는 시간초과)만 집계한다.

## 회차

- 회차 번호의 유효 범위는 `1..6`이다. `7`, `8` 및 그 밖의 값은 `404 NOT_FOUND`로 처리한다.

### `GET /api/rounds`
```
[{ roundNo, season, theme, opensAt, closesAt,
   state: "locked"|"open"|"closed",
   myStatus: "none"|"in_progress"|"completed"|"expired",
   myScore }]
```

### `GET /api/rounds/[no]/prelearning`
→ `{ roundNo, title, body, state }` (진입 시 열람 로그 기록)
- `state`: `"open"|"closed"` — open일 때만 화면 하단에 `[이제 문제 풀기]`를 노출한다. 미개방은 `403 ROUND_NOT_OPEN`.

## 응시

### `POST /api/rounds/[no]/session`
세션 시작 또는 재개.
```
res 200 { sessionId, totalItems, currentIndex, status }
err 403 ROUND_NOT_OPEN, 409 ALREADY_COMPLETED
```
- 신규 생성 시 문항·선택지 셔플 후 `quiz_session_item` 12행 생성.
- 서버는 `fn_create_quiz_session(participant, round, items)` RPC로 세션 1행과 문항 12행을 한 트랜잭션에서 생성한다. 동시 시작 경합은 기존 세션 재개로 수렴한다.

### `GET /api/rounds/[no]/item`
현재 문항 서빙.
```
res 200 {
  seq, totalItems, itemType,          // OX|MC4|ORDER|SHORT
  stem,
  choices,                            // 표시순 재배열. OX/SHORT는 null
  remainingSec,                       // 서버 계산
  phase: "answering"|"explained"
}
```
- ★ `measureCode`, `anchorCode`, `level`은 **단계 무관 영구 금지**
- `answer`/`explanation`/`legalRef`는 `answered_at IS NULL`일 때만 금지.
  이미 답한 문항(explained)에서는 포함한다 → `spec/decisions-addendum.md` A항
- `served_at`이 NULL이면 이때 기록. 이미 있으면 갱신하지 않음.
- 세션이 만료 조건이면 `410 SESSION_EXPIRED`.

### `POST /api/rounds/[no]/answer`
```
req { seq, submitted }
     // OX    : true|false
     // MC4   : 0..3  (화면 표시 위치)
     // ORDER : [0,2,1,3] (화면 표시 위치 배열)
     // SHORT : "아차사고"
res { isCorrect, isTimeout, correctAnswerLabel, explanation, legalRef,
      score, points, seq, isLast }
```
- 서버가 `choice_order`로 원본 index 변환 후 채점.
- 45초 초과면 `isTimeout: true, isCorrect: false`이되 해설은 정상 반환.
- 이미 답한 문항이면 기존 결과 반환(멱등).
- `points` = 이 문항에서 얻은 포인트(business-rules 5.0). 정답 배너 `+{points} SCORE` 표기용.
  해설 단계의 `GET /item` 응답에도 동일하게 포함한다(새로고침 복구).

### `POST /api/rounds/[no]/next`
`current_index` 증가, `last_activity_at` 갱신.
→ `{ currentIndex, isCompleted }`
- 마지막 문항에서는 저장된 문항 확정 결과를 다시 집계해 `status`와 `score`를 복구하므로, 답변 확정과 세션 갱신 사이의 일시 실패 후 재호출해도 멱등적으로 완료된다.

### `GET /api/rounds/[no]/result`
→ `{ score, totalItems, pct, points, roundRank, items: [{ seq, itemCode, isCorrect, isTimeout, stem, correctAnswerLabel, explanation }] }`
- `points` = 회차 포인트(business-rules 5.0). `roundRank`는 포인트 기준 순위다.
- 세션이 없으면 `404 NOT_FOUND`. 아직 진행 중이면 `409 IN_PROGRESS` — 클라이언트는 응시 화면으로 이동한다(결과는 완료 후에만, business-rules 3.5).
- 조회 시 30분 유휴 세션을 lazy 만료하고, 완료·만료 세션의 점수는 확정 문항 기준으로 재조정한다.

### `GET /api/rounds/[no]/review`
종료 회차 전체 문항·정답·해설. 미종료 시 `403 ROUND_NOT_CLOSED`.

## 대시보드

### `GET /api/dashboard`
순위 목록은 `ranking_snapshot`만 조회(평균·부서 2종 + 회차별은 별도 엔드포인트).
**순위 산정 기준은 포인트**(business-rules 5.0, N항). 2026-08-25 개정: '전체 누적'(total)은
포상 기준(평균)과 어긋나 응답에서 제거했다.
`me.averageRank`/`me.departmentRank`는 뷰에서 **본인 행만** 조회 허용 → addendum B항
`me.rankedParticipants`/`me.rankedDepartments`는 순위 대상 인원·부서 수(내 순위 카드 분모) —
뷰 count 조회 허용(B항 확장, T10에서 승인)
`minRoundsRequired`는 `fn_min_rounds()` 결과 → addendum C항
```
{
  me: { nickname, departmentId,
        averageRank|null, departmentRank|null,
        rankEligible: boolean, minRoundsRequired,
        rankedParticipants, rankedDepartments },
  average:    [{ rank, nickname, orgUnitName, avgPoints, roundsTaken }],
  department: [{ rank, departmentId, departmentName, orgUnitName, participants, avgPoints,
                 compositeScore, avgParticipationPct }],
  computedAt,          // 최신 snapshot 적재 시각. snapshot 부재 시 null
  visibleRows          // 순위표 기본 표시 행 수 = app_config.rank_visible_rows (규칙 7)
}
```
- 2026-08-25 개정: `me.totalScore`/`me.totalPoints`/`me.roundsTaken`은 대시보드 화면이 쓰지 않는
  dead payload였고 매 요청 `quiz_session_item` 전량 조회를 유발해 제거했다(누적 점수는 홈의
  `GET /api/me`가 계속 제공한다).
- `compositeScore`(0~100, 소수 1자리) = 부서 종합점수(business-rules 5.2 산식),
  `avgParticipationPct`(0~100, 소수 1자리) = 부서 평균 참여율. 산식 개편(2026-08-25) 이전에
  적재된 구 스냅샷에는 두 필드가 없다 — 클라이언트는 optional로 다루고 `avgPoints`로 폴백한다.
- `me.departmentId`: 부서 탭 내 부서 행 배지 판정용. `department[].departmentId`와 **id로** 비교한다.
  ★ **부서명은 판정 키로 쓰지 않는다** — 부서명은 소속 안에서만 유일하고(`UNIQUE(org_unit_id, name)`),
  실제로 193개 부서 중 108개가 동명이다('직업능력개발부' 32곳, '기업인재혁신부' 20곳).
  이름 비교는 남의 부서 행에 배지를 붙이고, `department_id` 기준인 '우리 부서 순위' 카드와
  같은 화면에서 서로 다른 순위를 가리킨다.
- `departmentId`는 `v_rank_department.department_id`(= `department.id`)다. 뷰가 이미 노출하므로
  스키마 변경이 없다.
- 구 스냅샷(`departmentId` 부재)에서는 클라이언트가 배지를 표시하지 않는다 — 틀린 배지 금지.
- 부서 탭(우수 부서) 표 헤더는 `순위` `부서` `소속` `종합점수`다. 동명 부서 식별을 위해 소속명을
  병기한다(두 토큰 모두 `design/copy.md` 승인 목록에 있다). 행 하단에 `평균 {avgPoints}P ·
  참여율 {pct}%` 보조 표기를 붙인다(copy.md 부서 행 보조 표기). 참여자 하한은 `참여자 3명
  이상인 부서만 표시됩니다` 안내가 보증한다.

### `GET /api/dashboard/round/[no]`
→ `[{ rank, nickname, orgUnitName, points, score, pct }]`
- 미인증 `401 UNAUTHENTICATED`, 무효 회차 `404 NOT_FOUND`. 해당 회차 snapshot이 없으면 `[]`.

## 관리자
- 인증: `hq_admin` 쿠키 — 참가자 세션과 이름만 분리, path=/ (addendum G-2). 미인증 시 `401 UNAUTHENTICATED`.
  참가자 쿠키로 관리자 API를, 관리자 쿠키로 참가자 API를 호출하면 401이다.
- 잠금: **10회 실패 → 10분** (`admin_max_attempts` / `admin_lock_minutes`, addendum G-1).

### `POST /api/admin/auth/login`
```
req  { loginId, password }
res  200 { loginId }
err  401 INVALID_CREDENTIALS, 423 LOCKED { lockedUntil }
```
- `admin_user`가 비어 있고 `ADMIN_LOGIN_ID`/`ADMIN_INIT_PASSWORD`가 설정된 경우에만 최초 1회 시딩한다(G항). 시딩 후 환경변수를 삭제한다.

### `POST /api/admin/auth/logout` → `204`

### `GET /api/admin/rounds`
→ `[{ roundNo, season, theme, opensAt, closesAt, isPublished, state, hasBody }]`
- 회차 개방 상태 조회(읽기 전용). 미인증 `401 UNAUTHENTICATED`.
- `state`는 **서버가 `roundState()`로 계산**해 내려준다. 클라이언트가 다시 판정하지 않는다(규칙 2절).
- `hasBody`는 `prelearning_body IS NOT NULL`. 본문 원문은 보내지 않는다.
- 개방 전환 기능은 제공하지 않는다 — 개방은 일정이 결정한다(business-rules 2절, 리뷰 A-5).

### 통계 조회 — 참가자는 닉네임으로만 표시, 사번 미노출 (addendum H항)
```
GET /api/admin/stats/participation → [{ roundNo, started, finished, registered }]
GET /api/admin/stats/items         → [{ itemCode, roundNo, level, itemType, category,
                                        anchorCode, measureCode, n, pValue, timeoutPct, discrimination }]
GET /api/admin/stats/matched       → [{ nickname, orgUnitName, preN, postN, prePct, postPct, gainPp }]
GET /api/admin/stats/outcomes       → {
  summary: { matchedN, pairCount, preAvgPct, postAvgPct, meanGainPp,
             medianGainPp, improvedN, improvedPct },
  pairs: [{ measureCode, preItemCode, postItemCode, n, prePct, postPct, gainPp }],
  anchors: [{ roundNo, anchorCode, n, pct }],
  transfers: [{ measureCode, itemCode, roundNo, n, pct }]
}
GET /api/admin/stats/heatmap       → [{ orgUnitName, category, n, pct }]
GET /api/admin/stats/prelearning   → [{ roundNo, viewed, n, avgPct }]
GET /api/admin/short-unmatched     → [{ itemCode, roundNo, nickname, submitted, answeredAt }]
```
- `viewed`는 `prelearning_view.viewed_at <= quiz_session.started_at`인 사전학습 열람만 뜻한다. 퀴즈 시작 후 재열람 로그는 보존하지만 열람 효과 집계에서는 미열람으로 분류한다.
- `/api/admin/stats/matched`와 `outcomes`의 1차 KPI는 사전 M01~M12와 사후 M01P~M12P를 **각각 12개 모두 확정한 동일인**만 포함한다. 일부 응답자는 참여 통계에는 남지만 이 집계에서는 제외한다.
- 시간초과(`is_timeout=true`)는 오답(`is_correct=false`)으로 계산한다.
- `outcomes.summary`의 평균은 완전대응 참가자별 정답률 평균, `meanGainPp`는 개인별 향상폭 평균, `medianGainPp`는 개인별 향상폭 중앙값, `improvedPct`는 향상폭이 0보다 큰 참가자 비율이다.
- `measureCode`/`anchorCode`/`level`은 성과분석 목적의 **관리자 전용** 데이터다. 참가자 응답 금지(규칙 2-1)는 참가자 API에 적용되는 규칙이며, `hq_admin` 인증 뒤에서는 제공한다.

### `GET /api/admin/export/[kind]`
`kind` ∈ `answers` | `scores` | `items` | `matched` | `outcomes` | `heatmap` | `participation`. 무효 kind는 `404 NOT_FOUND`.
- CSV: UTF-8 **BOM** + CRLF (Excel 한글 깨짐 방지). `content-disposition: attachment`.
- `scores`에는 포상 연락용 `휴대폰` 열이 포함된다(P항). 휴대폰은 CSV에만 싣고 관리자 화면 API에는 노출하지 않는다(사번과 동일 원칙).
- CSV의 문자열 셀은 Excel 수식으로 해석될 수 있는 선행 `=`, `+`, `-`, `@`를 이스케이프한다. 대량 조회는 안정적인 고유 정렬과 페이지네이션으로 전량 수집한다.
- 관리자 화면과 CSV의 시각은 `Asia/Seoul` 기준 `YYYY-MM-DD HH:mm:ss`로 표시한다.
- ★ **사번(emp_no)은 CSV에만 포함한다**(운영자 확정, T11 — 포상·행정 대조용). 화면 API에는 싣지 않는다.
  내려받은 파일의 보관·폐기 책임은 운영자에게 있다.

## 배치
```
POST /api/cron/refresh-rankings   // 60초 주기. 중복 실행 스킵
POST /api/cron/expire-sessions    // 30분 초과 세션 만료 처리
```
- Vercel Cron으로 등록. `CRON_SECRET` 헤더 검증 필수.
