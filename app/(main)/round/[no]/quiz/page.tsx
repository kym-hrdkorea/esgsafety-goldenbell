"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Timer from "@/components/quiz/Timer";
import Mc4Item from "@/components/quiz/Mc4Item";
import OxItem from "@/components/quiz/OxItem";
import OrderItem from "@/components/quiz/OrderItem";
import ShortItem from "@/components/quiz/ShortItem";
import Explanation, { type ExplainData } from "@/components/quiz/Explanation";
import SoundToggle from "@/components/SoundToggle";
import { requestBgm, sfxCorrect, sfxTimeout, sfxWrong } from "@/lib/sound";

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

// design/copy.md 공통 — 일반 오류 (규칙 9)
const MSG_ERROR = "문제가 발생했습니다. 잠시 후 다시 시도해 주세요.";

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
  // 통신 실패 안내 — copy.md 일반 오류 문안만 사용, 제출·다음 실패가 무음이 되지 않게 (ux A-1)
  const [errNotice, setErrNotice] = useState<string | null>(null);
  // 화면 타이머 0초 도달 — 자동 제출 진행 중엔 제출 버튼을 잠근다 (ux A-2)
  const [expired, setExpired] = useState(false);
  // 자동 제출이 실패한 뒤에만 수동 재시도 탭을 허용 (errNotice와 분리 — 선택 변경 교착 방지)
  const [manualRetryOn, setManualRetryOn] = useState(false);
  // 해설 진입 직후 [다음 문제] 잠금 해제 여부 — 제출 연타의 해설 스킵 방지 (ux B-1)
  const [nextArmed, setNextArmed] = useState(false);
  const submittingRef = useRef(false);
  const currentSeqRef = useRef(-1); // 지연된 응답·재시도가 다른 문항 화면을 덮지 않게 하는 가드
  const retryTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const explainRef = useRef<ExplainData | null>(null); // 이벤트 핸들러가 stale closure 없이 읽는 미러
  const expiredSeqRef = useRef(-1); // onExpire seq당 1회 래치 — Timer 리마운트發 재발화 차단
  const syncInFlightRef = useRef(false); // 재동기화 단일 비행
  const itemAnchorRef = useRef(Date.now()); // 마지막 setItem 시각 — 로컬 표시값 추정용
  const lastRemainRef = useRef(0);

  const clearRetries = () => {
    retryTimersRef.current.forEach((t) => clearTimeout(t));
    retryTimersRef.current = [];
  };

  const applyExplain = (data: ExplainData | null) => {
    explainRef.current = data;
    setExplain(data);
  };

  const resetInputs = () => {
    setSelected(null);
    setOrderSeq([]);
    setShortText("");
    setTried(false);
    setExpired(false);
    setManualRetryOn(false);
    setErrNotice(null);
  };

  const fetchItem = useCallback(async () => {
    const res = await fetch(`/api/rounds/${no}/item`, { cache: "no-store" });
    if (res.status === 401) {
      // 세션 쿠키 소실 — 오류 안내로 돌면 무한 재시도 루프가 되므로 로그인으로 (ux A-1)
      router.replace("/login");
      return;
    }
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
    itemAnchorRef.current = Date.now();
    lastRemainRef.current = data.remainingSec;
    resetInputs();
    submittingRef.current = false;
    if (data.phase === "explained") {
      applyExplain(data as unknown as ExplainData);
      setIsLast(data.isLast === true);
    } else {
      applyExplain(null);
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
        setBlocked({ message: MSG_ERROR, action: "home" });
      }
    })();
  }, [no, router, fetchItem]);

  // 화면 잠금·앱 전환 복귀 시 타이머 표시를 서버 기준으로 재동기화 (ux A-2).
  // 서버는 served_at을 재갱신하지 않으므로(규칙 3, item route에서 확인) 재조회는 판정에 영향이 없다.
  // 답변 단계에서만 동작하고, 실패는 무시한다(로컬 앵커 타이머가 계속 동작하는 기회주의적 동기화).
  const syncTimer = useCallback(async () => {
    if (explainRef.current || submittingRef.current || syncInFlightRef.current)
      return;
    syncInFlightRef.current = true;
    try {
      const res = await fetch(`/api/rounds/${no}/item`, { cache: "no-store" });
      if (!res.ok) {
        // 세션 상태가 변했으면(만료·완료·인증 소실) 전체 경로가 화면 전환을 처리한다
        if ([401, 409, 410].includes(res.status)) await fetchItem();
        return;
      }
      const data: ItemPayload = await res.json();
      if (data.seq !== currentSeqRef.current || data.phase !== "answering") {
        // 문항·단계가 어긋남 — 전체 경로로 위임 (단, 그 사이 해설·제출이 시작됐으면 덮지 않는다)
        if (!explainRef.current && !submittingRef.current) await fetchItem();
        return;
      }
      if (explainRef.current || submittingRef.current) return; // 지연 응답 가드 (라이브 ref)
      const localSecs = Math.max(
        0,
        lastRemainRef.current -
          Math.floor((Date.now() - itemAnchorRef.current) / 1000)
      );
      if (Math.abs(localSecs - data.remainingSec) <= 1) return; // 이미 정확 — 리마운트 생략
      setItem(data);
      itemAnchorRef.current = Date.now();
      lastRemainRef.current = data.remainingSec;
    } catch {
      // 무시 — 다음 복귀·틱에서 재시도
    } finally {
      syncInFlightRef.current = false;
    }
  }, [no, fetchItem]);

  useEffect(() => {
    const onWake = () => {
      if (document.hidden) return;
      void syncTimer();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("pageshow", onWake);
    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("pageshow", onWake);
    };
  }, [syncTimer]);

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
        if (res.status === 401) {
          router.replace("/login");
          return true;
        }
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
        // 해설 확정 — 잔여 자동 재시도와 오류 안내는 이 순간 무효다.
        // 지우지 않으면 뒤늦게 실패한 재시도가 정상 해설 위에 가짜 오류를 띄운다 (ux A-1)
        clearRetries();
        setErrNotice(null);
        applyExplain(data);
        setIsLast(data.isLast === true);
        // 판정 효과음 — 서버 판정 결과에만 연동
        if (data.isTimeout) sfxTimeout();
        else if (data.isCorrect) sfxCorrect();
        else sfxWrong();
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

  const onSubmitClick = async () => {
    if (!item || busy) return;
    if (!ready && !expired) {
      setTried(true);
      return;
    }
    // 만료 후 수동 재시도는 미선택이어도 보낸다(payload 없음) — 서버가 시간초과를 판정한다 (규칙 3)
    const payload = !ready
      ? undefined
      : item.itemType === "MC4"
        ? selected
        : item.itemType === "OX"
          ? selected === 0 // 0=O(true), 1=X(false)
          : item.itemType === "ORDER"
            ? orderSeq
            : shortText;
    const ok = await submit(payload);
    if (!ok) setErrNotice(MSG_ERROR); // 실패를 무음으로 두지 않는다 (ux A-1)
  };

  // 타이머 0초 → 자동 제출(payload 없음 → 서버가 시간초과 판정, D5).
  // 서버 시계가 클라이언트보다 뒤면 400이 나므로 잠시 후 재시도한다.
  // 재시도는 만료 당시 문항에만 유효 — 문항이 전환되면 발사하지 않는다.
  // seq당 1회 래치: 재동기화로 Timer가 리마운트돼도 자동 제출 체인이 중복 기동하지 않는다 (ux A-2)
  const onExpire = useCallback(() => {
    const seqAtExpire = currentSeqRef.current;
    if (expiredSeqRef.current === seqAtExpire) return;
    expiredSeqRef.current = seqAtExpire;
    setExpired(true); // 자동 제출 대기 중 제출 버튼 잠금 (ux A-2)
    let attempt = 0;
    const fire = async () => {
      if (currentSeqRef.current !== seqAtExpire) return;
      attempt += 1;
      const ok = await submit(undefined);
      if (!ok && currentSeqRef.current === seqAtExpire) {
        // 실패를 알리고 수동 재시도를 연다 — 자동 재시도도 계속한다 (ux A-1)
        setErrNotice(MSG_ERROR);
        setManualRetryOn(true);
        if (attempt < 4) {
          retryTimersRef.current.push(setTimeout(fire, 1200));
        }
      }
    };
    retryTimersRef.current.push(setTimeout(fire, 800));
  }, [submit]);

  const onNext = async () => {
    if (busy) return;
    setBusy(true);
    try {
      let failed = false;
      const res = await fetch(`/api/rounds/${no}/next`, { method: "POST" });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      if (res.status === 409) {
        // 만료·완료 세션 — 결과 화면으로 (K항)
        router.replace(`/round/${no}/result`);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (data.isCompleted) {
          router.push(`/round/${no}/result`);
          return;
        }
      } else if (res.status !== 400) {
        failed = true; // 500 등 — 아래 재조회로 화면은 동기화하되 실패를 알린다
      }
      // 전진 성공(ok)이든 400(직전 탭에서 이미 전진된 상태)이든 현재 문항 재조회로 수렴한다.
      // /next 응답이 유실돼 화면이 이전 해설에 갇혀도 재탭만으로 복구된다 (ux A-1)
      await fetchItem();
      if (failed) setErrNotice(MSG_ERROR);
    } catch {
      setErrNotice(MSG_ERROR);
    } finally {
      setBusy(false);
    }
  };

  // 해설 진입 직후 700ms 동안 [다음 문제]를 잠근다 — 45초 압박이 만든 '하단 연타'가
  // 방금 생긴 버튼에 떨어져 해설을 스킵하는 것 방지. 파일럿 체감 확인 항목 (ux B-1)
  useEffect(() => {
    if (!explain) {
      setNextArmed(false);
      return;
    }
    const t = setTimeout(() => setNextArmed(true), 700);
    return () => clearTimeout(t);
  }, [explain]);

  // 응시 중에는 진행 배경음악을 요청한다. 소리가 켜져 있어야만 실제 재생되고,
  // 화면을 떠나면 대기 음악으로 되돌린다.
  useEffect(() => {
    requestBgm("game");
    return () => requestBgm("main");
  }, []);

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
  // 안내 행: 통신 오류가 미선택 안내보다 우선 (ux A-1)
  const notice = errNotice ?? (tried && !ready ? "답을 선택해 주세요" : null);
  // 만료 직후엔 자동 제출이 돌므로 잠그고, 자동 제출이 실패하면 수동 재시도를 연다 (ux A-2)
  const submitLocked = busy || (expired && !manualRetryOn);
  const submitYellow = ready || expired;

  return (
    // 높이를 뷰포트에 고정한다(min-h 아님). min-h면 본문이 늘어나 문서 전체가 스크롤되고
    // 답변 단계에서 타이머가, 해설 단계에서 [다음 문제]가 화면 밖으로 밀린다.
    // 고정 높이라야 아래 overflow-y-auto가 실제로 작동해 헤더·CTA가 항상 보인다.
    <main className="mx-auto flex h-[calc(100dvh-10px)] w-full max-w-[640px] flex-col overflow-hidden">
      {/* 헤더: 회차 라벨 · 진행 n/12 · 12칸 진행 블록 · (답변 단계) 타이머 */}
      <div className="flex flex-none flex-col gap-2.5 border-b-[3px] border-gb-border-divider bg-gb-bg-panel px-4 pt-3 pb-2.5">
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <div className="h-[15px] w-1 flex-none bg-gb-yellow" />
            <div className="truncate text-[13px] font-bold text-gb-text-strong-sub">
              {session.roundNo}회차 · {session.theme}
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <SoundToggle />
            <div className="font-gb-num flex items-baseline gap-[2px] font-bold tabular-nums">
              <span className="text-[22px] leading-none text-gb-yellow">
                {String(qno).padStart(2, "0")}
              </span>
              <span className="text-[15px] leading-none text-gb-text-secondary">
                / {session.totalItems}
              </span>
            </div>
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

      {/* 본문 — 넘칠 때 여기'만' 스크롤된다 (min-h-0가 없으면 flex 자식이 줄지 않는다) */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-3 pb-1.5">
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
      <div className="flex flex-none flex-col gap-1.5 border-t-[3px] border-gb-border-divider bg-gb-bg-panel px-4 pt-2 pb-3">
        {phase === "answering" ? (
          <>
            <div
              className="flex min-h-[18px] items-center gap-1.5 text-[13px] font-bold text-gb-yellow"
              style={{ visibility: notice ? "visible" : "hidden" }}
            >
              <span className="font-gb-num font-bold">!</span>
              <span>{notice}</span>
            </div>
            <button
              type="button"
              onClick={onSubmitClick}
              disabled={submitLocked}
              className={`w-full min-h-[56px] cursor-pointer rounded text-[19px] font-extrabold tracking-[0.02em] active:translate-x-1 active:translate-y-1 active:shadow-gb-pressed ${
                submitYellow && !submitLocked ? "shadow-gb-cta" : ""
              }`}
              style={
                submitYellow
                  ? {
                      // 전송 중·잠금은 '미선택 회색'과 구분되게 노랑을 유지하고 흐림만 준다 (ux A-1)
                      background: "#FFD400",
                      border: "3px solid #FFE873",
                      color: "#12172b",
                      ...(submitLocked ? { opacity: 0.55 } : {}),
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
          <>
            {errNotice && (
              // 해설 단계는 상시 예약 시 한 화면 높이 예산(9a0d589)을 넘겨 오류 시에만 렌더
              <div className="flex min-h-[18px] items-center gap-1.5 text-[13px] font-bold text-gb-yellow">
                <span className="font-gb-num font-bold">!</span>
                <span>{errNotice}</span>
              </div>
            )}
            <button
              type="button"
              onClick={onNext}
              disabled={busy || !nextArmed}
              className="gb-cta text-[19px]"
            >
              {isLast ? "결과 보기" : "다음 문제"}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
