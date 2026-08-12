"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import RankTable, { type RankRow } from "@/components/dashboard/RankTable";
import { requestBgm } from "@/lib/sound";

type Dashboard = {
  me: {
    nickname: string;
    departmentId: number;
    totalScore: number;
    totalPoints: number;
    roundsTaken: number;
    totalRank: number | null;
    departmentRank: number | null;
    rankEligible: boolean;
    minRoundsRequired: number;
    rankedParticipants: number;
    rankedDepartments: number;
  };
  total: { rank: number; nickname: string; orgUnitName: string; totalPoints: number; roundsTaken: number }[];
  average: { rank: number; nickname: string; orgUnitName: string; avgPoints: number; roundsTaken: number }[];
  // departmentId는 구 스냅샷(갱신 전)에 없을 수 있다 — 배지 판정에서 optional로 다룬다
  department: { rank: number; departmentId?: number; departmentName: string; orgUnitName: string; participants: number; avgPoints: number }[];
  computedAt: string | null;
  visibleRows: number;
};

type RoundRow = {
  roundNo: number;
  state: "locked" | "open" | "closed";
};

type RoundRankRow = {
  rank: number;
  nickname: string;
  orgUnitName: string;
  points: number;
  score: number;
  pct: number;
};

type TabKey = "total" | "round" | "average" | "department";

const TABS: { key: TabKey; label: string }[] = [
  { key: "total", label: "전체 누적" },
  { key: "round", label: "회차별" },
  { key: "average", label: "평균 포인트" },
  { key: "department", label: "부서" },
];

const HEADERS: Record<TabKey, [string, string, string, string]> = {
  total: ["순위", "닉네임", "소속", "포인트"],
  round: ["순위", "닉네임", "소속", "포인트"],
  average: ["순위", "닉네임", "소속", "평균 포인트"],
  department: ["순위", "부서", "소속", "평균 포인트"],
};

// "07.30 14:00 기준" — 표시 전용 Asia/Seoul 변환 (판정은 항상 서버)
function formatComputedAt(iso: string): string {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")}.${get("day")} ${get("hour")}:${get("minute")} 기준`;
}

