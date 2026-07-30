"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Timer from "@/components/quiz/Timer";
import Mc4Item from "@/components/quiz/Mc4Item";
import OxItem from "@/components/quiz/OxItem";
import OrderItem from "@/components/quiz/OrderItem";
import ShortItem from "@/components/quiz/ShortItem";
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

const TYPE_LABEL = {
  MC4: "4지선다",
  OX: "O / X",
  ORDER: "순서배열",
  SHORT: "단답",
} as const;

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
  // 유형별 입력 상태 (문항 전환 시 초기화)
  const [selected, setSelected] = useState<number | null>(null); // MC4·OX
  const [orderSeq, setOrderSeq] = useState<number[]>([]); // ORDER: 표시 위치, 탭 순서
  const [shortText, setShortText] = useState(""); // SHORT
  const [tried, setTried] = useState(false);
  const [blocked, setBlocked] = useState<{
    message: string;
    action: "home" | "result";
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);
  const currentSeqRef = useRef(-1); // 지연된 응답·재시도가 다른 문항 화면을 덮지 않게 하는 가드
  const retryTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearRetries = () => {
    retryTimersRef.current.forEach((t) => clearTimeout(t));
    retryTimersRef.current = [];
  };

  const resetInputs = () => {
    setSelected(null);
    setOrderSeq([]);
    setShortText("");
    setTried(false);
  };

  const fetchItem = useCallback(async () => {
    const res = await fetch(`/api/rounds/${no}/item`);
    if (res.status === 410) {
      // 30분 방치 만료 — 이어하기 불허, 결과 화면으로 안내 (business-rules 3.4, F2)
      const body = await res.json();
      setBlocked({ message: body.message, action: "result" });
      return;
    }
    if (res.status === 409) {
      router.replace(`/round/${no}/result`);
      return;
    }
    if (!res.ok) throw await res.json();
    const data: ItemPayload = await res.json();
    clearRetries(); // 이전 문항의 자동 제출 재시도는 문항 전환과 함께 폐기
    currentSeqRef.current = data.seq;
    setItem(data);
    resetInputs();
    submittingRef.current = false;
    if (data.phase === "explained") {
      setExplain(data as unknown as ExplainData);
      setIsLast(data.isLast === true);
    } else {
      setExplain(null);
    }
  }, [no, router]);

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
        if (res.status === 409) {
          // 완료·만료 세션은 결과 화면으로 (business-rules 3.1, addendum K항)
          router.replace(`/round/${no}/result`);
          return;
        }
        if (!res.ok) {
          const body = await res.json();
          setBlocked({ message: body.message, action: "home" });
          return;
        }
        const s = await res.json();
        setSession(s);
        await fetchItem();
      } catch {
        setBlocked({
          message: "문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
          action: "home",
        });
      }
    })();
  }, [no, router, fetchItem]);

  // 제출(수동·자동 공통). 판정은 서버가 한다 — 시간초과 여부도 서버 응답을 따른다
  const submit = useCallback(
    async (payload: unknown) => {
      if (!item || submittingRef.current) return false;
      submittingRef.current = true;
      setBusy(true);
      try {
        const res = await fetch(`/api/rounds/${no}/answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            payload === undefined
              ? { seq: item.seq }
              : { seq: item.seq, submitted: payload }
          ),
        });
        if (res.status === 409) {
          // 완료·만료 세션의 제출 — 결과 화면으로 (addendum K항)
          router.replace(`/round/${no}/result`);
          return true;
        }
        if (!res.ok) {
          submittingRef.current = false;
          return false;
        }
        const data = await res.json();
        // 문항이 이미 전환됐다면 이전 문항의 지연 응답 — 현재 화면을 덮지 않는다
        if (data.seq !== currentSeqRef.current) {
          submittingRef.current = false;
          return true;
        }
        setExplain(data);
        setIsLast(data.isLast === true);
        return true;
      } catch {
        // 네트워크 오류 등 예외에서도 제출 경로가 막히지 않아야 한다 (D6 전제)
        submittingRef.current = false;
        return false;
      } finally {
        setBusy(false);
      }
    },
    [item, no, router]
  );

  const ready = item
    ? item.itemType === "ORDER"
      ? orderSeq.length === (item.choices?.length ?? 0)
      : item.itemType === "SHORT"
        ? shortText.trim().length > 0
        : selected !== null
    : false;

  const onSubmitClick = () => {
    if (!item) return;
    if (!ready) {
      setTried(true);
      return;
    }
    const payload =
      item.itemType === "MC4"
        ? selected
        : item.itemType === "OX"
          ? selected === 0 // 0=O(true), 1=X(false)
          : item.itemType === "ORDER"
            ? orderSeq
            : shortText;
    void submit(payload);
  };

  // 타이머 0초 → 자동 제출(payload 없음 → 서버가 시간초과 판정, D5).
  // 서버 시계가 클라이언트보다 뒤면 400이 나므로 잠시 후 재시도한다.
  // 재시도는 만료 당시 문항에만 유효 — 문항이 전환되면 발사하지 않는다.
  const onExpire = useCallback(() => {
    const seqAtExpire = currentSeqRef.current;
    let attempt = 0;
    const fire = async () => {
      if (currentSeqRef.current !== seqAtExpire) return;
      attempt += 1;
      const ok = await submit(undefined);
      if (!ok && attempt < 4 && currentSeqRef.current === seqAtExpire) {
        retryTimersRef.current.push(setTimeout(fire, 1200));
      }
    };
    retryTimersRef.current.push(setTimeout(fire, 800));
  }, [submit]);

  const onNext = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/rounds/${no}/next`, { method: "POST" });
      if (res.status === 409) {
        // 만료·완료 세션 — 결과 화면으로 (K항)
        router.replace(`/round/${no}/result`);
        return;
      }
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

  // 응시 중 이탈 경고 (T03 리뷰 배정 → T07). 뒤로가기는 확정 문안으로 확인받고,
  // 새로고침·창 닫기는 브라우저 기본 경고를 띄운다(커스텀 문안은 브라우저가 미지원).
  // 마지막 문항 해설부터는 경고하지 않는다 — 세션은 12번째 제출로 이미 완료(D항).
  const guardOn = !!item && !blocked && !(explain && isLast);
  useEffect(() => {
    if (!guardOn) return;
    const before = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onPop = () => {
      if (
        window.confirm(
          "진행 중인 문제가 있습니다. 나가면 이어서 풀 수 없습니다."
        )
      ) {
        window.removeEventListener("beforeunload", before);
        window.removeEventListener("popstate", onPop);
        history.back();
      } else {
        history.pushState(null, "", location.href);
      }
    };
    history.pushState(null, "", location.href);
    window.addEventListener("beforeunload", before);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("beforeunload", before);
      window.removeEventListener("popstate", onPop);
    };
  }, [guardOn]);

  if (blocked) {
    return (
      <main className="mx-auto flex min-h-[calc(100dvh-10px)] w-full max-w-[640px] flex-col items-center justify-center gap-6 px-5 text-center">
        <p className="text-[16px] leading-[1.65] text-gb-text-body">
          {blocked.message}
        </p>
        <button
          type="button"
          className="gb-cta max-w-[320px]"
          onClick={() =>
            router.push(
              blocked.action === "result" ? `/round/${no}/result` : "/"
            )
          }
        >
          {blocked.action === "result" ? "결과 보기" : "홈으로"}
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
                {TYPE_LABEL[item.itemType]}
              </div>
              <h1 className="m-0 text-[22px] leading-[1.52] font-bold tracking-[-0.012em] text-white [text-wrap:pretty]">
                {item.stem}
              </h1>
            </div>

            {item.itemType === "MC4" && item.choices && (
              <Mc4Item
                choices={item.choices}
                selected={selected}
                onSelect={(i) => {
                  setSelected(i);
                  setTried(false);
                }}
              />
            )}
            {item.itemType === "OX" && (
              <OxItem
                selected={selected}
                onSelect={(i) => {
                  setSelected(i);
                  setTried(false);
                }}
              />
            )}
            {item.itemType === "ORDER" && item.choices && (
              <OrderItem
                choices={item.choices}
                orderSeq={orderSeq}
                onTap={(i) => {
                  setOrderSeq((prev) =>
                    prev.includes(i)
                      ? prev.filter((x) => x !== i)
                      : [...prev, i]
                  );
                  setTried(false);
                }}
                onReset={() => setOrderSeq([])}
              />
            )}
            {item.itemType === "SHORT" && (
              <ShortItem
                value={shortText}
                onChange={(v) => {
                  setShortText(v);
                  setTried(false);
                }}
              />
            )}
          </>
        ) : (
          <Explanation
            data={explain!}
            stem={item.stem}
            itemType={item.itemType}
            choices={item.choices}
          />
        )}
      </div>

      {/* 하단 고정 CTA */}
      <div className="flex flex-col gap-2 border-t-[3px] border-gb-border-divider bg-gb-bg-panel px-4 pt-2.5 pb-4">
        {phase === "answering" ? (
          <>
            <div
              className="flex min-h-[18px] items-center gap-1.5 text-[13px] font-bold text-gb-yellow"
              style={{ visibility: tried && !ready ? "visible" : "hidden" }}
            >
              <span className="font-gb-num font-bold">!</span>
              <span>답을 선택해 주세요</span>
            </div>
            <button
              type="button"
              onClick={onSubmitClick}
              disabled={busy}
              className={`w-full min-h-[56px] cursor-pointer rounded text-[19px] font-extrabold tracking-[0.02em] active:translate-x-1 active:translate-y-1 active:shadow-gb-pressed ${
                ready && !busy ? "shadow-gb-cta" : ""
              }`}
              style={
                ready && !busy
                  ? {
                      background: "#FFD400",
                      border: "3px solid #FFE873",
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
