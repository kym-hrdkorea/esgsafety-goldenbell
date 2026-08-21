"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import BellIcon from "@/components/BellIcon";
import { sfxBell } from "@/lib/sound";

type ResultItem = {
  seq: number;
  itemCode: string;
  isCorrect: boolean;
  isTimeout: boolean;
  stem: string;
  correctAnswerLabel: string | null;
  explanation: string | null;
};

type ResultPayload = {
  score: number;
  totalItems: number;
  pct: number;
  points: number;
  roundRank: number | null;
  items: ResultItem[];
};

type CellKind = "ok" | "wrong" | "timeout";

const CELL_STYLE: Record<CellKind, React.CSSProperties> = {
  ok: { background: "#12261a", border: "2px solid #1d5c33", color: "#7CE09A" },
  wrong: { background: "#2a171a", border: "2px solid #E23A2E", color: "#F0A099" },
  timeout: { background: "#1b2136", border: "2px solid #5E6A8C", color: "#C6CEE4" },
};
const CELL_ICON: Record<CellKind, { glyph: string; color: string }> = {
  ok: { glyph: "✓", color: "#7CE09A" },
  wrong: { glyph: "✕", color: "#F0A099" },
  timeout: { glyph: "◷", color: "#8B93AB" },
};

// 회차 결과. 만점은 골든벨 연출(벨 + 3중 링), 일반은 담담한 톤 (design/mocks/회차결과)
export default function ResultPage({
  params,
}: {
  params: Promise<{ no: string }>;
}) {
  const { no } = use(params);
  const router = useRouter();

  const [data, setData] = useState<ResultPayload | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [shown, setShown] = useState(0); // 점수 롤업 카운터
  const [wrongOnly, setWrongOnly] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/rounds/${no}/result`);
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (res.status === 404) {
          router.replace("/");
          return;
        }
        if (res.status === 409) {
          // 아직 진행 중인 세션 — 응시 화면으로 (business-rules 3.5)
          router.replace(`/round/${no}/quiz`);
          return;
        }
        if (!res.ok) {
          const body = await res.json();
          setBlocked(body.message);
          return;
        }
        setData(await res.json());
      } catch {
        setBlocked("문제가 발생했습니다. 잠시 후 다시 시도해 주세요.");
      }
    })();
  }, [no, router]);

  // 만점 골든벨 효과음 — 응시 화면에서 넘어온 직후라 오디오는 이미 잠금 해제 상태
  useEffect(() => {
    if (data && data.score === data.totalItems) sfxBell();
  }, [data]);

  // 점수 롤업: 0 → score, 90ms 간격 (목업 확정 연출)
  useEffect(() => {
    if (!data) return;
    setShown(0);
    const t = setInterval(() => {
      setShown((s) => {
        if (s >= data.score) {
          clearInterval(t);
          return s;
        }
        return s + 1;
      });
    }, 90);
    return () => clearInterval(t);
  }, [data]);

  if (blocked) {
    return (
      <main className="mx-auto flex min-h-[calc(100dvh-10px)] w-full max-w-[640px] flex-col items-center justify-center gap-6 px-5 text-center">
        <p className="text-[16px] leading-[1.65] text-gb-text-body">{blocked}</p>
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

  if (!data) {
    return (
      <main className="flex min-h-[calc(100dvh-10px)] items-center justify-center">
        <p className="text-[14px] text-gb-text-secondary">불러오는 중...</p>
      </main>
    );
  }

  const perfect = data.totalItems > 0 && data.score === data.totalItems;
  const wrongExists = data.items.some((it) => !it.isCorrect);
  const cells = data.items
    .map((it) => ({
      seq: it.seq,
      kind: (it.isTimeout ? "timeout" : it.isCorrect ? "ok" : "wrong") as CellKind,
    }))
    .filter((c) => !wrongOnly || c.kind !== "ok");

  const badgeBase =
    "rounded-[2px] px-2 py-[3px] text-[13px] font-bold tabular-nums";
  const badgeGhost: React.CSSProperties = perfect
    ? { border: "2px solid #C9A227", color: "#C9A227" }
    : { border: "2px solid #3a4468", color: "#C6CEE4" };

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-10px)] w-full max-w-[640px] flex-col">
      <div className="flex flex-1 flex-col gap-[18px] px-4 pt-[18px] pb-2">
        <h1 className="m-0 text-[24px] font-extrabold tracking-[-0.01em] text-white">
          {no}회차 결과
        </h1>

        {/* 점수 패널 — 만점: 골든벨 / 일반: 담담한 톤 */}
        <div
          className="flex flex-col items-center gap-3 rounded border-[3px] px-4 pt-[22px] pb-5 shadow-gb-card"
          style={{
            ...(perfect
              ? { background: "#1d1a2c", borderColor: "#C9A227" }
              : { background: "#161d33", borderColor: "#3a4468" }),
            animation: "gb-rise-in 0.25s ease-out",
          }}
        >
          {perfect && (
            <div className="relative h-[74px] w-[74px]">
              {/* 인장형 방사 광선 8개 — 링이 사라진 뒤에도 남는 "만점 도장" (image-assets 2-4).
                  연출은 성취 쪽에만 쏟는다는 톤 가드레일의 적용처다. */}
              <svg
                className="absolute -inset-[21px]"
                width="116"
                height="116"
                viewBox="0 0 116 116"
                fill="none"
                aria-hidden="true"
                style={{ animation: "gb-rays-in 0.5s ease-out 0.9s both" }}
              >
                <g stroke="#FFD400" strokeWidth="5" strokeLinecap="round">
                  <line x1="58" y1="4" x2="58" y2="14" />
                  <line x1="58" y1="102" x2="58" y2="112" />
                  <line x1="4" y1="58" x2="14" y2="58" />
                  <line x1="102" y1="58" x2="112" y2="58" />
                  <line x1="19.8" y1="19.8" x2="26.9" y2="26.9" />
                  <line x1="89.1" y1="89.1" x2="96.2" y2="96.2" />
                  <line x1="96.2" y1="19.8" x2="89.1" y2="26.9" />
                  <line x1="26.9" y1="89.1" x2="19.8" y2="96.2" />
                </g>
              </svg>
              <span
                className="absolute inset-0 rounded-full border-2 border-gb-gold"
                style={{ animation: "gb-ring-out 1s ease-out 0.2s both" }}
              />
              <span
                className="absolute inset-0 rounded-full border-2 border-gb-yellow"
                style={{ animation: "gb-ring-out 1.35s ease-out 0.4s both" }}
              />
              <span
                className="absolute inset-0 rounded-full border-2 border-gb-yellow-light"
                style={{ animation: "gb-ring-out 1.7s ease-out 0.6s both" }}
              />
              <div className="absolute inset-0 flex items-center justify-center rounded-full border-[3px] border-gb-yellow-light bg-gb-gold">
                <span
                  style={{
                    animation: "gb-bell-swing 1.4s ease-in-out 0.2s both",
                    transformOrigin: "50% 10%",
                    display: "inline-flex",
                  }}
                >
                  <BellIcon size={40} />
                </span>
              </div>
            </div>
          )}

          <div className="font-gb-num flex items-baseline gap-1.5 font-bold tabular-nums">
            <span className="text-[56px] leading-none text-gb-yellow">
              {shown}
            </span>
            <span className="text-[24px] text-gb-text-secondary">
              / {data.totalItems}
            </span>
          </div>

          <div className="flex flex-wrap justify-center gap-2">
            <span
              className={badgeBase}
              style={
                perfect
                  ? { background: "#C9A227", color: "#12172b" }
                  : badgeGhost
              }
            >
              정답률 {data.pct}%
            </span>
            <span className={badgeBase} style={badgeGhost}>
              획득 포인트 {data.points}P
            </span>
            {data.roundRank !== null && (
              <span className={badgeBase} style={badgeGhost}>
                이번 회차 {data.roundRank}위
              </span>
            )}
          </div>

          {perfect ? (
            <div className="text-[15px] font-bold text-gb-yellow-light">
              만점입니다. 다음 회차도 기대할게요.
            </div>
          ) : (
            <div className="text-[14px] text-gb-text-secondary">
              틀린 문제의 해설을 한 번 더 읽어보세요.
            </div>
          )}
        </div>

        {/* 문항별 결과 */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <div className="h-[14px] w-1 bg-gb-yellow" />
            <div className="text-[14px] font-extrabold text-gb-text-strong-sub">
              문항별 결과
            </div>
            <div className="flex-1" />
            {wrongExists && (
              <button
                type="button"
                onClick={() => setWrongOnly((v) => !v)}
                className="min-h-9 cursor-pointer rounded-[3px] px-3 text-[13px] font-bold active:translate-x-px active:translate-y-px"
                style={
                  wrongOnly
                    ? {
                        border: "2px solid #FFD400",
                        background: "#FFD400",
                        color: "#12172b",
                      }
                    : {
                        border: "2px solid #3a4468",
                        background: "transparent",
                        color: "#C6CEE4",
                      }
                }
              >
                틀린 문제만 보기
              </button>
            )}
          </div>

          <div className="grid grid-cols-4 gap-2">
            {cells.map((c) => (
              <div
                key={c.seq}
                className="flex min-h-12 items-center justify-center gap-1.5 rounded-[3px]"
                style={CELL_STYLE[c.kind]}
              >
                <span className="font-gb-num text-[15px] font-bold tabular-nums">
                  {String(c.seq + 1).padStart(2, "0")}
                </span>
                <span
                  className="text-[16px] font-black"
                  style={{ color: CELL_ICON[c.kind].color }}
                >
                  {CELL_ICON[c.kind].glyph}
                </span>
              </div>
            ))}
          </div>

          <div className="flex gap-3 text-[12px] font-bold text-gb-text-secondary">
            <span className="flex items-center gap-1">
              <span className="font-black text-gb-green-text">✓</span>정답
            </span>
            <span className="flex items-center gap-1">
              <span className="font-black text-gb-red-text">✕</span>오답
            </span>
            <span className="flex items-center gap-1">
              <span className="font-black">◷</span>시간초과
            </span>
          </div>
        </div>
      </div>

      {/* 하단 버튼 (목업: 고정 아님, 본문 하단 흐름) */}
      <div className="flex flex-col gap-2 px-4 pt-2.5 pb-4">
        <Link
          href="/dashboard"
          className="gb-cta flex items-center justify-center text-[18px] no-underline"
        >
          순위 보러 가기
        </Link>
        <Link
          href="/"
          className="flex min-h-12 items-center justify-center rounded border-2 border-gb-border-card text-[15px] font-bold text-gb-text-strong-sub no-underline active:translate-x-px active:translate-y-px"
        >
          홈으로
        </Link>
      </div>
    </main>
  );
}
