// 유형별 채점 로직 (★ 단위테스트 대상 — T03에서 4종 완성)
// T02 범위: MC4. 채점은 항상 서버에서, 원본 인덱스 기준으로 저장한다.

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

// MC4: 제출은 화면 위치(0~3), 판정은 원본 인덱스, 저장도 원본 인덱스 (E2~E4)
export function gradeMc4(
  choiceOrder: number[],
  displayPosition: number,
  answer: number
): { isCorrect: boolean; submittedOriginal: number } {
  const submittedOriginal = toOriginalIndex(choiceOrder, displayPosition);
  return { isCorrect: submittedOriginal === answer, submittedOriginal };
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
