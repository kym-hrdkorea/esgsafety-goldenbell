# CLAUDE.md — HRDK 안전 골든벨 퀴즈 리그

## 프로젝트 한 줄 정의
한국산업인력공단 전 직원(약 1,800명)을 대상으로 8주간 매주 12문항 안전 퀴즈를 제공하고,
순위·포상과 지식 향상도 측정을 지원하는 **2개월 한시 운영 웹 서비스**.

## 기술 스택 (고정 — 변경 금지)
| 영역 | 선택 |
|---|---|
| 프레임워크 | Next.js 15 App Router, TypeScript |
| 스타일 | Tailwind CSS |
| DB | Supabase (PostgreSQL) — `@supabase/supabase-js` |
| 인증 | **자체 구현** (bcrypt + httpOnly 쿠키 세션). Supabase Auth 사용 금지 |
| 배포 | Vercel |
| 패키지 매니저 | pnpm |

## 절대 규칙 (위반 시 재작업)

1. **브라우저에서 Supabase를 직접 호출하지 않는다.**
   모든 DB 접근은 Next.js Route Handler(`app/api/**/route.ts`)에서 `SUPABASE_SERVICE_ROLE_KEY`로만 수행한다.
   → 이 때문에 RLS 정책은 작성하지 않는다. `NEXT_PUBLIC_SUPABASE_*` 환경변수를 만들지 않는다.

2. **정답·해설은 "답변 전"에만 금지한다. 판정 기준은 서버의 `answered_at`이다.**
   클라이언트가 보낸 `phase` 값을 신뢰하지 않는다.

   | 상태 | `answer` / `explanation` / `legalRef` |
   |---|---|
   | `answered_at IS NULL` (답변 단계) | **금지** |
   | `answered_at IS NOT NULL` 또는 `is_timeout` (해설 단계) | **허용** |

   해설 단계에서 허용하는 이유: 이미 답한 문항은 사용자가 정답을 알고 있고,
   해설 화면을 새로고침하면 해설을 다시 보여줘야 한다.

2-1. **`measureCode` / `anchorCode` / `level`은 단계와 무관하게 모든 응답에서 영구 금지한다.**
   이건 정답 유출이 아니라 **성과측정 무결성** 문제다.
   참가자가 사전·사후 측정 문항을 식별하면 `v_matched_pre_post`(캠페인 핵심 성과지표)가
   오염되고, 오염 사실이 화면에 전혀 드러나지 않는다.
   규칙 2와 근거가 다르므로 적용 범위도 다르다. 혼동하지 말 것.

3. **타이머는 서버 권위(server-authoritative)다.**
   클라이언트가 보낸 경과시간을 신뢰하지 않는다. `quiz_session_item.served_at`과
   서버 `now()`의 차이로만 판정한다. 클라이언트 타이머는 표시용일 뿐이다.

4. **선택지 셔플은 세션 생성 시 1회만 수행하고 DB에 저장한다.**
   요청마다 다시 섞으면 정답 판정이 어긋난다. `choice_order`에 저장된 순서를 재사용한다.

5. **`localStorage` / `sessionStorage` / 브라우저 스토리지를 사용하지 않는다.**
   진행 상태는 전부 서버(`quiz_session`)에 있다.

6. **DB 스키마를 임의로 변경하지 않는다.**
   `db/01_schema.sql`이 유일한 진실이다. 변경이 필요하면 코드를 고치지 말고 **먼저 사람에게 물어본다.**

7. **운영 파라미터를 하드코딩하지 않는다.**
   제한시간·최소 회차·최소 참여자 수 등은 `app_config` 테이블에서 읽는다.

8. **라이브러리를 임의로 추가하지 않는다.**
   필요하면 이유를 설명하고 승인을 받는다. 허용 목록: `bcryptjs`, `zod`, `date-fns-tz`, `swr`.
   차트가 필요하면 `recharts`.

9. **한국어 UI.** 모든 화면 문안은 `design/copy.md`를 그대로 사용한다. 임의로 문구를 만들지 않는다.

