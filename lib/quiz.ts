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

// Supabase RPC의 RETURNS TABLE 결과는 배열로 오고, 일부 로컬 mock은 단일
// 객체로 반환할 수 있다. 두 형태를 한 곳에서 정규화해 재시도 경로가 같은
// 세션 행을 사용하게 한다.
export function sessionFromRpc(data: unknown): Session {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error("세션 RPC가 세션 행을 반환하지 않았습니다");
  }
  return row as Session;
}

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

// 답변·다음 버튼 재시도용 점수/완료 상태 재조정.
// DB 함수가 세션 행을 FOR UPDATE로 잠근 뒤 문항을 집계하므로, 동시에
// 여러 답변이 확정되어도 오래된 score가 나중에 덮어쓰이지 않는다.
export async function reconcileSession(
  sessionId: string,
  complete: boolean
): Promise<Session> {
  const { data, error } = await getDb().rpc("fn_reconcile_quiz_session", {
    p_session_id: sessionId,
    p_complete: complete,
  });
  if (error) throw new Error(error.message);
  return sessionFromRpc(data);
}

// 만료 전이: DB 함수 안에서 세션 잠금 → 미응답 문항 확정 → 점수 재집계
// → expired 전이를 한 번에 처리한다. 이미 만료·완료된 호출도 멱등이다.
export async function expireSession(session: Session): Promise<Session> {
  const { data, error } = await getDb().rpc("fn_expire_quiz_session", {
    p_session_id: session.id,
  });
  if (error) throw new Error(error.message);
  return sessionFromRpc(data);
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
