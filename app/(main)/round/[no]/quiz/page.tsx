"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Timer from "@/components/quiz/Timer";
import Mc4Item from "@/components/quiz/Mc4Item";
import Explanation, { type ExplainData } from "@/components/quiz/Explanation";

type ItemPayload = {
  seq: number;
  totalItems: number;
  itemType: "OX" | "MC4" | "ORDER" | "SHORT";
  stem: string;
  choices: string[] | null;
  remainingSec: number;
  timeLimitSec: number;
  phase: "answering" | "explained";
} & Partial<ExplainData & { score: number; isLast: boolean }>;

type SessionInfo = {
  sessionId: string;
  totalItems: number;
  currentIndex: number;
  roundNo: number;
  theme: string;
};

// 진행 상태는 전부 서버(quiz_session)에 있다. 브라우저 스토리지 사용 금지 (규칙 5)
export default function QuizPage({
  params,
}: {
  params: Promise<{ no: string }>;
}) {
  const { no } = use(params);
  const router = useRouter();

  const [session, setSession] = useState<SessionInfo | null>(null);
  const [item, setItem] = useState<ItemPayload | null>(null);
  const [explain, setExplain] = useState<ExplainData | null>(null);
  const [isLast, setIsLast] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [tried, setTried] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);

  const fetchItem = useCallback(async () => {
    const res = await fetch(`/api/rounds/${no}/item`);
    if (!res.ok) throw await res.json();
    const data: ItemPayload = await res.json();
    setItem(data);
    setSelected(null);
    setTried(false);
    submittingRef.current = false;
    if (data.phase === "explained") {
      setExplain(data as unknown as ExplainData);
      setIsLast(data.isLast === true);
    } else {
      setExplain(null);
    }
  }, [no]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/rounds/${no}/session`, {
          method: "POST",
        });
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (!res.ok) {
          const body = await res.json();
          setBlocked(body.message);
          return;
        }
        const s = await res.json();
        setSession(s);
        await fetchItem();
      } catch {
        setBlocked("문제가 발생했습니다. 잠시 후 다시 시도해 주세요.");
      }
    })();
  }, [no, router, fetchItem]);

  // 제출(수동·자동 공통). 판정은 서버가 한다 — 시간초과 여부도 서버 응답을 따른다
  const submit = useCallback(
    async (displayIndex: number | null) => {
      if (!item || submittingRef.current) return;
      submittingRef.current = true;
      setBusy(true);
      try {
        const res = await fetch(`/api/rounds/${no}/answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            displayIndex === null
              ? { seq: item.seq }
              : { seq: item.seq, submitted: displayIndex }
          ),
        });
        if (!res.ok) {
          submittingRef.current = false;
          return;
        }
        const data = await res.json();
        setExplain(data);
        setIsLast(data.isLast === true);
      } finally {
        setBusy(false);
      }
    },
    [item, no]
  );

  const onSubmitClick = () => {
    if (!item) return;
    if (selected === null) {
      setTried(true);
      return;
    }
    void submit(selected);
  };

  // 타이머 0초 → 자동 제출. 서버 판정이 시간초과를 확정한다 (D5)
  const onExpire = useCallback(() => {
    setTimeout(() => void submit(null), 400);
  }, [submit]);

  const onNext = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/rounds/${no}/next`, { method: "POST" });
      if (!res.ok) return;
      const data = await res.json();
      if (data.isCompleted) {
        router.push(`/round/${no}/result`);
        return;
      }
      await fetchItem();
    } finally {
      setBusy(false);
    }
  };

  if (blocked) {
    return (
      <main className="mx-auto flex min-h-[calc(100dvh-10px)] w-full max-w-[640px] flex-col items-center justify-center gap-6 px-5 text-center">
        <p className="text-[16px] leading-[1.65] text-gb-text-body">
          {blocked}
        </p>
        <button
          type="button"
          className="gb-cta max-w-[320px]"
          onClick={() => router.push("/")}
        >
          홈으로
        </button>
      </main>
    );
  }

  if (!session || !item) {
    return (
      <main className="flex min-h-[calc(100dvh-10px)] items-center justify-center">
        <p className="text-[14px] text-gb-text-secondary">불러오는 중...</p>
      </main>
    );
  }

  const qno = item.seq + 1;
  const phase = explain ? "explained" : "answering";

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-10px)] w-full max-w-[640px] flex-col">
      {/* 헤더: 회차 라벨 · 진행 n/12 · 12칸 진행 블록 · (답변 단계) 타이머 */}
      <div className="flex flex-col gap-[11px] border-b-[3px] border-gb-border-divider bg-gb-bg-panel px-4 pt-3.5 pb-3">
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <div className="h-[15px] w-1 flex-none bg-gb-yellow" />
            <div className="truncate text-[13px] font-bold text-gb-text-strong-sub">
              {session.roundNo}회차 · {session.theme}
            </div>
          </div>
          <div className="font-gb-num flex items-baseline gap-[2px] font-bold tabular-nums">
            <span className="text-[22px] leading-none text-gb-yellow">
              {String(qno).padStart(2, "0")}
            </span>
            <span className="text-[15px] leading-none text-gb-text-dim">
              / {session.totalItems}
            </span>
          </div>
        </div>

        <div className="flex gap-[3px]">
          {Array.from({ length: session.totalItems }, (_, i) => {
            const n = i + 1;
            const bg =
              n < qno ? "#C9A227" : n === qno ? "#FFD400" : "#232b47";
            return (
              <div
                key={i}
                className="h-2 flex-1 rounded-[1px]"
                style={{
                  background: bg,
                  ...(n === qno
                    ? { boxShadow: "0 0 0 2px #12172b, 0 0 0 3px #FFD400" }
                    : {}),
                }}
              />
            );
          })}
        </div>

        {phase === "answering" && (
          <Timer
            key={`${item.seq}-${item.remainingSec}`}
            remainingSec={item.remainingSec}
            timeLimitSec={item.timeLimitSec}
            running={phase === "answering"}
            onExpire={onExpire}
          />
        )}
      </div>

      {/* 본문 */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pt-[18px] pb-2">
        {phase === "answering" ? (
          <>
            <div className="flex flex-col gap-2.5">
              <div className="self-start rounded-[2px] bg-gb-gold px-2 py-1 text-[11px] font-bold tracking-[0.12em] text-gb-bg-screen">
                {item.itemType === "MC4"
                  ? "4지선다"
                  : item.itemType === "OX"
                    ? "O / X"
                    : item.itemType === "ORDER"
                      ? "순서배열"
                      : "단답"}
              </div>
              <h1 className="m-0 text-[22px] leading-[1.52] font-bold tracking-[-0.012em] text-white [text-wrap:pretty]">
                {item.stem}
              </h1>
            </div>

            {item.itemType === "MC4" && item.choices ? (
              <Mc4Item
                choices={item.choices}
                selected={selected}
                onSelect={(i) => {
                  setSelected(i);
                  setTried(false);
                }}
              />
            ) : (
              // T03에서 4종 완성 (M항). 45초 경과 시 자동으로 시간초과 해설로 넘어간다
              <p className="text-[15px] leading-[1.6] text-gb-text-secondary">
                이 유형은 아직 구현되지 않았습니다
              </p>
            )}
          </>
        ) : (
          <Explanation data={explain!} stem={item.stem} choices={item.choices} />
        )}
      </div>

      {/* 하단 고정 CTA */}
      <div className="flex flex-col gap-2 border-t-[3px] border-gb-border-divider bg-gb-bg-panel px-4 pt-2.5 pb-4">
        {phase === "answering" ? (
          <>
            <div
              className="flex min-h-[18px] items-center gap-1.5 text-[13px] font-bold text-gb-yellow"
              style={{
                visibility: tried && selected === null ? "visible" : "hidden",
              }}
            >
              <span className="font-gb-num font-bold">!</span>
              <span>답을 선택해 주세요</span>
            </div>
            <button
              type="button"
              onClick={onSubmitClick}
              disabled={busy || item.itemType !== "MC4"}
              className="w-full min-h-[56px] cursor-pointer rounded text-[19px] font-extrabold tracking-[0.02em] active:translate-x-1 active:translate-y-1"
              style={
                selected !== null && !busy
                  ? {
                      background: "#FFD400",
                      border: "3px solid #FFE873",
                      boxShadow: "5px 5px 0 #6B5200",
                      color: "#12172b",
                    }
                  : {
                      background: "#232b47",
                      border: "3px solid #2f3a5e",
                      color: "#6F7A9B",
                    }
              }
            >
              제출하기
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onNext}
            disabled={busy}
            className="gb-cta text-[19px]"
          >
            {isLast ? "결과 보기" : "다음 문제"}
          </button>
        )}
      </div>
    </main>
  );
}
