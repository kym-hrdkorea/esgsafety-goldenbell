# 작업 카드 (수직 슬라이스)

> **한 번에 하나씩.** 카드를 끝내면 멈추고 사람에게 확인받는다.
> 레이어별(DB전체→API전체→UI전체)로 자르지 않는다. 중간에 동작하는 게 없으면 검증이 불가능하다.

---

## T00 — 프로젝트 초기화
- Next.js 15 App Router + TypeScript + Tailwind, pnpm
- `lib/db.ts` (service role 클라이언트), `lib/config.ts` (app_config 로더, 60초 캐시)
- `.env.local` 작성 (`.env.example` 참조)
- **완료 조건**: `pnpm dev` 기동, `/api/health`가 DB에서 `app_config` 1건 조회 성공

## T01 — 조직 조회 + 회원가입 + 로그인
- `GET /api/org/units`, `GET /api/org/departments`
- `POST /api/auth/signup` (bcrypt, 사번·닉네임 중복 검사, org_unit_id 서버 결정)
- `POST /api/auth/login` (5회 실패 15분 잠금), `POST /api/auth/logout`, `GET /api/me`
- `lib/session.ts` httpOnly 쿠키
- 화면: `/signup`, `/login`
- **완료 조건**: 가입→로그아웃→로그인 왕복 성공. **5회** 연속 오입력 시 잠금 메시지 확인

## T02 — 응시 플로우 1문항 완주 (MC4만)
- `POST /api/rounds/[no]/session` (세션 생성 + session_item 12행 + 셔플 저장)
- `GET /api/rounds/[no]/item` (**미응답 문항에 answer·explanation 미포함 검증**)
- `POST /api/rounds/[no]/answer` (MC4 채점), `POST /api/rounds/[no]/next`
- 화면: `/round/[no]/quiz` 답변→해설 2단계
- **완료 조건**: 4지선다 1문항을 풀고 해설을 본 뒤 다음 문항으로 넘어간다.
  브라우저 네트워크 탭에서 정답이 전송되지 않음을 확인

## T03 — 문항 유형 4종 확장
- `lib/grading.ts` — OX / MC4 / ORDER / SHORT
- `components/quiz/` 4종 컴포넌트. ORDER는 **탭 순서 배지** 방식(드래그 아님)
- SHORT 정규화: trim → 공백제거 → NFKC → 배열 포함 검사
- 문항 포인트 계산(`business-rules 5.0`, N항): answer·item 응답에 `points` 포함,
  정답 배너 `+{points} SCORE`. `app_config`에 `point_base`(100)·`point_time_bonus_max`(100) INSERT(DML)
- **완료 조건**: `lib/grading.test.ts` 단위테스트 통과.
  각 유형 최소 3케이스(정답/오답/경계) + MC4 셔플 변환 케이스 + 포인트 산식 케이스 포함

## T04 — 서버 권위 타이머
- `served_at` 최초 서빙 시 1회 기록, **재갱신 금지**
- 45초 초과 시 `is_timeout=true, is_correct=false`, 해설은 정상 반환
- 클라이언트 카운트다운(표시용), 0초에 자동 제출
- **완료 조건**: 문항 서빙 후 새로고침을 반복해도 남은 시간이 계속 줄어든다.
  50초 대기 후 제출하면 시간초과로 처리된다

## T05 — 회차 완료 + 결과 화면
- ★ **착수 전**: `db/05_views.sql` 순위 뷰를 포인트 기준으로 교체(SQL 제시 → 명시적 DDL 허가 → 1회 실행, N항)
- 12문항 종료 시 `status='completed'`, `score` 확정
- `GET /api/rounds/[no]/result`(포인트 포함), 화면 `/round/[no]/result` — `획득 포인트 {points}P` 병기
- 오답만 보기 토글
- **완료 조건**: 12문항 완주 후 점수·정답률·포인트·문항별 결과가 정확히 표시된다

## T06 — 세션 만료 처리
- 30분 방치 → `expired`, 미응답 문항 전부 timeout 확정
- lazy 검사 + `POST /api/cron/expire-sessions`
- **이어하기 불허**
- **완료 조건**: `last_activity_at`을 31분 전으로 조작하면 접근 시 종료 처리된다

