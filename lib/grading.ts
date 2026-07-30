// 유형별 채점 로직 (★ 단위테스트 대상 — lib/grading.test.ts)
// 채점은 항상 서버에서, 원본 인덱스 기준으로 저장한다 (business-rules 4절).

export type ItemType = "OX" | "MC4" | "ORDER" | "SHORT";

// 화면 표시 위치 → 원본 인덱스 변환.
// choice_order = [3,2,0,1] 이면 화면 1번(0-based 0)에 원본 3번이 표시된다.
export function toOriginalIndex(
  choiceOrder: number[],
  displayPosition: number
): number {
  if (
    !Number.isInteger(displayPosition) ||
    displayPosition < 0 ||
    displayPosition >= choiceOrder.length
  ) {
    throw new Error(`잘못된 표시 위치: ${displayPosition}`);
  }
  return choiceOrder[displayPosition];
}

// OX: 제출값과 정답 모두 boolean (E1)
export function gradeOx(submitted: boolean, answer: boolean): boolean {
  return submitted === answer;
}

// MC4: 제출은 화면 위치(0~3), 판정은 원본 인덱스, 저장도 원본 인덱스 (E2~E4)
export function gradeMc4(
  choiceOrder: number[],
  displayPosition: number,
  answer: number
): { isCorrect: boolean; submittedOriginal: number } {
  const submittedOriginal = toOriginalIndex(choiceOrder, displayPosition);
  return { isCorrect: submittedOriginal === answer, submittedOriginal };
}

// ORDER: 제출은 화면 표시 위치 배열(탭 순서). 각 위치를 원본 인덱스로 변환 후
// answer 배열과 완전일치해야 정답. 부분점수 없음 (E5·E6)
export function gradeOrder(
  choiceOrder: number[],
  displayPositions: number[],
  answer: number[]
): { isCorrect: boolean; submittedOriginal: number[] } {
  const submittedOriginal = displayPositions.map((p) =>
    toOriginalIndex(choiceOrder, p)
  );
  const isCorrect =
    submittedOriginal.length === answer.length &&
    submittedOriginal.every((v, i) => v === answer[i]);
  return { isCorrect, submittedOriginal };
}

// SHORT 정규화: trim → 모든 공백 제거 → NFKC (business-rules 4절 순서 그대로)
export function normalizeShort(s: string): string {
  return s.trim().replace(/\s+/g, "").normalize("NFKC");
}

// SHORT: 정규화 후 answer 배열 포함 검사. 유사도 매칭 없음 — 정확한 정답만 (E7~E9)
export function gradeShort(submitted: string, answers: string[]): boolean {
  const normalized = normalizeShort(submitted);
  if (normalized.length === 0) return false;
  return answers.some((a) => normalizeShort(a) === normalized);
}

// 문항 포인트 (business-rules 5.0, addendum N항)
//   정답:        basePoints + ROUND(timeBonusMax × 남은시간 / 제한시간)
//   오답·시간초과: 0
// 시간 요소는 문항별 답변 시간(elapsed_ms)만 반영한다. 해설 열람 시간은 무관.
export function calcItemPoints(args: {
  isCorrect: boolean;
  isTimeout: boolean;
  elapsedMs: number;
  limitSec: number;
  basePoints: number;
  timeBonusMax: number;
}): number {
  if (!args.isCorrect || args.isTimeout) return 0;
  const limitMs = args.limitSec * 1000;
  const remainingMs = Math.max(limitMs - args.elapsedMs, 0);
  return (
    args.basePoints + Math.round((args.timeBonusMax * remainingMs) / limitMs)
  );
}

// 해설 화면의 `정답: {정답}` 표기용 라벨.
// ORDER는 화면 표시 순번 기준("2 → 4 → 1 → 5 → 3")으로 표기한다.
export function answerLabel(
  itemType: ItemType,
  answer: unknown,
  choices: string[] | null,
  choiceOrder: number[] | null
): string {
  switch (itemType) {
    case "OX":
      return answer === true ? "O" : "X";
    case "MC4":
      return choices?.[answer as number] ?? "";
    case "ORDER": {
      const seq = answer as number[];
      if (!choiceOrder) return seq.map((o) => o + 1).join(" → ");
      return seq.map((o) => choiceOrder.indexOf(o) + 1).join(" → ");
    }
    case "SHORT": {
      const list = answer as string[];
      return list[0] ?? "";
    }
  }
}
