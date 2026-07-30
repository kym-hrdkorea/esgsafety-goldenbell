# Claude Code 실행 런북 — 프롬프트 모음

로컬에서 Claude Code를 실행해 진행할 때 순서대로 붙여넣는 프롬프트다.
`prompts/3_claude-code-kickoff.md`는 DB가 이미 구축된 상황을 가정하므로, 이 런북을 사용한다.

## 0. 파일 배치

산출물 폴더의 **내용을 리포지토리 루트에 그대로** 펼친다.
문서 안의 경로 참조(`spec/business-rules.md` 등)가 루트 기준이므로 `docs/` 같은 하위 폴더로 옮기면 안 된다.

```
hrdk-safety-quiz/          ← 여기서 claude 실행
├── CLAUDE.md              ← 루트에 있어야 자동 로드된다
├── AGENTS.md
├── README.md
├── decisions.md
├── .env.example
├── db/                    01~05 SQL, items.json
├── spec/                  functional / business-rules / api-contract / test-scenarios
├── design/                design-brief / copy / screens
├── tasks/                 tasks.md
├── prompts/               이 런북 포함
└── (Next.js 코드가 이후 여기 생성된다)
```

```bash
mkdir hrdk-safety-quiz && cd hrdk-safety-quiz
# 산출물 압축 해제 후
git init && git add -A && git commit -m "docs: 설계 산출물 초기 커밋"
claude
```

첫 커밋을 먼저 해두면 이후 에이전트 변경분을 `git diff`로 정확히 볼 수 있다.

---

## P1. 오리엔테이션 — 구현 금지, 이해도 확인

> 가장 중요한 프롬프트. (3)번을 틀리면 채점 로직 전체가 잘못되므로 여기서 반드시 걸러낸다.

```
이 리포지토리의 설계 문서를 읽고 이해도를 확인하겠습니다. 아직 코드는 작성하지 마세요.

다음 순서로 읽어 주세요.
1. CLAUDE.md — 기술 스택과 절대 규칙
2. spec/business-rules.md — 채점·타이머·순위 규칙
3. spec/api-contract.md
4. spec/functional-spec.md (특히 2절 "만들지 않는 것")
5. db/01_schema.sql
6. tasks/tasks.md

읽고 나서 아래 5가지를 보고해 주세요. 코드는 쓰지 마세요.

(1) 이 서비스가 무엇이고 사용자가 어떤 흐름으로 쓰는지 3문장 요약

(2) 절대 규칙 중 구현할 때 가장 실수하기 쉬운 것 3개와 그 이유

(3) MC4 문항의 셔플-정답 변환을 예시 숫자로 설명해 주세요.
    원본 정답 index가 2이고 choice_order = [3,2,0,1] 인 문항에서
    사용자가 화면상 두 번째 선택지를 골랐습니다. 정답입니까?
    그리고 DB에는 무엇을 저장해야 합니까?

(4) 문서 간 모순이나 빠진 정보가 있으면 목록으로

(5) T00~T12 중 난이도가 높다고 판단되는 카드와 이유

(3)번을 틀리면 채점 전체가 잘못됩니다. 반드시 정확히 답해 주세요.
```

**정답 확인용** — `choice_order[1] = 2`, 원본 정답이 2이므로 **정답**이다.
DB에는 화면 위치(1)가 아니라 **원본 index(2)** 를 저장해야 한다.
이걸 틀리게 답하면 P1을 다시 시키거나 `business-rules.md` 4절을 다시 읽히고 재확인한다.

---

## P2. DB 구축 — DDL 1회 한정 허가

> 전제: P1 오리엔테이션과 13건 결정(addendum A~M·G-1~G-3) 완료.
> Supabase MCP는 `.mcp.json`(호스티드 HTTP, project_ref=etqmarnbscjkrkthpful)로 연결.
> `03_seed_rounds.sql`은 2026-08-10(월) 시작 기준으로 이미 갱신됨.

