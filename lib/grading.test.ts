// 채점 로직 단위테스트 — Node 내장 러너 사용 (pnpm test)
// spec/test-scenarios.md E 그룹 + business-rules 5.0 포인트 산식을 검증한다.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  answerLabel,
  calcItemPoints,
  gradeMc4,
  gradeOrder,
  gradeOx,
  gradeShort,
  normalizeShort,
  toOriginalIndex,
} from "./grading.ts";

describe("OX", () => {
  test("E1: answer=true, 제출 true → 정답", () => {
    assert.equal(gradeOx(true, true), true);
  });
  test("answer=true, 제출 false → 오답", () => {
    assert.equal(gradeOx(false, true), false);
  });
  test("answer=false, 제출 false → 정답", () => {
    assert.equal(gradeOx(false, false), true);
  });
});

describe("MC4", () => {
  // business-rules 4절 예시: 원본 정답 2, choice_order=[3,2,0,1]
  test("E2: 화면 position 1 제출 → 정답, 저장값은 원본 2", () => {
    const r = gradeMc4([3, 2, 0, 1], 1, 2);
    assert.equal(r.isCorrect, true);
    assert.equal(r.submittedOriginal, 2); // E4: 화면 위치가 아닌 원본 index
  });
  test("E3: 같은 조건, position 0 제출 → 오답 (원본 3 저장)", () => {
    const r = gradeMc4([3, 2, 0, 1], 0, 2);
    assert.equal(r.isCorrect, false);
    assert.equal(r.submittedOriginal, 3);
  });
  test("항등 셔플에서 position=answer → 정답", () => {
    assert.equal(gradeMc4([0, 1, 2, 3], 2, 2).isCorrect, true);
  });
  test("경계: 범위 밖 위치는 예외", () => {
    assert.throws(() => toOriginalIndex([3, 2, 0, 1], 4));
    assert.throws(() => toOriginalIndex([3, 2, 0, 1], -1));
    assert.throws(() => toOriginalIndex([3, 2, 0, 1], 1.5));
  });
});

describe("ORDER", () => {
  // 1-05: answer=[1,3,0,2]. choice_order=[2,0,3,1] → 화면 0=원본2, 1=원본0, 2=원본3, 3=원본1
  const choiceOrder = [2, 0, 3, 1];
  const answer = [1, 3, 0, 2];
  test("E5: 정답 순서의 표시 위치 배열 → 정답", () => {
    // 원본 1→화면3, 3→화면2, 0→화면1, 2→화면0
    const r = gradeOrder(choiceOrder, [3, 2, 1, 0], answer);
    assert.equal(r.isCorrect, true);
    assert.deepEqual(r.submittedOriginal, [1, 3, 0, 2]); // 원본 인덱스로 저장
  });
  test("E6: 1개 위치가 어긋나면 오답 (부분점수 없음)", () => {
    const r = gradeOrder(choiceOrder, [2, 3, 1, 0], answer);
    assert.equal(r.isCorrect, false);
  });
  test("경계: 길이 불일치 → 오답", () => {
    assert.equal(gradeOrder(choiceOrder, [3, 2, 1], answer).isCorrect, false);
  });
  test("5지 순서배열(7-03)도 동일 문법", () => {
    // answer=[1,3,0,4,2], 항등 셔플
    const r = gradeOrder([0, 1, 2, 3, 4], [1, 3, 0, 4, 2], [1, 3, 0, 4, 2]);
    assert.equal(r.isCorrect, true);
  });
});

describe("SHORT", () => {
  const answers = ["아차사고"];
  test("E7: 정확한 정답 → 정답", () => {
    assert.equal(gradeShort("아차사고", answers), true);
  });
  test("E8: 공백 변형 '아차 사고' → 정답 (정규화)", () => {
    assert.equal(gradeShort("아차 사고", answers), true);
  });
  test("앞뒤 공백·전각 공백도 정규화", () => {
    assert.equal(gradeShort("  아차사고  ", answers), true);
    assert.equal(gradeShort("아차　사고", answers), true);
  });
  test("E9: '아차사고요' → 오답 (정확한 정답만 인정)", () => {
    assert.equal(gradeShort("아차사고요", answers), false);
  });
  test("빈 문자열·공백만 → 오답", () => {
    assert.equal(gradeShort("", answers), false);
    assert.equal(gradeShort("   ", answers), false);
  });
  test("NFKC: 전각 영숫자를 반각으로 정규화", () => {
    assert.equal(gradeShort("ＡＢＣ１", ["ABC1"]), true);
  });
  test("정규화 순서: trim → 공백제거 → NFKC", () => {
    assert.equal(normalizeShort(" 아차 사고 "), "아차사고");
  });
});

describe("포인트 산식 (business-rules 5.0)", () => {
  const cfg = { limitSec: 45, basePoints: 100, timeBonusMax: 100 };
  test("즉답 정답(0ms) → 200P", () => {
    assert.equal(
      calcItemPoints({ isCorrect: true, isTimeout: false, elapsedMs: 0, ...cfg }),
      200
    );
  });
  test("절반 경과(22.5초) 정답 → 150P", () => {
    assert.equal(
      calcItemPoints({
        isCorrect: true, isTimeout: false, elapsedMs: 22_500, ...cfg,
      }),
      150
    );
  });
  test("마지막 순간(45초 정각) 정답 → 100P", () => {
    assert.equal(
      calcItemPoints({
        isCorrect: true, isTimeout: false, elapsedMs: 45_000, ...cfg,
      }),
      100
    );
  });
  test("경계: 제한시간 초과 경과값도 음수 보너스 없이 100P로 클램프", () => {
    assert.equal(
      calcItemPoints({
        isCorrect: true, isTimeout: false, elapsedMs: 46_000, ...cfg,
      }),
      100
    );
  });
  test("오답 → 0P", () => {
    assert.equal(
      calcItemPoints({
        isCorrect: false, isTimeout: false, elapsedMs: 1_000, ...cfg,
      }),
      0
    );
  });
  test("시간초과 → 0P", () => {
    assert.equal(
      calcItemPoints({
        isCorrect: true, isTimeout: true, elapsedMs: 46_000, ...cfg,
      }),
      0
    );
  });
  test("config 값 변경이 산식에 반영된다 (하드코딩 없음)", () => {
    assert.equal(
      calcItemPoints({
        isCorrect: true, isTimeout: false, elapsedMs: 0,
        limitSec: 30, basePoints: 50, timeBonusMax: 200,
      }),
      250
    );
  });
});

describe("answerLabel", () => {
  test("OX", () => {
    assert.equal(answerLabel("OX", true, null, null), "O");
    assert.equal(answerLabel("OX", false, null, null), "X");
  });
  test("MC4: 원본 정답 인덱스의 라벨", () => {
    assert.equal(answerLabel("MC4", 2, ["A", "B", "C", "K"], [3, 1, 0, 2]), "C");
  });
  test("ORDER: 화면 표시 순번으로 표기", () => {
    // answer=[1,3,0,2], choice_order=[2,0,3,1] → 화면 순번 4 → 3 → 2 → 1
    assert.equal(
      answerLabel("ORDER", [1, 3, 0, 2], null, [2, 0, 3, 1]),
      "4 → 3 → 2 → 1"
    );
  });
  test("SHORT: 대표 정답", () => {
    assert.equal(answerLabel("SHORT", ["아차사고"], null, null), "아차사고");
  });
});
