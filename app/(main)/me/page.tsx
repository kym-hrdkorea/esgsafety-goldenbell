"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { requestBgm } from "@/lib/sound";

type Me = {
  nickname: string;
  orgUnitName: string;
  departmentName: string;
};

type RoundRow = {
  roundNo: number;
  theme: string;
  state: "locked" | "open" | "closed";
  myStatus: "none" | "in_progress" | "completed" | "expired";
  myScore: number | null;
};

type Stats = {
  categories: { category: string; total: number; correct: number; pct: number }[];
  prelearningViewed: number[];
};

// 영역 코드 → 라벨 (마스터 시트 범례 부재로 문항 내용 기반 확정 — T11 사용자 승인)
const CATEGORY_LABELS: [string, string][] = [
  ["F", "화재·대피"],
  ["G", "생활안전"],
  ["H", "직장 건강"],
  ["O", "사무실 안전"],
  ["E", "응급처치"],
  ["K", "위험성평가"],
  ["L", "안전 법령"],
  ["S", "공단 안전"],
];

// 내 기록: 회차별 점수 + 영역별 정답률 + 사전학습 열람 (design/mocks/내기록, copy.md)
export default function MyRecordPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [rounds, setRounds] = useState<RoundRow[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  // 탭 화면 대기 배경음악 (직접 진입 대비 — 이미 재생 중이면 그대로 이어진다)
  useEffect(() => {
    requestBgm("main");
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [meRes, rRes, sRes] = await Promise.all([
          fetch("/api/me"),
          fetch("/api/rounds"),
          fetch("/api/me/stats"),
        ]);
        if (meRes.status === 401 || rRes.status === 401 || sRes.status === 401) {
          router.replace("/login");
          return;
        }
        if (!meRes.ok || !rRes.ok || !sRes.ok) throw new Error();
        setMe(await meRes.json());
        setRounds(await rRes.json());
        setStats(await sRes.json());
      } catch {
        setBlocked("문제가 발생했습니다. 잠시 후 다시 시도해 주세요.");
      }
    })();
  }, [router]);

  if (blocked) {
    return (
      <main className="flex flex-1 items-center justify-center px-5 text-center">
        <p className="text-[16px] leading-[1.65] text-gb-text-body">{blocked}</p>
      </main>
    );
  }

  if (!me || !rounds || !stats) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-[14px] text-gb-text-secondary">불러오는 중...</p>
      </main>
    );
  }

  const areas = CATEGORY_LABELS.map(([code, label]) => {
    const c = stats.categories.find((s) => s.category === code);
    return c ? { label, pct: c.pct } : null;
  }).filter((a): a is { label: string; pct: number } => a !== null);

  const started = rounds.filter((r) => r.state !== "locked");

  return (
    <main className="flex flex-1 flex-col gap-5 px-4 pt-[18px] pb-2">
      <div className="flex flex-col gap-0.5">
        <h1 className="m-0 text-[24px] font-extrabold tracking-[-0.01em] text-white">
          내 기록
        </h1>
        <div className="text-[13px] text-gb-text-secondary">
          {me.nickname} · {me.orgUnitName} {me.departmentName}
        </div>
      </div>

      {/* 회차별 점수 — 정답 수 기준(N항: 포인트는 순위 전용) */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <div className="h-[14px] w-1 bg-gb-yellow" />
          <div className="text-[14px] font-extrabold text-gb-text-strong-sub">
            회차별 점수
          </div>
        </div>
        <div className="overflow-hidden rounded border-[3px] border-gb-border-divider">
          {rounds.map((r) => {
            const played = r.myScore !== null;
            const perfect = played && r.myScore === 12;
            const dim = !played && r.state !== "open";
            return (
              <div
                key={r.roundNo}
                className={`flex items-center gap-2.5 border-t-2 border-gb-border-row px-3 py-[11px] first:border-t-0 ${
                  // 잠금 행 감쇠는 opacity가 아니라 어두운 배경으로 — opacity는 텍스트 대비를
                  // 1.87:1까지 떨어뜨려 AA 미달이었다 (ux A-3)
                  perfect
                    ? "bg-gb-bg-gold-tint"
                    : dim
                      ? "bg-gb-bg-page"
                      : "bg-gb-bg-screen"
                }`}
              >
                <span className="font-gb-num w-[34px] text-[13px] font-bold text-gb-text-secondary">
                  {String(r.roundNo).padStart(2, "0")}
                </span>
                <span
                  className={`flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[14px] font-bold ${
                    dim ? "text-gb-text-secondary" : "text-gb-text-primary"
                  }`}
                >
                  {r.theme}
                </span>
                <div className="flex max-w-24 flex-1 gap-0.5">
                  {Array.from({ length: 12 }, (_, i) => (
                    <div
                      key={i}
                      className={`h-2.5 flex-1 rounded-[1px] ${
                        played && i < (r.myScore ?? 0)
                          ? perfect
                            ? "bg-gb-gold"
                            : "bg-gb-yellow"
                          : "bg-gb-bg-block"
                      }`}
                    />
                  ))}
                </div>
                <span
                  className={`font-gb-num w-[52px] text-right font-bold tabular-nums ${
                    played
                      ? perfect
                        ? "text-[15px] text-gb-gold"
                        : "text-[15px] text-gb-yellow"
                      : "text-[12px] text-gb-text-secondary"
                  }`}
                >
                  {played ? `${r.myScore}/12` : r.state === "open" ? "진행 중" : "-"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 영역별 정답률 — 확정 응답이 있는 영역만. 측정 문항은 집계에서 제외됨 */}
      {areas.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <div className="h-[14px] w-1 bg-gb-yellow" />
            <div className="text-[14px] font-extrabold text-gb-text-strong-sub">
              영역별 정답률
            </div>
          </div>
          <div className="flex flex-col gap-3 rounded border-[3px] border-gb-border-divider p-3.5">
            {areas.map((a) => (
              <div key={a.label} className="flex items-center gap-2.5">
                <span className="w-[92px] text-[14px] font-bold text-gb-text-strong-sub">
                  {a.label}
                </span>
                <div className="relative h-3 flex-1 overflow-hidden rounded-[2px] bg-gb-bg-block">
                  <div
                    className={`absolute inset-y-0 left-0 ${
                      a.pct === 100
                        ? "bg-gb-gold"
                        : a.pct >= 70
                          ? "bg-gb-yellow"
                          : "bg-gb-text-secondary"
                    }`}
                    style={{ width: `${a.pct}%` }}
                  />
                </div>
                <span className="font-gb-num w-[46px] text-right text-[15px] font-bold text-gb-yellow tabular-nums">
                  {a.pct}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 사전학습 열람 — 시작된 회차만 */}
      {started.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <div className="h-[14px] w-1 bg-gb-text-dim" />
            <div className="text-[14px] font-extrabold text-gb-text-strong-sub">
              사전학습 열람
            </div>
          </div>
          <div className="overflow-hidden rounded border-[3px] border-gb-border-divider">
            {started.map((r) => {
              const seen = stats.prelearningViewed.includes(r.roundNo);
              return (
                <div
                  key={r.roundNo}
                  className="flex items-center gap-2.5 border-t-2 border-gb-border-row bg-gb-bg-screen px-3 py-[11px] first:border-t-0"
                >
                  <span className="font-gb-num w-[34px] text-[13px] font-bold text-gb-text-secondary">
                    {String(r.roundNo).padStart(2, "0")}
                  </span>
                  <span className="flex-1 text-[14px] font-bold text-gb-text-strong-sub">
                    {r.theme}
                  </span>
                  <span
                    className={`rounded-[2px] border-2 px-2 py-[3px] text-[12px] font-extrabold ${
                      seen
                        ? "border-gb-green bg-gb-green-bg text-gb-green-text"
                        : "border-gb-text-dim bg-[#1b2136] text-gb-text-strong-sub"
                    }`}
                  >
                    {seen ? "열람" : "미열람"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