```
P2 DB 구축을 진행합니다. 이 작업에 한해 DDL 실행을 허가합니다(CLAUDE.md 규칙 9-1의 "최초 1회").

시작 전에 spec/decisions-addendum.md 를 읽으세요. P1과 13건 결정이 완료된 상태입니다.

Supabase MCP(project_ref=etqmarnbscjkrkthpful) 연결을 먼저 확인하고,
연결되어 있으면 db/ 폴더 SQL을 아래 순서로 실행하세요.
연결이 안 되어 있으면 실행하지 말고 멈춰서 알려주세요.

1. db/01_schema.sql        (G-1 반영본: admin_user 잠금 컬럼, app_config 12건)
2. db/02_seed_org.sql
   → 실행 직후 시퀀스 보정(명시 id 삽입으로 serial이 전진하지 않음):
     SELECT setval(pg_get_serial_sequence('org_unit','id'),   (SELECT max(id) FROM org_unit));
     SELECT setval(pg_get_serial_sequence('department','id'), (SELECT max(id) FROM department));
3. db/03_seed_rounds.sql   (2026-08-10 월요일 시작 반영본. is_published 전부 false 유지.
                            시작일이 바뀌면 재적재가 아니라 UPDATE(DML)로 조정)
4. db/04_seed_items.sql
5. db/05_views.sql         (L항 수정본: 사분위 참가자 총점 기준 + 미서빙 필터)

전체 실행 후 아래를 쿼리로 검증해 표로 보고하세요.
- org_unit 50 / department 193 / quiz_round 8 / quiz_item 96 / app_config 12
- quiz_item 유형 분포 MC4 60 / OX 32 / ORDER 3 / SHORT 1
- answer 자료형: OX=boolean, MC4=number(0~3), ORDER=array, SHORT=array
  + MC4 범위 이탈 0건, choices 유무가 유형과 일치(MC4·ORDER만 NOT NULL)
- 뷰 13개 생성(기초 v_round_score 포함. 번호 뷰 ①~⑫ + 기초 1)
- v_rank_total / v_rank_department / v_matched_pre_post 무오류 실행(0행 정상)
- fn_min_rounds() = 0 (공개 회차 0개)
- admin_user 컬럼에 failed_attempts / locked_until / last_login_at 존재

이 작업 이후에는 DDL(CREATE/ALTER/DROP/TRUNCATE)과 시드 재적재를 실행하지 마세요.
검증·테스트용 SELECT와 DML(예: T06의 last_activity_at 조작)은 허용됩니다.
완료 후 멈추고 보고하세요. 다음은 P3(T00)입니다.
```

---

## P3. T00 착수

```
T00부터 시작합니다. tasks/tasks.md의 카드를 순서대로 하나씩 진행합니다.

지금은 T00만 하세요. 완료하면 멈추고 보고해 주세요.

작업 원칙
- 카드 하나가 끝나면 반드시 멈춘다. 다음 카드로 자동 진행하지 않는다
- 카드의 "완료 조건"을 스스로 검증한 뒤 실행 결과를 함께 보고한다
- 커밋 메시지 형식: feat: T00 프로젝트 초기화
- 라이브러리 추가가 필요하면 이유를 먼저 설명하고 승인을 받는다
- .env.local 은 .env.example 을 참고해 만들고, 값은 제가 채웁니다

T00 완료 조건: pnpm dev 기동 후 /api/health 가 DB에서 app_config 1건을 조회해 반환
```

---

## P4. 카드 반복 템플릿 — T01~T11 매번 재사용

```
{T0X}를 진행해 주세요.

시작 전에
- spec/business-rules.md 에서 이 카드와 관련된 절을 다시 읽으세요
- 이 카드가 CLAUDE.md 절대 규칙 중 어떤 것과 관련되는지 먼저 말해 주세요

완료 후 보고
- 변경·추가한 파일 목록
- 카드의 완료 조건을 어떻게 검증했는지 (실제 실행 결과 포함)
- spec/test-scenarios.md 중 이 카드에 해당하는 케이스 번호와 통과 여부
- 규칙 위반 우려가 있는 부분을 자진 신고

끝나면 멈추세요. 다음 카드로 넘어가지 마세요.
```

---

## P5. 위험 로직 자체 감사 — T04 완료 직후 필수, T11 후 1회 더

