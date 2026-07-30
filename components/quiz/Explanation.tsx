"use client";

import BellIcon from "@/components/BellIcon";

export type ExplainData = {
  isCorrect: boolean;
  isTimeout: boolean;
  correctAnswerLabel: string;
  correctDisplayIndex: number | null;
  submittedDisplayIndex: number | null;
  correctOrderDisplay: number[] | null;
  submittedOrderDisplay: number[] | null;
  submittedText: string | null;
  explanation: string;
  legalRef: string | null;
  points: number;
};

type RecapKind = "correct" | "wrong" | "dim";

const ROW_STYLE: Record<RecapKind, React.CSSProperties> = {
  correct: {
    background: "#12261a",
    borderColor: "#24B24C",
    color: "#EAF7EE",
    fontWeight: 700,
  },
  wrong: {
    background: "#2a171a",
    borderColor: "#E23A2E",
    color: "#F5D9D6",
    fontWeight: 500,
  },
  dim: {
    background: "#151b30",
    borderColor: "#232b47",
    color: "#7A85A6",
    fontWeight: 500,
  },
};

const BADGE_STYLE: Record<RecapKind, React.CSSProperties> = {
  correct: { background: "#24B24C", color: "#0b0f1d" },
  wrong: { background: "#E23A2E", color: "#fff" },
  dim: { background: "#232b47", color: "#5E6A8C" },
};

function RecapRow({
  kind,
  badge,
  label,
}: {
  kind: RecapKind;
  badge: string;
  label: string;
}) {
  return (
    <div
      className="flex min-h-12 w-full items-center gap-2.5 rounded border-[3px] px-3 py-[11px] text-[15px] leading-[1.5]"
      style={ROW_STYLE[kind]}
    >
      <span
        className="font-gb-num flex h-7 w-7 flex-none items-center justify-center rounded-[2px] text-[15px] font-bold tabular-nums"
        style={BADGE_STYLE[kind]}
      >
        {badge}
      </span>
      <span className="flex-1 text-left [text-wrap:pretty]">{label}</span>
      {kind === "correct" && (
        <span className="flex-none text-[17px] font-black text-gb-green-text">
          ✓
        </span>
      )}
      {kind === "wrong" && (
        <span className="flex-none text-[15px] font-black text-gb-red-text">
          ✕
        </span>
      )}
    </div>
  );
}

