"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type MyResult = "correct" | "wrong" | "timeout";

type ReviewItem = {
  no: number;
  itemType: "OX" | "MC4" | "ORDER" | "SHORT";
  stem: string;
  correctAnswerLabel: string;
  explanation: string;
  legalRef: string | null;
  my: { result: MyResult; myAnswerLabel: string | null } | null;
};

type Review = {
  roundNo: number;
  theme: string;
  participated: boolean;
  items: ReviewItem[];
};

const TYPE_LABEL = {
  MC4: "4지선다",
  OX: "O / X",
  ORDER: "순서배열",
  SHORT: "단답",
} as const;

const RESULT_CHIP: Record<
  MyResult,
  { label: string; icon: string; style: React.CSSProperties }
> = {
  correct: {
    label: "정답",
    icon: "✓",
    style: { background: "#12261a", border: "2px solid #24B24C", color: "#7CE09A" },
  },
  wrong: {
    label: "오답",
    icon: "✕",
    style: { background: "#2a171a", border: "2px solid #E23A2E", color: "#F0A099" },
  },
  timeout: {
    label: "시간초과",
    icon: "◷",
    style: { background: "#1b2136", border: "2px solid #5E6A8C", color: "#C6CEE4" },
  },
};

// 종료 회차 복습 (design/mocks/복습). 참여자는 문항별 내 결과 병기, 미참여자는 안내 배너.
export default function ReviewPage({
  params,
}: {
  params: Promise<{ no: string }>;
}) {
  const { no } = use(params);
  const router = useRouter();
  const [data, setData] = useState<Review | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/rounds/${no}/review`);
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (res.status === 404) {
          router.replace("/");
          return;
        }
        if (res.status === 409) {
          // 아직 응시 중인 세션 — 복습 대신 응시 화면으로 (규칙 2 유출 차단)
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

  if (blocked) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-5 text-center">
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
      <main className="flex flex-1 items-center justify-center">
        <p className="text-[14px] text-gb-text-secondary">불러오는 중...</p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col">
      {/* 헤더 패널 */}
      <div className="flex flex-col gap-2 border-b-[3px] border-gb-border-divider bg-gb-bg-panel px-4 pt-4 pb-3.5">
        <div className="flex items-center gap-2.5">
          <div className="h-4 w-1 bg-gb-yellow" />
          <h1 className="m-0 text-[21px] font-extrabold tracking-[-0.01em] text-white">
            {data.roundNo}회차 복습
          </h1>
          <span className="rounded-[2px] border-2 border-gb-border-card px-2 py-[2px] text-[12px] font-extrabold text-gb-text-secondary">
            점수 미반영
          </span>
        </div>
        <div className="text-[14px] leading-[1.6] text-gb-text-secondary">
          종료된 회차입니다. 문제와 해설을 다시 볼 수 있습니다.
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3.5 px-4 pt-4 pb-2">
        {/* 미참여 배너 */}
        {!data.participated && (
          <div
            className="flex items-start gap-2.5 rounded border-[3px] px-3.5 py-3"
            style={{ background: "#1b2136", borderColor: "#5E6A8C" }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              className="mt-[2px] flex-none"
            >
              <circle cx="12" cy="12" r="8.5" stroke="#C6CEE4" strokeWidth="2.2" />
              <path
                d="M12 8v4.5M12 15.5v0.5"
                stroke="#C6CEE4"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
            <div className="text-[14px] leading-[1.6] font-semibold text-gb-text-strong-sub">
              이 회차에는 참여하지 않으셨습니다. 문제와 해설은 열람할 수 있습니다.
            </div>
          </div>
        )}

        {/* 문항 카드 */}
        {data.items.map((it) => (
          <div
            key={it.no}
            className="flex flex-col gap-2.5 rounded border-[3px] border-gb-border-divider bg-gb-bg-panel p-3.5"
          >
            <div className="flex items-center gap-2">
              <span className="font-gb-num text-[15px] font-bold text-gb-yellow tabular-nums">
                {it.no}번
              </span>
              <span className="rounded-[2px] bg-gb-gold px-[7px] py-[2px] text-[12px] font-extrabold text-gb-bg-screen">
                {TYPE_LABEL[it.itemType]}
              </span>
              <div className="flex-1" />
              {it.my && (
                <span
                  className="flex items-center gap-1 rounded-[2px] px-2 py-[3px] text-[12px] font-extrabold"
                  style={RESULT_CHIP[it.my.result].style}
                >
                  {RESULT_CHIP[it.my.result].icon}{" "}
                  {RESULT_CHIP[it.my.result].label}
                </span>
              )}
            </div>

            <div className="text-[17px] leading-[1.55] font-bold text-white [text-wrap:pretty]">
              {it.stem}
            </div>

            <div className="flex items-baseline gap-2 rounded-r-[3px] border-l-4 border-gb-gold bg-gb-bg-screen px-3 py-2">
              <span className="text-[12px] font-extrabold whitespace-nowrap text-gb-gold">
                정답
              </span>
              <span className="text-[15px] font-bold text-white">
                {it.correctAnswerLabel}
              </span>
            </div>

            {it.my?.myAnswerLabel && (
              <div className="text-[13px] font-bold text-gb-red-text">
                내 답: {it.my.myAnswerLabel}
              </div>
            )}

            <div className="flex flex-col gap-[5px]">
              <div className="flex items-center gap-[7px]">
                <div className="h-3 w-[3px] bg-gb-yellow" />
                <div className="text-[12px] font-extrabold tracking-[0.08em] text-gb-text-strong-sub">
                  해설
                </div>
              </div>
              <p className="m-0 text-[15px] leading-[1.65] text-gb-text-body [text-wrap:pretty]">
                {it.explanation}
              </p>
            </div>

            {it.legalRef && (
              <div className="flex items-baseline gap-[7px]">
                <div className="text-[12px] font-extrabold tracking-[0.08em] text-gb-text-secondary">
                  근거
                </div>
                <div className="text-[13px] text-gb-text-secondary tabular-nums">
                  {it.legalRef}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 하단 버튼 */}
      <div className="flex flex-col gap-2 px-4 pt-2.5 pb-4">
        <Link
          href={`/round/${data.roundNo}/learn`}
          className="flex min-h-[52px] items-center justify-center rounded border-[3px] border-gb-yellow-light bg-gb-yellow text-[16px] font-extrabold text-gb-bg-screen no-underline shadow-gb-cta active:translate-x-[3px] active:translate-y-[3px] active:shadow-gb-pressed"
        >
          사전학습 자료 다시 보기
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
