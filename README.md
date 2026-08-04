# HRDK 안전 골든벨 퀴즈 리그 — 개발 산출물

2개월 한시 운영 웹앱. Next.js 15 + Supabase + Vercel.

## 파일 구성

```
README.md                  ← 이 문서 (사용 순서)
CLAUDE.md                  Claude Code 프로젝트 규칙 ★ 리포 루트에 배치
AGENTS.md                  Codex 검증 역할 정의   ★ 리포 루트에 배치
decisions.md               확정 의사결정 24건 + 정정 이력

db/
  01_schema.sql            스키마 DDL (8개 테이블)
  02_seed_org.sql          소속 50개 / 부서 193개  [자동생성]
  03_seed_rounds.sql       회차 8개  ※ 날짜 수정 필요
  04_seed_items.sql        문항 96개  [자동생성]
  05_views.sql             순위 5종 + 성과분석 7종 뷰
  items.json               문항 원본 JSON (참조용)

spec/
  functional-spec.md       기능 명세 + 만들지 않는 것
  business-rules.md        채점·타이머·순위 규칙 ★★ 가장 중요
  decisions-addendum.md    확정 결정 A~M·G-1~G-3·N·O ★ B·C·D·E·F·K항은 이 문서에만 있다
  api-contract.md          API 계약 (24개 엔드포인트)
  test-scenarios.md        테스트 케이스 50여 건

design/
  1_claude-design.md       Claude Design 전달 프롬프트 (톤·가드레일 원본)
  design-brief.md          Claude Design 브리프
  copy.md                  화면 문안 (확정) — 규칙 9의 유일 출처
  screens.md               라우트 + 플로우 + 상태
  sample-items.md          문항 샘플 (디자인 검토용)
  handoff.md               디자인 → 구현 핸드오프
  tokens.css               색·타이포 토큰
  mocks/                   확정 목업 11종 (.dc.html)

tasks/
  tasks.md                 작업 카드 T00~T13 (수직 슬라이스)
  ux-findings.md           참가자 화면 UI/UX 감사 (A·B절 완료, C절 미해결)
  code-review-findings.md  전체 코드 리뷰 66건 (2026-08-03)
prompts/
  2_codex-review.md        Codex 검증 프롬프트 (설계/코드)
  claude-code-runbook.md   Claude Code 실행 런북 (P0~P7, P5 감사 12항목)
.env.example               환경변수 명세
```

## 새 PC에서 개발 이어받기

```bash
git clone https://github.com/kym-hrdkorea/esgsafety-goldenbell.git
cd esgsafety-goldenbell
pnpm install
# 아래 '수동 이관' 대로 .env.local 을 만든 다음
pnpm typecheck && pnpm build   # 통과하면 환경변수가 맞다
pnpm dev                       # http://localhost:3000
```

`node_modules/` · `.next/` · `next-env.d.ts` · `tsconfig.tsbuildinfo` 는 **옮기지 않는다.**
`pnpm install`과 첫 빌드가 다시 만든다. `pnpm-lock.yaml`은 커밋돼 있으므로 버전은 동일하게 고정된다.

### 수동 이관 — `.env.local` (git에 없다. 이게 유일한 필수 작업)

비밀값이라 저장소에 올리지 않는다(`.gitignore`의 `.env*.local`).
**실제로 옮겨야 하는 건 Supabase 2개뿐이다.**

| 키 | 신규 PC에서 | 어디서 얻나 |
|---|---|---|
| `SUPABASE_URL` | **필수 · 동일해야 함** | Supabase 대시보드 → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | **필수 · 동일해야 함** | 같은 화면 (service_role, `anon` 아님) |
| `SESSION_SECRET` | 새로 생성해도 무해 | 아래 생성 명령 |
| `CRON_SECRET` | 새로 생성해도 무해 | 아래 생성 명령 |
| `TZ` | `Asia/Seoul` 직접 입력 | — |
| `ADMIN_LOGIN_ID` | **옮기지 않는다** | 시딩 완료됨(`admin_user` 1행) |
| `ADMIN_INIT_PASSWORD` | **옮기지 않는다** | 위와 동일. 남겨두면 재시딩 경로가 열린 채 유지된다 |

