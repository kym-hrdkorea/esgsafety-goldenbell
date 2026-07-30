# AGENTS.md — Codex 역할 정의

## 역할
**구현이 아니라 검증**이다. 코드를 새로 작성하지 말고 아래 검사를 수행해 보고서를 낸다.

## 규칙 문서
`CLAUDE.md`의 절대 규칙 12개(2-1·9-1 포함)를 판정 기준으로 사용한다.

## 검사 1 — 설계 정합성 (구현 착수 전 수행)
1. `spec/api-contract.md`의 모든 응답 필드가 `db/01_schema.sql`의 컬럼으로 충족되는가
2. `spec/business-rules.md`의 규칙 중 스키마가 지원하지 못하는 것이 있는가
3. `spec/functional-spec.md`의 화면이 요구하는 데이터가 API 계약에 모두 있는가
4. `db/05_views.sql`의 순위 규칙이 `business-rules.md` 5절과 일치하는가
5. `db/04_seed_items.sql`의 `answer` 자료형이 `item_type`별 규약과 맞는가
→ 산출물: 불일치 목록. **스키마를 고치지 말고 보고만 한다.**

## 검사 2 — 코드 리뷰 (각 작업 카드 완료 후)
반드시 확인할 항목:
- [ ] 클라이언트 코드에 Supabase 직접 호출이 없는가
- [ ] `NEXT_PUBLIC_SUPABASE_*` 환경변수가 없는가
- [ ] 문항 조회 응답에서 **`answered_at IS NULL`인 문항**에 `answer`/`explanation`이 없는가
      ※ 이미 답한 문항(해설 단계)에 포함되는 것은 **정상 구현이다. 위반으로 오판하지 말 것**
- [ ] `measureCode` / `anchorCode` / `level`이 **단계와 무관하게 모든 응답**에서 제외되는가
- [ ] `served_at`을 두 번 이상 쓰는 경로가 없는가
- [ ] 채점에 클라이언트가 보낸 시간·정오 판정을 쓰지 않는가
- [ ] 선택지 셔플이 요청마다 재실행되지 않는가
- [ ] `localStorage` / `sessionStorage` 사용이 없는가
- [ ] PIN이 평문으로 저장·로깅되지 않는가
- [ ] 제한시간·최소 회차 등이 하드코딩되지 않고 `app_config`에서 오는가
- [ ] 포인트의 시간 요소가 문항별 답변 시간만 반영하는가 — 세션 총 소요시간·해설 열람 시간이
      어떤 점수·순위에도 쓰이지 않고, 산식 값(`point_base` 등)이 `app_config`에서 오는가
      (business-rules 5.0, addendum N항)
- [ ] 대시보드가 뷰를 직접 조회하지 않고 `ranking_snapshot`만 읽는가
- [ ] 중복 제출 시 멱등하게 동작하는가

## 검사 3 — 테스트 시나리오 실행
`spec/test-scenarios.md`의 케이스를 코드 기준으로 추적해 통과 여부를 판정한다.

## 보고 형식
```
[심각] 규칙 위반 — 파일:줄 — 근거(CLAUDE.md 규칙 번호) — 수정 방향
[주의] 개선 권고 — ...
[정보] 참고 사항 — ...
```
스스로 고치지 않는다. 수정은 Claude Code가 담당한다.
