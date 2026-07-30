# API 계약서

- 모든 엔드포인트는 `app/api/**/route.ts`에 구현한다.
- 인증은 httpOnly 쿠키 세션. 미인증 시 `401 { code: "UNAUTHENTICATED" }`.
- 오류 응답 공통: `{ code: string, message: string }` (message는 한국어, 사용자 노출용)

## 인증

### `GET /api/org/units`
소속 목록. → `[{ id, name, categoryCode, categoryName }]`

### `GET /api/org/departments?unitId=`
해당 소속의 부서. → `[{ id, name }]`

### `POST /api/auth/signup`
```
req  { empNo, nickname, departmentId, pin }
res  201 { participantId, nickname }
err  409 EMP_NO_TAKEN | NICKNAME_TAKEN, 400 VALIDATION
```
- `orgUnitId`는 서버가 `departmentId`로부터 조회해 채운다. 클라이언트 값 무시.

### `POST /api/auth/login`
```
req  { empNo, pin }
res  200 { nickname, orgUnitName, departmentName }
err  401 INVALID_CREDENTIALS, 423 LOCKED { lockedUntil }
```

### `POST /api/auth/logout` → `204`
### `GET /api/me` → `{ nickname, orgUnitName, departmentName, totalScore, roundsTaken, totalRank }`
- `totalRank` = 포인트 기준 누적 순위(홈 요약 카드용). 본인 행 1건만 `v_rank_total` 직접 조회 — addendum B항. 순위 미대상(미응시·최소 회차 미달)이면 `null`.

## 회차

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

### `GET /api/rounds/[no]/result`
→ `{ score, totalItems, pct, points, roundRank, items: [{ seq, itemCode, isCorrect, isTimeout, stem, correctAnswerLabel, explanation }] }`
- `points` = 회차 포인트(business-rules 5.0). `roundRank`는 포인트 기준 순위다.
- 세션이 없으면 `404 NOT_FOUND`. 아직 진행 중이면 `409 IN_PROGRESS` — 클라이언트는 응시 화면으로 이동한다(결과는 완료 후에만, business-rules 3.5).

### `GET /api/rounds/[no]/review`
종료 회차 전체 문항·정답·해설. 미종료 시 `403 ROUND_NOT_CLOSED`.

## 대시보드

### `GET /api/dashboard`
순위 목록 4종은 `ranking_snapshot`만 조회. **순위 산정 기준은 포인트**(business-rules 5.0, N항).
`me.totalRank`/`me.departmentRank`는 뷰에서 **본인 행만** 조회 허용 → addendum B항
`minRoundsRequired`는 `fn_min_rounds()` 결과 → addendum C항
```
{
  me: { nickname, totalScore, totalPoints, roundsTaken, totalRank|null, departmentRank|null,
        rankEligible: boolean, minRoundsRequired },
  total:      [{ rank, nickname, orgUnitName, totalPoints, roundsTaken }],
  average:    [{ rank, nickname, orgUnitName, avgPoints, roundsTaken }],
  department: [{ rank, departmentName, orgUnitName, participants, avgPoints }],
  computedAt
}
```
### `GET /api/dashboard/round/[no]`
→ `[{ rank, nickname, orgUnitName, points, score, pct }]`

## 관리자
```
POST /api/admin/auth/login            // req { loginId, password } -> 200 { loginId }
POST /api/admin/auth/logout           // -> 204
GET  /api/admin/stats/participation
GET /api/admin/stats/items
GET /api/admin/stats/matched          // 동일인 대조
GET /api/admin/stats/heatmap
GET /api/admin/stats/prelearning
GET /api/admin/short-unmatched        // SHORT 미매칭 응답
GET /api/admin/export/[kind]          // CSV (UTF-8 BOM)
```

## 배치
```
POST /api/cron/refresh-rankings   // 60초 주기. 중복 실행 스킵
POST /api/cron/expire-sessions    // 30분 초과 세션 만료 처리
```
- Vercel Cron으로 등록. `CRON_SECRET` 헤더 검증 필수.
