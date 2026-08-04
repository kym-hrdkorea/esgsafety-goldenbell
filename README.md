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
  decisions-addendum.md    확정 결정 A~M·G-1~G-3·N ★ B·C·D·E·F·K항은 이 문서에만 있다
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
  tasks.md                 작업 카드 T00~T12 (수직 슬라이스)
  ux-findings.md           참가자 화면 UI/UX 감사 (A·B절 완료, C절 미해결)
  code-review-findings.md  전체 코드 리뷰 66건 (2026-08-03)
prompts/
  2_codex-review.md        Codex 검증 프롬프트 (설계/코드)
  claude-code-runbook.md   Claude Code 실행 런북 (P0~P7, P5 감사 12항목)
.env.example               환경변수 명세
```

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