비밀값 생성 (Windows에 `openssl`이 없을 수 있으므로 Node 쪽이 확실하다)
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# openssl 이 있으면: openssl rand -base64 32
```

`SESSION_SECRET`·`CRON_SECRET`을 새로 만들어도 되는 이유: 세션 쿠키는 도메인별이라
`localhost` 쿠키와 운영 쿠키가 애초에 별개이고(그 PC에서 다시 로그인하면 끝),
cron 라우트는 자기 환경변수와만 대조한다. **덕분에 채널로 옮길 비밀값이 2개로 줄어든다.**

**전달 방법 — 권장 순서**
1. **파일을 옮기지 말고 Supabase 대시보드에서 직접 복사해 새로 작성한다.** 가장 안전하다.
2. 사내 비밀번호 관리자(공유 보관함)를 경유한다.
3. 카카오톡·이메일·메모 앱·깃 커밋으로 service role 키를 보내지 않는다.
   이 키는 RLS를 우회하는 전권 키다(그래서 이 프로젝트는 RLS를 쓰지 않는다 — `CLAUDE.md` 규칙 1).

`.env.example`에 키 목록과 형식이 있으니 그걸 복사해 채우면 된다.

### 선택 이관 — 없어도 개발은 된다

| 파일 | 없을 때 | 옮길 가치 |
|---|---|---|
| `.t13-verify.mjs` | T13 재검증만 못 함 | 낮음. 이미 32건 통과·커밋 완료. service role로 실DB를 건드려 의도적으로 gitignore돼 있다 |
| `.claude/settings.local.json` | 권한 프롬프트가 몇 번 더 뜸 | 낮음 |
| `.codex/config.toml` | Codex 검증 시 재설정 | Codex를 쓸 때만 |

### 이어받은 직후 상태 확인

```bash
git log --oneline -3        # c9e4660 feat: T13 ... 이 최상단이어야 한다
pnpm typecheck              # 무출력 = 정상
```

DB는 원격 Supabase를 공유하므로 별도 구축이 필요 없다. 현재 참가자 0명·전 회차 locked이며,
`db/*.sql`을 **다시 실행하지 않는다**(`CLAUDE.md` 규칙 9-1: DDL·시드 재적재 금지).

## 진행 순서

### 0단계 — DB 구축 (30분)
Supabase 프로젝트 생성 후 SQL Editor에서 순서대로 실행.
```
01_schema.sql → 02_seed_org.sql → 03_seed_rounds.sql → 04_seed_items.sql → 05_views.sql
```
`03_seed_rounds.sql`의 `opens_at`/`closes_at`은 **확정 일정**이다(2026-08-17 개시, 8회차 10/09 마감).
실DB와 항상 정합해야 하며, 일정이 바뀌면 시드 재실행이 아니라 8행 절대값 UPDATE로 조정하고
이 파일도 같은 값으로 함께 고친다.

확인 쿼리
```sql
SELECT count(*) FROM org_unit;    -- 50
SELECT count(*) FROM department;  -- 193
SELECT count(*) FROM quiz_item;   -- 96
SELECT item_type, count(*) FROM quiz_item GROUP BY 1;
-- MC4 60 / OX 32 / ORDER 3 / SHORT 1
```

### 1단계 — 설계 검증 (Codex, 1시간)
`prompts/2_codex-review.md`의 ① 프롬프트 사용.
**구현 전에 스키마·명세 불일치를 잡는다.** 구현 후 발견하면 마이그레이션 작업이 붙는다.

### 2단계 — 디자인 (Claude Design, 병렬 진행)
`design/1_claude-design.md` 사용. 응시 화면 답변/해설 단계를 먼저 확정한다.
**구현보다 먼저 돌린다** — 퀴즈 앱은 UI가 곧 제품이고, 나중에 얹으면 상태 구조가 어긋난다.

### 3단계 — 구현 (Claude Code, 2~3주)
`prompts/claude-code-runbook.md`로 시작.
`CLAUDE.md`와 `AGENTS.md`를 리포 루트에 배치할 것.
T00부터 카드 단위로, 하나 끝날 때마다 확인.

### 4단계 — 카드별 리뷰 (Codex)
각 카드 완료 후 `prompts/2_codex-review.md`의 ② 프롬프트로 리뷰.

### 5단계 — 부하 테스트 및 개시 (T12)
동시 100 VU, 오류율 0%, p95 < 500ms 확인 후 개시.

## 개시 전 반드시 확인
- [ ] `03_seed_rounds.sql` 실제 일정 반영, `is_published` 운영 전환 절차 확정
- [ ] 사전학습 본문 8건 작성 후 `quiz_round.prelearning_body` UPDATE
- [ ] A2 앵커 8문항(안전신문고 관련)을 실제 신고 화면·절차와 대조 검수
- [ ] 법령 시점 재확인: 2-04, 2-08, 6-05, 8-07, 8-11, 8-03
- [ ] 파일럿 응시 5~10명, 회차 평균 정답률 70~75% 구간 확인
- [ ] 관리자 계정 시딩 후 `ADMIN_INIT_PASSWORD` 환경변수 삭제
- [ ] Vercel Cron 2건 등록 (`refresh-rankings`, `expire-sessions`)
- [ ] 매주 금요일 응답 CSV 수동 백업 절차 확정 (성과 데이터 이중화)

## 미결 사항
| 항목 | 필요 시점 |
|---|---|
| 캠페인 시작일 확정 | DB 구축 시 |
| 사전학습 자료 8건 본문 | 1회차 개방 전 |
| 포상 인원·금액 확정 | 계획서 결재 시 |