9-1. **Supabase MCP가 연결되어 있어도 DDL을 실행하지 않는다.**
   `CREATE` / `ALTER` / `DROP` / `TRUNCATE`, 시드 재적재는 금지다.
   최초 DB 구축 1회만 사람의 명시적 허가 아래 수행하고, 그 이후에는 실행하지 않는다.
   구현이 막혔을 때 스키마를 바꿔 우회하는 것이 가장 쉬운 길이지만,
   그러면 `db/05_views.sql`의 뷰와 96문항 시드가 조용히 깨진다.
   스키마 변경이 필요하면 **제안만 하고 멈춘다.**

10. **개인정보를 늘리지 않는다.**
    수집 항목은 사번·닉네임·PIN·소속·부서뿐이다. 이름·이메일·연락처 필드를 추가하지 않는다.
    로그에 사번을 남기지 않는다.

## 디렉터리 구조
```
app/
  (auth)/login/page.tsx          로그인
  (auth)/signup/page.tsx         회원가입
  (main)/page.tsx                홈(회차 목록)
  (main)/round/[no]/learn/page.tsx   사전학습
  (main)/round/[no]/quiz/page.tsx    응시
  (main)/round/[no]/result/page.tsx  회차 결과
  (main)/round/[no]/review/page.tsx  복습(종료 회차)
  (main)/dashboard/page.tsx      순위 대시보드
  (main)/me/page.tsx             내 기록
  admin/page.tsx                 관리자 조회
  api/**/route.ts                모든 서버 로직
lib/
  db.ts        supabase 서버 클라이언트(service role)
  session.ts   쿠키 세션 (httpOnly, sameSite=lax, secure)
  config.ts    app_config 로더(60초 메모리 캐시)
  grading.ts   유형별 채점 로직 (★ 단위테스트 대상)
  shuffle.ts   시드 기반 셔플
  time.ts      Asia/Seoul 시각 처리
components/
  quiz/OxItem.tsx  Mc4Item.tsx  OrderItem.tsx  ShortItem.tsx
  quiz/Timer.tsx   Explanation.tsx
  dashboard/RankTable.tsx (5행 표시 + 더보기)
```

## 커밋 규칙
`feat|fix|chore|docs: <작업카드 ID> <요약>` 예) `feat: T04 서버 권위 타이머 구현`

## 작업 방식
- `tasks/tasks.md`의 작업 카드를 **위에서 순서대로** 처리한다.
- 카드 하나를 끝내면 멈추고 사람에게 확인을 받는다. 여러 카드를 한 번에 진행하지 않는다.
- 각 카드의 "완료 조건"을 스스로 검증한 뒤 보고한다.

## 6회차 전환 연속 개발 기준
- T14 이후 작업의 단일 진입점은 `tasks/continuation-plan.md`다.
- 운영 목표는 2026-08-17~2026-09-25, 6회차, 회차당 12문항, 총 72문항이다.
- 사전·사후 측정 12쌍과 완전대응 KPI 기준은 위 계획 파일의 매핑표와 산식을 따른다.
- Supabase·Vercel·환경변수·DDL/DML처럼 사용자의 계정 또는 명시적 승인이 필요한 단계에서는 작업을 멈추고 초보자용 다음 지침을 보고한다.
- 계획 파일의 카드 순서와 완료 조건이 기존 작업 카드보다 우선하는 후속 작업 기준이다. 기존 코드 리뷰 문서는 과거 상태의 기록으로 보존한다.

## 반드시 먼저 읽을 문서
1. `spec/business-rules.md` — 채점·타이머·순위 규칙 (**버그의 90%가 여기서 나온다**)
2. `spec/decisions-addendum.md` — 확정 결정 A~M·G-1~G-3. **B·C·D·E·F·K항은 이 문서에만 있다**
3. `spec/api-contract.md` — API 계약
4. `spec/functional-spec.md` — 기능 범위와 **하지 않는 것**
5. `db/01_schema.sql` — 스키마
