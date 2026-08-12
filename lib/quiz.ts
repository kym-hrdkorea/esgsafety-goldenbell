import { NextResponse } from "next/server";
import { getDb } from "./db";
import { getConfigValue } from "./config";
import { answerLabel, type ItemType } from "./grading";

// 응시 API 공용 헬퍼. 회차 개방 판정은 항상 서버 시각으로 한다 (business-rules 2절).

export const MSG = {
  generic: "문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  notOpen: "이 회차는 아직 열리지 않았습니다.",
  closed: "이 회차는 종료되었습니다. 복습으로 다시 볼 수 있습니다.",
  alreadyCompleted: "이미 참여한 회차입니다. 재응시는 할 수 없습니다.",
  expired: "30분 이상 진행이 없어 이번 회차가 종료되었습니다.",
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
  return Number.isInteger(no) && no >= 1 && no <= 6 ? no : null;
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
  last_activity_at: string;
};

export async function loadSession(
  participantId: string,
  roundNo: number
): Promise<Session | null> {
  const { data, error } = await getDb()
    .from("quiz_session")
    .select(
      "id, participant_id, round_no, status, current_index, total_items, score, last_activity_at"
    )
    .eq("participant_id", participantId)
    .eq("round_no", roundNo)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as Session | null;
}

// 30분 방치 세션의 lazy 만료 (business-rules 3.4). 접근 시점마다 검사하고
// /api/cron/expire-sessions가 주기 정리로 보조한다. 판정은 서버 시각 기준(규칙 3),
// 허용 시간은 app_config.session_timeout_min에서 읽는다(규칙 7).
export async function expireIfIdle(session: Session): Promise<Session> {
  if (session.status !== "in_progress") return session;
  const timeoutMin = await getConfigValue("session_timeout_min");
  const idleMs = Date.now() - new Date(session.last_activity_at).getTime();
  if (idleMs <= timeoutMin * 60_000) return session;
  return expireSession(session);
}

// 만료 전이: 문항 확정 → 점수 재집계 → 세션 claim 순서.
// 각 단계가 멱등이라 중간 실패는 다음 접근의 재실행으로 자가 복구된다.
export async function expireSession(session: Session): Promise<Session> {
  const db = getDb();

  // 1) 미응답 문항 전부 시간초과 확정 (F1). 진행 중 답변과의 경합은
  //    answered_at IS NULL 가드로 한쪽만 이긴다.
  const { error: itemErr } = await db
    .from("quiz_session_item")
    .update({ is_timeout: true, is_correct: false, submitted: null })
    .eq("session_id", session.id)
    .is("answered_at", null)
    .eq("is_timeout", false);
  if (itemErr) throw new Error(itemErr.message);

  // 2) 점수는 확정 문항의 DB 집계로 재계산 (answer 경로의 finalize와 동일 방식)
  const { count, error: cntErr } = await db
    .from("quiz_session_item")
    .select("id", { count: "exact", head: true })
    .eq("session_id", session.id)
    .eq("is_correct", true);
  if (cntErr) throw new Error(cntErr.message);
  const score = count ?? 0;

  // 3) 세션 전이. expired에도 completed_at을 "종료 시각"으로 기록한다 (addendum E항)
  const { error: sesErr } = await db
    .from("quiz_session")
    .update({
      status: "expired",
      completed_at: new Date().toISOString(),
      score,
    })
    .eq("id", session.id)
    .eq("status", "in_progress");
  if (sesErr) throw new Error(sesErr.message);

  return { ...session, status: "expired", score };
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
