# Codex 전달 프롬프트 — ① 설계 검증 (구현 착수 전)

> 첨부: `AGENTS.md`, `CLAUDE.md`, `db/01_schema.sql`, `db/05_views.sql`,
> `db/04_seed_items.sql`, `spec/*.md`

---

당신의 역할은 **구현이 아니라 검증**입니다. 코드를 작성하지 마세요.

첨부 문서만으로 아래 5가지 정합성을 검사하고 불일치 목록을 보고해 주세요.

1. `spec/api-contract.md`의 모든 응답 필드가 `db/01_schema.sql`의 컬럼으로 충족되는가
2. `spec/business-rules.md`의 규칙 중 현재 스키마가 지원하지 못하는 것이 있는가
3. `spec/functional-spec.md`의 각 화면이 요구하는 데이터가 API 계약에 전부 있는가
4. `db/05_views.sql`의 순위 로직이 `business-rules.md` 5절과 정확히 일치하는가
   - 특히 `fn_min_rounds()`의 "공개 회차 2개 이하면 조건 미적용" 처리
   - 부서 순위의 참여자 3명 이상 필터
   - 순위 산정이 포인트 기준인지(business-rules 5.0, addendum N항),
     세션 총 소요시간·해설 열람 시간이 어디에도 쓰이지 않는지
5. `db/04_seed_items.sql`의 `answer` 자료형이 `item_type`별 규약(business-rules 4절)과 맞는가
   - `OX`=boolean / `MC4`=0~3 / `ORDER`=원본 index 배열 / `SHORT`=문자열 배열

**스키마나 문서를 고치지 마세요.** 불일치만 아래 형식으로 보고하세요.

```
[심각] 파일:줄 — 무엇이 어긋났는지 — 근거 문서·절 — 권고 수정 방향
[주의] ...
[정보] ...
```

---
---

# Codex 전달 프롬프트 — ② 코드 리뷰 (각 작업 카드 완료 후)

> 첨부: `AGENTS.md`, `CLAUDE.md`, `spec/business-rules.md`, `spec/test-scenarios.md` + 변경된 코드

방금 완료된 작업 카드 `{T00~T12}`의 코드를 리뷰해 주세요.
`AGENTS.md`의 "검사 2" 체크리스트 13개 항목을 **하나씩 근거와 함께** 판정하세요.

특히 아래 4가지는 발견 시 즉시 [심각]으로 보고하세요.
- **미응답 문항**의 조회 응답에 `answer` / `explanation` 포함 (답한 문항에 있는 것은 정상)
- `measureCode` / `anchorCode` / `level`이 어느 단계에서든 포함
- `served_at`을 두 번 이상 쓰는 코드 경로 (타이머 우회 가능)
- 선택지 셔플이 요청마다 재실행 (정답 판정 어긋남)
- 클라이언트에서 Supabase 직접 호출 또는 `NEXT_PUBLIC_SUPABASE_*` 사용

이어서 `spec/test-scenarios.md` 중 해당 카드와 관련된 케이스를 코드 기준으로 추적해 통과 여부를 판정해 주세요.

스스로 수정하지 마세요. 수정은 Claude Code가 담당합니다.