## T07 — 홈 + 회차 목록 + 개방 판정
- `GET /api/rounds` (locked/open/closed × myStatus)
- 화면 `/` — 이번 주 카드, 지난 회차, 잠금 표시
- 하단 탭 3개(홈/순위/내 기록) 도입 + **응시 중 탭 숨김 + 이탈 경고**
  (copy.md `진행 중인 문제가 있습니다. 나가면 이어서 풀 수 없습니다.` — T03 리뷰에서 카드 미배정 확인, 여기 배정)
- **완료 조건**: `opens_at`을 미래/과거로 바꾸면 상태 배지와 버튼이 정확히 바뀐다

## T08 — 사전학습 + 열람 로그 + 복습
- `GET /api/rounds/[no]/prelearning` (진입 시 upsert 로그)
- 화면 `/round/[no]/learn` (markdown 렌더), `/round/[no]/review`
- **완료 조건**: 열람 시 `prelearning_view` 1행 생성(중복 없음). 종료 회차 복습 열람 가능

## T09 — 순위 집계
- `POST /api/cron/refresh-rankings` — 뷰 → `ranking_snapshot` 적재, 60초 중복 스킵
- 순위 4종은 **포인트 기준**(business-rules 5.0·5.2, T05 전 교체된 뷰 사용)
- Vercel Cron 등록 + `CRON_SECRET` 검증
- **완료 조건**: 세션 완료 후 60초 내 snapshot 갱신. 2회 연속 호출 시 두 번째는 스킵

## T10 — 대시보드
- `GET /api/dashboard` (snapshot만 조회), `GET /api/dashboard/round/[no]`
- 순위 4종 탭(**포인트 기준**, 표 헤더는 copy.md 개정본), `RankTable` 5행 + 더보기 20행, 공동 순위 표시
- 내 순위·우리 부서 순위 카드(순위권 밖에도 표시)
- **완료 조건**: 4개 탭 모두 동작. 3회 미달 시 "3회 이상 참여하면 반영" 안내 노출

## T11 — 내 기록 + 관리자 조회 + CSV
- **관리자 로그인**(`/api/admin/auth/*`, 분리 쿠키, **10회 실패 10분 잠금** — addendum G-1항. 참가자 5회/15분과 다름)
- 화면 `/me`
- `/admin` — 참여 현황, 문항 통계, 동일인 대조, 히트맵, SHORT 미매칭
- `GET /api/admin/export/[kind]` — CSV, **UTF-8 BOM**
- **완료 조건**: CSV를 Excel로 열어 한글이 정상 표시된다

## T12 — 부하 테스트 + 마감 점검
- k6 또는 Artillery로 동시 100명 시나리오(로그인→응시 12문항→대시보드)
- 응답시간 300ms 목표 확인, 느린 쿼리 인덱스 보정
- 최종 점검: 정답 미전송 / measure_code 미전송 / 재응시 차단 / 잠금 동작 / 타이머 우회 불가
- **완료 조건**: 100 VU에서 오류율 0%, p95 < 500ms
## T13 — 비밀번호 자율 재설정 + 로그인 버튼 위계
- `POST /api/auth/reset-pin`: 사번+닉네임+부서 **단일 쿼리** 검증 → 새 PIN 설정.
  `lib/login-lock.ts`를 import하지 않는다(잠금 연장·`last_login_at` 오염 버그).
  실패는 카운터 미변경, 성공은 `failed_attempts=0, locked_until=NULL` 동시 초기화.
  세션 미발급 · `423` 미반환 · 동일 PIN 검사 없음 · 닉네임 trim 없음.
- `lib/reset-throttle.ts`: IP당 20/시간 + 인스턴스 전역 40/시간 + 응답 하한 700ms.
- `app/(auth)/reset-pin/page.tsx`: 2단계 위저드(제출은 1회), 부서 단일 검색.
- 로그인 화면: `회원가입`을 `gb-cta-sub`(남색 56px 전폭) 버튼으로 승격 + `비밀번호를 잊으셨나요?` 링크.
- 기존 버그 동반 수정: `login/route.ts` 미가입 사번 타이밍 오라클(더미 해시 대조).
- 감수한 위험 R1~R9와 운영 런북은 addendum O항.
- **완료 조건**: `.t13-verify.mjs` 10개 검사 통과. 특히 ① 없는 사번 ② 틀린 닉네임
  ③ 틀린 부서의 응답이 status·code·message까지 완전히 동일하고, 검증 실패 3회 후에도
  `failed_attempts`가 0이며, 잠금 상태에서 재설정 후 즉시 로그인이 된다.