```
지금까지 구현한 코드를 자체 감사해 주세요. 새 기능은 만들지 마세요.

각 항목마다 "어느 파일 몇 번째 줄에서 어떻게 보장되는지" 근거를 제시하세요.
근거를 제시할 수 없으면 미충족으로 보고하세요. 추측으로 통과 처리하지 마세요.

1. 문항 조회 API 응답에서 answered_at IS NULL 인 문항에 answer, explanation 이 없는가
   (이미 답한 문항에 포함되는 것은 정상입니다. 위반이 아닙니다)
2. measureCode, anchorCode, level 이 단계와 무관하게 모든 응답에서 제외되는가
3. served_at 을 두 번 이상 쓰는 코드 경로가 없는가
4. 채점에 클라이언트가 보낸 경과시간이나 정오 판정을 쓰지 않는가
5. 선택지 셔플이 요청마다 재실행되지 않는가
6. 클라이언트 번들에 Supabase URL·키가 없는가 (NEXT_PUBLIC_SUPABASE_* 부재)
7. localStorage / sessionStorage 사용이 없는가
8. PIN 이 평문으로 저장되거나 로그에 남지 않는가
9. 제한시간·최소 회차 값이 하드코딩되지 않고 app_config 에서 오는가
10. 중복 제출이 멱등하게 처리되는가
11. 포인트의 시간 요소가 문항별 답변 시간(served_at→answered_at)만 반영하는가 —
    세션 총 소요시간·해설 열람 시간이 어떤 점수·순위에도 쓰이지 않고,
    포인트 산식 값(point_base, point_time_bonus_max)이 app_config에서 오는가
12. 대시보드가 뷰를 직접 조회하지 않고 ranking_snapshot 만 읽는가

그리고 실제로 실행해 확인해 주세요.
- 문항 서빙 후 새로고침 5회 → 남은 시간이 계속 줄어드는가
- 50초 대기 후 제출 → isTimeout = true 인가
- 브라우저 네트워크 탭에서 **미응답** 문항 조회 응답 본문에 정답이 없는가
- 답한 뒤 해설 화면에서 새로고침 → 해설이 정상 복구되는가
```

2번은 특히 중요하다. `measureCode`가 노출되면 참가자가 성과측정 문항을 식별해
사전·사후 비교 데이터가 오염되고, 캠페인의 핵심 성과지표가 무의미해진다.

---

## P6. 막혔을 때 — 스키마 변경 우회 차단

> 에이전트가 "컬럼을 추가하면 간단합니다" 류의 제안을 할 때 사용

```
지금 막힌 지점을 스키마 변경으로 우회하지 마세요.

대신 아래를 보고해 주세요.
- 정확히 무엇이 막혔는지
- 현재 스키마로 해결할 방법 2가지 이상
- 그래도 스키마 변경이 필요하다면, 어떤 컬럼을 어떻게 바꿔야 하고
  그것이 db/05_views.sql 의 어느 뷰와 db/04_seed_items.sql 에 어떤 영향을 주는지

실행은 하지 마세요. 판단은 제가 합니다.
```

---

## P7. 최종 점검 — T12

```
개시 전 최종 점검입니다.

1. spec/test-scenarios.md 의 A~J 전 항목을 순회하며 통과/미통과를 표로 판정
2. 미통과 항목 수정
3. k6 로 부하 테스트: 동시 100 VU, 시나리오는 로그인 → 12문항 응시 → 대시보드 조회
   목표 오류율 0%, p95 < 500ms
4. 느린 쿼리가 있으면 인덱스 보정 필요 여부를 판단해 제안 (스키마 변경은 제안만)

D(타이머) · E(채점) · I(보안) 항목은 하나라도 미통과면 개시할 수 없습니다.
이 세 그룹을 우선 처리해 주세요.
```

---

## 진행 체크리스트

- [ ] P1 오리엔테이션 — (3)번 정답 확인
- [ ] P2 DB 구축 — 50 / 193 / 96 / 8 카운트 확인
- [ ] P3 T00
- [ ] P4 T01 인증
- [ ] P4 T02 응시 1문항 완주 ← **여기서 실물을 눌러보고 UX 판단**
- [ ] P4 T03 문항 유형 4종
- [ ] P4 T04 서버 타이머 → **P5 자체 감사**
- [ ] P4 T05~T08
- [ ] P4 T09~T11 → **P5 자체 감사 2회차**
- [ ] P7 T12 최종 점검

**T02가 끝나면 반드시 직접 눌러 보십시오.** 그 시점에 UX 문제를 발견하는 것이
T12에서 발견하는 것보다 훨씬 쌉니다. 타이머 45초가 실제로 촉박한지,
해설 읽는 시간이 충분한지는 문서로는 알 수 없습니다.