// 해설 단계: 배너 3종(정답·오답·시간초과) + 정답 표기 + 유형별 리캡 + 해설 + 근거.
// 화려한 연출(링 모션)은 정답 배너에만 쓴다 — 톤 가드레일 (design/handoff.md)
export default function Explanation({
  data,
  stem,
  itemType,
  choices,
}: {
  data: ExplainData;
  stem: string;
  itemType: "OX" | "MC4" | "ORDER" | "SHORT";
  choices: string[] | null;
}) {
  const state = data.isTimeout
    ? "timeout"
    : data.isCorrect
      ? "correct"
      : "wrong";

  // 유형별 리캡 행 구성
  let recap: { kind: RecapKind; badge: string; label: string }[] = [];
  let myAnswerLine: string | null = null;

  if (itemType === "MC4" && choices) {
    recap = choices.map((label, i) => ({
      kind:
        i === data.correctDisplayIndex
          ? "correct"
          : state === "wrong" && i === data.submittedDisplayIndex
            ? "wrong"
            : "dim",
      badge: String(i + 1),
      label,
    }));
  } else if (itemType === "OX") {
    recap = ["O", "X"].map((label, i) => ({
      kind:
        i === data.correctDisplayIndex
          ? "correct"
          : state === "wrong" && i === data.submittedDisplayIndex
            ? "wrong"
            : "dim",
      badge: label,
      label,
    }));
  } else if (itemType === "ORDER" && choices && data.correctOrderDisplay) {
    // 정답 순서로 나열하고, 내 답이 어긋난 위치에 ✕ (design/handoff.md)
    recap = data.correctOrderDisplay.map((displayIdx, pos) => {
      const mine = data.submittedOrderDisplay?.[pos];
      const kind: RecapKind =
        state === "wrong" && mine !== undefined && mine !== displayIdx
          ? "wrong"
          : "correct";
      return { kind, badge: String(pos + 1), label: choices[displayIdx] };
    });
    if (state === "wrong" && data.submittedOrderDisplay) {
      myAnswerLine = `내 답: ${data.submittedOrderDisplay
        .map((d) => d + 1)
        .join(" → ")}`;
    }
  } else if (itemType === "SHORT") {
    recap = [
      { kind: "correct", badge: "✓", label: data.correctAnswerLabel },
    ];
    if (state === "wrong" && data.submittedText) {
      myAnswerLine = `내 답: ${data.submittedText}`;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {state === "correct" && (
        <div
          className="flex items-center gap-3.5 rounded border-[3px] border-gb-green bg-gb-green-bg p-4 shadow-gb-card"
          style={{ animation: "gb-rise-in 0.25s ease-out" }}
        >
          <div className="relative h-[52px] w-[52px] flex-none">
            <span
              className="absolute inset-0 rounded-full border-2 border-gb-gold"
              style={{ animation: "gb-ring-out 0.8s ease-out 0.1s both" }}
            />
            <span
              className="absolute inset-0 rounded-full border-2 border-gb-yellow"
              style={{ animation: "gb-ring-out 1.1s ease-out 0.25s both" }}
            />
            <div className="absolute inset-0 flex items-center justify-center rounded-full border-2 border-gb-yellow-light bg-gb-gold">
              <span
                style={{
                  animation: "gb-bell-swing 0.9s ease-in-out 0.15s both",
                  transformOrigin: "50% 12%",
                  display: "inline-flex",
                }}
              >
                <BellIcon size={28} />
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-[3px]">
            <div className="text-[21px] font-extrabold tracking-[-0.01em] text-gb-green-text">
              정답입니다
            </div>
            <div className="font-gb-num flex items-baseline gap-1 font-bold text-gb-gold">
              <span className="text-[16px] tabular-nums">+{data.points}</span>
              <span className="text-[12px] text-gb-text-dim">SCORE</span>
            </div>
          </div>
        </div>
      )}

      {state === "wrong" && (
        <div
          className="flex items-center gap-3.5 rounded border-[3px] border-gb-red bg-gb-red-bg p-4 shadow-gb-card"
          style={{ animation: "gb-rise-in 0.25s ease-out" }}
        >
          <div className="flex h-11 w-11 flex-none items-center justify-center rounded-[3px] bg-gb-red">
            <svg width="22" height="22" viewBox="0 0 24 24">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="#fff"
                strokeWidth="3.2"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className="text-[21px] font-extrabold tracking-[-0.01em] text-gb-red-text">
            아쉽습니다
          </div>
        </div>
      )}

      {state === "timeout" && (
        <div
          className="flex items-center gap-3.5 rounded border-[3px] p-4 shadow-gb-card"
          style={{
            background: "#1b2136",
            borderColor: "#5E6A8C",
            animation: "gb-rise-in 0.25s ease-out",
          }}
        >
          <div className="flex h-11 w-11 flex-none items-center justify-center rounded-[3px] bg-gb-border-card">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="8.5" stroke="#C6CEE4" strokeWidth="2.4" />
              <path
                d="M12 7.5V12l3 2.2"
                stroke="#C6CEE4"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className="text-[21px] font-extrabold tracking-[-0.01em] text-gb-text-strong-sub">
            시간이 초과되었습니다
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        <h1 className="m-0 text-[19px] leading-[1.5] font-bold tracking-[-0.012em] text-white [text-wrap:pretty]">
          {stem}
        </h1>
        <div className="flex items-baseline gap-2 rounded-r-[3px] border-l-4 border-gb-gold bg-gb-bg-panel px-3 py-2.5">
          <span className="text-[13px] font-extrabold whitespace-nowrap text-gb-gold">
            정답
          </span>
          <span className="text-[16px] font-bold text-white">
            {data.correctAnswerLabel}
          </span>
        </div>
      </div>

      {recap.length > 0 && (
        <div className="flex flex-col gap-2">
          {recap.map((row, i) => (
            <RecapRow key={i} {...row} />
          ))}
          {myAnswerLine && (
            <div className="px-0.5 pt-0.5 text-[13px] font-bold text-gb-red-text">
              {myAnswerLine}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="h-[13px] w-1 bg-gb-yellow" />
          <div className="text-[13px] font-extrabold tracking-[0.08em] text-gb-text-strong-sub">
            해설
          </div>
        </div>
        <p className="m-0 text-[16px] leading-[1.65] text-gb-text-body [text-wrap:pretty]">
          {data.explanation}
        </p>
      </div>

      {data.legalRef && (
        <div className="flex flex-col gap-2 pb-2">
          <div className="flex items-center gap-2">
            <div className="h-[13px] w-1 bg-gb-text-dim" />
            <div className="text-[13px] font-extrabold tracking-[0.08em] text-gb-text-secondary">
              근거
            </div>
          </div>
          <div className="text-[14px] text-gb-text-secondary tabular-nums">
            {data.legalRef}
          </div>
        </div>
      )}
    </div>
  );
}
