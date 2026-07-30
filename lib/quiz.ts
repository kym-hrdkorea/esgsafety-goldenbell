import { NextResponse } from "next/server";
import { getDb } from "./db";
import { answerLabel, type ItemType } from "./grading";

// 응시 API 공용 헬퍼. 회차 개방 판정은 항상 서버 시각으로 한다 (business-rules 2절).

export const MSG = {
  generic: "문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  notOpen: "이 회차는 아직 열리지 않았습니다.",
  closed: "이 회차는 종료되었습니다. 복습으로 다시 볼 수 있습니다.",
  alreadyCompleted: "이미 참여한 회차입니다. 재응시는 할 수 없습니다.",
} as const;

export function apiError(
  status: number,
  code: string,
  message: string = MSG.generic,
  extra: Record<string, unknown> = {}
) {
  return NextResponse.json({ code, message, ...extra }, { status });
}

export function parseRoundNo(param: string): number | null {
  const no = Number(param);
  return Number.isInteger(no) && no >= 1 && no <= 8 ? no : null;
}

export type Round = {
  round_no: number;
  theme: string;
  opens_at: string;
  closes_at: string;
  is_published: boolean;
};

export async function loadRound(no: number): Promise<Round | null> {
  const { data, error } = await getDb()
    .from("quiz_round")
    .select("round_no, theme, opens_at, closes_at, is_published")
    .eq("round_no", no)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// 개방 조건 = is_published AND now() BETWEEN opens_at AND closes_at
export function roundState(round: Round): "locked" | "open" | "closed" {
  const now = Date.now();
  if (!round.is_published || now < new Date(round.opens_at).getTime()) {
    return "locked";
  }
  if (now > new Date(round.closes_at).getTime()) {
    return "closed";
  }
  return "open";
}

export type Session = {
  id: string;
  participant_id: string;
  round_no: number;
  status: "in_progress" | "completed" | "expired";
  current_index: number;
  total_items: number;
  score: number;
};

export async function loadSession(
  participantId: string,
  roundNo: number
): Promise<Session | null> {
  const { data, error } = await getDb()
    .from("quiz_session")
    .select(
      "id, participant_id, round_no, status, current_index, total_items, score"
    )
    .eq("participant_id", participantId)
    .eq("round_no", roundNo)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as Session | null;
}

// 해설 단계 응답의 유형별 리캡 필드. 채점 확정 후에만 호출된다 (규칙 2).
// submitted는 DB 저장값(원본 인덱스 공간)이다.
export type ExplainExtras = {
  correctAnswerLabel: string;
  correctDisplayIndex: number | null; // MC4: 정답 화면 위치 / OX: 0=O, 1=X
  submittedDisplayIndex: number | null;
  correctOrderDisplay: number[] | null; // ORDER: 정답 순서(화면 위치)
  submittedOrderDisplay: number[] | null;
  submittedText: string | null; // SHORT: 제출 원문
};

export function explainExtras(
  itemType: ItemType,
  answer: unknown,
  choices: string[] | null,
  choiceOrder: number[] | null,
  submitted: unknown
): ExplainExtras {
  const extras: ExplainExtras = {
    correctAnswerLabel: answerLabel(itemType, answer, choices, choiceOrder),
    correctDisplayIndex: null,
    submittedDisplayIndex: null,
    correctOrderDisplay: null,
    submittedOrderDisplay: null,
    submittedText: null,
  };
  switch (itemType) {
    case "MC4":
      if (choiceOrder) {
        extras.correctDisplayIndex = choiceOrder.indexOf(answer as number);
        if (typeof submitted === "number") {
          extras.submittedDisplayIndex = choiceOrder.indexOf(submitted);
        }
      }
      break;
    case "OX":
      extras.correctDisplayIndex = answer === true ? 0 : 1;
      if (typeof submitted === "boolean") {
        extras.submittedDisplayIndex = submitted ? 0 : 1;
      }
      break;
    case "ORDER":
      if (choiceOrder) {
        extras.correctOrderDisplay = (answer as number[]).map((o) =>
          choiceOrder.indexOf(o)
        );
        if (Array.isArray(submitted)) {
          extras.submittedOrderDisplay = (submitted as number[]).map((o) =>
            choiceOrder.indexOf(o)
          );
        }
      }
      break;
    case "SHORT":
      if (typeof submitted === "string") {
        extras.submittedText = submitted;
      }
      break;
  }
  return extras;
}