// 대시보드: 내 현황 카드 2장 + 순위 4종 탭 (business-rules 5.2, design/mocks/대시보드)
export default function DashboardPage() {
  const router = useRouter();
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [rounds, setRounds] = useState<RoundRow[] | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("total");
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  const [roundCache, setRoundCache] = useState<Record<number, RoundRankRow[]>>({});

  // 탭 화면 대기 배경음악 (직접 진입 대비 — 이미 재생 중이면 그대로 이어진다)
  useEffect(() => {
    requestBgm("main");
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [dRes, rRes] = await Promise.all([
          fetch("/api/dashboard"),
          fetch("/api/rounds"),
        ]);
        if (dRes.status === 401 || rRes.status === 401) {
          router.replace("/login");
          return;
        }
        if (!dRes.ok || !rRes.ok) throw new Error();
        const roundRows: RoundRow[] = await rRes.json();
        setDash(await dRes.json());
        setRounds(roundRows);
        // 회차별 탭 기본값: 실제 종료된 회차 중 최신을 우선한다.
        // 새 회차가 열린 직후에는 최신 회차 스냅샷이 비어 있을 수 있어
        // 월요일마다 빈 표를 기본 화면으로 보여주지 않는다.
        const started = roundRows.filter((r) => r.state !== "locked");
        const ended = started.filter((r) => r.state === "closed");
        const candidates = ended.length > 0 ? ended : started;
        if (candidates.length > 0) {
          setSelectedRound(Math.max(...candidates.map((r) => r.roundNo)));
        }
      } catch {
        setBlocked("문제가 발생했습니다. 잠시 후 다시 시도해 주세요.");
      }
    })();
  }, [router]);

  // 회차별 순위는 선택 시 lazy 조회. 응답은 항상 회차 키에 저장하므로
  // 빠른 전환의 늦은 응답이 현재 화면을 덮어쓰지 않는다.
  useEffect(() => {
    if (tab !== "round" || selectedRound === null) return;
    if (selectedRound in roundCache) return;
    const no = selectedRound;
    (async () => {
      try {
        const res = await fetch(`/api/dashboard/round/${no}`);
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (!res.ok) throw new Error();
        const rows: RoundRankRow[] = await res.json();
        setRoundCache((prev) => ({ ...prev, [no]: rows }));
      } catch {
        setBlocked("문제가 발생했습니다. 잠시 후 다시 시도해 주세요.");
      }
    })();
  }, [tab, selectedRound, roundCache, router]);

  if (blocked) {
    return (
      <main className="flex flex-1 items-center justify-center px-5 text-center">
        <p className="text-[16px] leading-[1.65] text-gb-text-body">{blocked}</p>
      </main>
    );
  }

  if (!dash || !rounds) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-[14px] text-gb-text-secondary">불러오는 중...</p>
      </main>
    );
  }

  const { me } = dash;
  const startedRounds = rounds
    .filter((r) => r.state !== "locked")
    .sort((a, b) => a.roundNo - b.roundNo);

  // 최소 회차 안내는 fn_min_rounds()가 0이면 표시하지 않는다 (addendum C항)
  const showMinRoundsNotice = me.minRoundsRequired > 0 && !me.rankEligible;

  const rows: RankRow[] =
    tab === "total"
      ? dash.total.map((r) => ({
          rank: r.rank,
          name: r.nickname,
          sub: r.orgUnitName,
          value: r.totalPoints.toLocaleString("ko-KR"),
          isMe: r.nickname === me.nickname,
        }))
      : tab === "average"
        ? dash.average.map((r) => ({
            rank: r.rank,
            name: r.nickname,
            sub: r.orgUnitName,
            value: r.avgPoints.toFixed(1),
            isMe: r.nickname === me.nickname,
          }))
        : tab === "department"
          ? dash.department.map((r) => ({
              rank: r.rank,
              name: r.departmentName,
              // 동명 부서가 108개라 이름만으로는 어느 행이 내 부서인지 구분할 수 없다.
              // 다른 3개 탭과 동일하게 sub 열에 소속명을 표시한다.
              sub: r.orgUnitName,
              value: r.avgPoints.toFixed(1),
              // 구 스냅샷(departmentId 부재)에서는 배지를 붙이지 않는다 — 틀린 배지보다 낫다
              isMe: r.departmentId != null && r.departmentId === me.departmentId,
            }))
          : (selectedRound !== null ? (roundCache[selectedRound] ?? []) : []).map(
              (r) => ({
                rank: r.rank,
                name: r.nickname,
                sub: r.orgUnitName,
                value: r.points.toLocaleString("ko-KR"),
                isMe: r.nickname === me.nickname,
              })
            );

  const roundLoading =
    tab === "round" && selectedRound !== null && !(selectedRound in roundCache);

  return (
    <main className="flex flex-1 flex-col gap-3.5 px-4 pt-4 pb-2">
      {/* 제목 + 갱신 시각 */}
      <div className="flex items-baseline justify-between gap-2.5">
        <h1 className="m-0 text-[24px] font-extrabold tracking-[-0.01em] text-white">
          순위
        </h1>
        {dash.computedAt !== null && (
          <div className="font-gb-num text-[12px] text-gb-text-secondary tabular-nums">
            {formatComputedAt(dash.computedAt)}
          </div>
        )}
      </div>

      {/* 내 현황 카드 2장 — 순위 밖이어도 항상 표시 (business-rules 5.2) */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex flex-col gap-1 rounded border-[3px] border-gb-border-card bg-gb-bg-panel px-3.5 py-3 shadow-gb-card">
          <div className="text-[12px] font-bold text-gb-text-secondary">
            내 순위
          </div>
          {me.totalRank !== null ? (
            <div className="font-gb-num flex items-baseline gap-0.5 font-bold tabular-nums">
              <span className="text-[30px] leading-none text-gb-yellow">
                {me.totalRank}
              </span>
              <span className="text-[14px] text-gb-text-secondary">위</span>
              <span className="ml-[5px] text-[14px] text-gb-text-secondary">
                / {me.rankedParticipants.toLocaleString("ko-KR")}
              </span>
            </div>
          ) : (
            <div className="text-[14px] font-bold leading-[1.5] text-gb-text-secondary">
              순위 집계 대상이 아닙니다
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1 rounded border-[3px] border-gb-border-card bg-gb-bg-panel px-3.5 py-3 shadow-gb-card">
          <div className="text-[12px] font-bold text-gb-text-secondary">
            우리 부서 순위
          </div>
          {me.departmentRank !== null ? (
            <div className="font-gb-num flex items-baseline gap-0.5 font-bold tabular-nums">
              <span className="text-[30px] leading-none text-gb-yellow">
                {me.departmentRank}
              </span>
              <span className="text-[14px] text-gb-text-secondary">위</span>
              <span className="ml-[5px] text-[14px] text-gb-text-secondary">
                / {me.rankedDepartments.toLocaleString("ko-KR")}
              </span>
            </div>
          ) : (
            <div className="text-[14px] font-bold leading-[1.5] text-gb-text-secondary">
              순위 집계 대상이 아닙니다
            </div>
          )}
        </div>
      </div>

      {showMinRoundsNotice && (
        <div className="-mt-1 text-[13px] text-gb-text-secondary">
          3회 이상 참여하면 순위에 반영됩니다
        </div>
      )}

      {/* 순위 4종 탭 */}
      <div className="grid grid-cols-4 gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`min-h-11 cursor-pointer rounded-[3px] border-2 px-1 text-[13px] font-bold active:translate-x-px active:translate-y-px ${
              tab === t.key
                ? "border-gb-yellow bg-gb-yellow text-gb-bg-screen shadow-[3px_3px_0_#6b5200]"
                : "border-gb-border-chip bg-[#0f1425] text-[#9AA4C2]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 회차 선택 (회차별 탭) */}
      {tab === "round" && startedRounds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {startedRounds.map((r) => (
            <button
              key={r.roundNo}
              type="button"
              onClick={() => setSelectedRound(r.roundNo)}
              className={`font-gb-num min-h-9 cursor-pointer rounded-[3px] border-2 px-3 text-[13px] font-bold active:translate-x-px active:translate-y-px ${
                selectedRound === r.roundNo
                  ? "border-gb-yellow bg-gb-bg-highlight text-gb-yellow"
                  : "border-gb-border-chip bg-gb-bg-screen text-gb-text-secondary"
              }`}
            >
              {r.roundNo}회차
            </button>
          ))}
        </div>
      )}

      {tab === "department" && (
        <div className="-mb-1 px-0.5 text-[13px] text-gb-text-secondary">
          참여자 3명 이상인 부서만 표시됩니다
        </div>
      )}

      {roundLoading ? (
        <div className="flex min-h-[120px] items-center justify-center">
          <p className="text-[14px] text-gb-text-secondary">불러오는 중...</p>
        </div>
      ) : (
        <RankTable
          key={tab === "round" ? `round-${selectedRound}` : tab}
          headers={HEADERS[tab]}
          rows={rows}
          visibleRows={dash.visibleRows}
          emptyText="아직 참여 기록이 없습니다"
          meBadgeLabel={tab === "department" ? "우리 부서" : "나"}
        />
      )}
    </main>
  );
}
