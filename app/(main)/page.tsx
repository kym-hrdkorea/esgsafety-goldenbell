"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import BellIcon from "@/components/BellIcon";
import SoundToggle from "@/components/SoundToggle";
import { requestBgm } from "@/lib/sound";

type Me = {
  nickname: string;
  orgUnitName: string;
  departmentName: string;
  totalScore: number;
  roundsTaken: number;
  averageRank: number | null;
};

type RoundRow = {
  roundNo: number;
  season: number;
  theme: string;
  opensAt: string;
  closesAt: string;
  state: "locked" | "open" | "closed";
  myStatus: "none" | "in_progress" | "completed" | "expired";
  myScore: number | null;
};

const GHOST_BTN =
  "flex min-h-11 items-center justify-center rounded-[3px] border-2 border-gb-border-card text-[13px] font-bold no-underline active:translate-x-px active:translate-y-px";

// 홈: 내 요약 + 이번 주 회차 + 지난 회차 (design/mocks/홈, copy.md 홈 문안)
export default function HomePage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [rounds, setRounds] = useState<RoundRow[] | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  // 홈·탭 화면의 대기 배경음악 요청 — 소리 토글이 켜져 있을 때만 실제 재생
  useEffect(() => {
    requestBgm("main");
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [meRes, rRes] = await Promise.all([
          fetch("/api/me"),
          fetch("/api/rounds"),
        ]);
        if (meRes.status === 401 || rRes.status === 401) {
          router.replace("/login");
          return;
        }
        if (!meRes.ok || !rRes.ok) throw new Error();
        setMe(await meRes.json());
        setRounds(await rRes.json());
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

  if (!me || !rounds) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-[14px] text-gb-text-secondary">불러오는 중...</p>
      </main>
    );
  }

  const open = rounds.find((r) => r.state === "open");
  const closed = rounds
    .filter((r) => r.state === "closed")
    .sort((a, b) => b.roundNo - a.roundNo);
  const locked = rounds
    .filter((r) => r.state === "locked")
    .sort((a, b) => a.roundNo - b.roundNo);
  const openDone =
    open && (open.myStatus === "completed" || open.myStatus === "expired");

  return (
    <main className="flex flex-1 flex-col gap-5 px-4 pt-[18px] pb-4">
      {/* 서비스 헤더 + 인사 */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[3px] border-2 border-gb-yellow-light bg-gb-gold">
            <BellIcon size={24} />
          </div>
          <div className="flex flex-col gap-px">
            <div className="text-[15px] font-extrabold tracking-[0.02em] text-gb-yellow">
              HRDK 안전 골든벨 퀴즈 리그
            </div>
            <div className="text-[13px] font-semibold tracking-[0.04em] text-gb-text-strong-sub">
              안전 이룸, 함께 해냄
            </div>
          </div>
          <div className="flex-1" />
          <SoundToggle />
        </div>
        <div className="flex flex-col gap-0.5">
          <h1 className="m-0 text-[22px] font-extrabold tracking-[-0.01em] text-white">
            {me.nickname}님, 안녕하세요
          </h1>
          <div className="text-[13px] text-gb-text-secondary">
            {me.orgUnitName} · {me.departmentName}
          </div>
        </div>
      </div>

      {/* 요약 카드 3종 */}
      <div className="grid grid-cols-3 gap-2">
        <div className="flex flex-col gap-[3px] rounded border-[3px] border-gb-border-card bg-gb-bg-panel px-3 py-2.5 shadow-gb-card">
          <div className="text-[12px] font-bold text-gb-text-secondary">
            누적 점수
          </div>
          <div className="font-gb-num text-[24px] leading-[1.1] font-bold text-gb-yellow tabular-nums">
            {me.totalScore}
          </div>
        </div>
        <div className="flex flex-col gap-[3px] rounded border-[3px] border-gb-border-card bg-gb-bg-panel px-3 py-2.5 shadow-gb-card">
          <div className="text-[12px] font-bold text-gb-text-secondary">
            참여 회차
          </div>
          <div className="flex items-baseline gap-px">
            <span className="font-gb-num text-[24px] leading-[1.1] font-bold text-gb-text-primary tabular-nums">
              {me.roundsTaken}
            </span>
            <span className="font-gb-num text-[12px] text-gb-text-dim">
              /{rounds.length}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-[3px] rounded border-[3px] border-gb-border-card bg-gb-bg-panel px-3 py-2.5 shadow-gb-card">
          <div className="text-[12px] font-bold text-gb-text-secondary">
            내 순위
          </div>
          <div className="flex items-baseline gap-px">
            <span className="font-gb-num text-[24px] leading-[1.1] font-bold text-gb-text-primary tabular-nums">
              {me.averageRank ?? "-"}
            </span>
            {me.averageRank !== null && (
              <span className="text-[12px] text-gb-text-dim">위</span>
            )}
          </div>
        </div>
      </div>

      {/* 이번 주 문제 */}
      {open && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <div className="h-[14px] w-1 bg-gb-yellow" />
            <div className="text-[14px] font-extrabold text-gb-text-strong-sub">
              이번 주 문제
            </div>
          </div>
          <div className="overflow-hidden rounded border-[3px] border-gb-yellow bg-gb-bg-highlight shadow-gb-card">
            <div className="gb-hazard h-2" aria-hidden="true" />
            <div className="flex flex-col gap-3 px-3.5 pt-3.5 pb-4">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-gb-num rounded-[2px] bg-gb-yellow px-[7px] py-[2px] text-[13px] font-bold text-gb-bg-screen">
                    {open.roundNo}회차
                  </span>
                  {/* 몫 252px(375). 최장 테마 237.4px라 375·390에서는 온전히 보이고
                      360px에서만 꼬리가 잘린다 — 접히던 것보다 낫다 (ux B-3·C절) */}
                  <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[17px] font-extrabold text-white">
                    {open.theme}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[13px] text-gb-text-secondary">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                    <circle
                      cx="12"
                      cy="12"
                      r="8.5"
                      stroke="currentColor"
                      strokeWidth="2.4"
                    />
                    <path
                      d="M12 7.5V12l3 2.2"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span>금요일 23:59까지 참여할 수 있습니다</span>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Link
                  href={
                    openDone
                      ? `/round/${open.roundNo}/result`
                      : `/round/${open.roundNo}/quiz`
                  }
                  className="flex min-h-[52px] items-center justify-center rounded border-[3px] border-gb-yellow-light bg-gb-yellow text-[17px] font-extrabold tracking-[0.02em] text-gb-bg-screen no-underline shadow-gb-cta active:translate-x-[3px] active:translate-y-[3px] active:shadow-gb-pressed"
                >
                  {openDone ? "결과 보기" : "퀴즈 응시하기"}
                </Link>
                <Link
                  href={`/round/${open.roundNo}/learn`}
                  className={`${GHOST_BTN} min-h-12 text-[14px] text-gb-text-strong-sub`}
                >
                  사전학습 자료 보기
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 지난 회차 + 미개방 */}
      {(closed.length > 0 || locked.length > 0) && (
        <div className="flex flex-col gap-2.5">
          {closed.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="h-[14px] w-1 bg-gb-text-dim" />
              <div className="text-[14px] font-extrabold text-gb-text-strong-sub">
                지난 회차
              </div>
              <div className="flex-1" />
              <div className="text-[12px] font-bold text-gb-text-secondary">
                복습 (점수 미반영)
              </div>
            </div>
          )}

          {closed.map((r) => {
            const participated = r.myScore !== null;
            const perfect = participated && r.myScore === 12;
            return (
              <div
                key={r.roundNo}
                className="flex flex-col gap-2.5 rounded border-[3px] bg-gb-bg-panel px-3.5 py-3"
                style={{ borderColor: perfect ? "#C9A227" : "#262f4d" }}
              >
                <div className="flex items-center gap-2">
                  <span className="font-gb-num rounded-[2px] border-2 border-gb-text-dim px-1.5 py-px text-[12px] font-bold text-gb-text-secondary">
                    {r.roundNo}회차
                  </span>
                  {/* 테마가 남는 폭을 전부 갖고 상태는 우측 끝에 고정된다. flex-1 스페이서를
                      남겨두면 테마와 스페이서가 basis 0으로 공간을 반씩 나눠 테마 몫이
                      169 → 85px로 오히려 줄어든다 — 그래서 스페이서를 없앴다 (ux B-3). */}
                  <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-bold text-gb-text-primary">
                    {r.theme}
                  </span>
                  {participated &&
                    (perfect ? (
                      <span className="flex flex-none items-center gap-[5px] text-[12px] font-extrabold text-gb-gold">
                        <BellIcon size={14} fill="#C9A227" />
                        <span className="font-gb-num">
                          참여 완료 {r.myScore}/12
                        </span>
                      </span>
                    ) : (
                      <span className="font-gb-num flex-none text-[12px] font-bold text-gb-text-secondary">
                        참여 완료 {r.myScore}/12
                      </span>
                    ))}
                </div>
                <div
                  className={
                    participated ? "grid grid-cols-2 gap-2" : "grid grid-cols-1"
                  }
                >
                  {participated && (
                    <Link
                      href={`/round/${r.roundNo}/result`}
                      className={`${GHOST_BTN} bg-gb-bg-block text-gb-text-strong-sub`}
                    >
                      결과 보기
                    </Link>
                  )}
                  <Link
                    href={`/round/${r.roundNo}/review`}
                    className={`${GHOST_BTN} text-gb-text-secondary`}
                  >
                    복습하기
                  </Link>
                </div>
              </div>
            );
          })}

          {locked.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <div className="h-[14px] w-1 bg-gb-text-dim" />
              <div className="text-[14px] font-extrabold text-gb-text-strong-sub">
                예정 회차
              </div>
              <div className="flex-1" />
              <div className="text-[12px] font-bold text-gb-text-secondary">
                아직 개방 전
              </div>
            </div>
          )}

          {locked.map((r) => (
            <div
              key={r.roundNo}
              className="flex items-start gap-2 rounded border-[3px] border-dashed border-gb-border-divider px-3.5 py-3"
            >
              <span className="font-gb-num flex-none rounded-[2px] border-2 border-gb-border-chip px-1.5 py-px text-[12px] font-bold text-gb-text-dim">
                {r.roundNo}회차
              </span>
              {/* 우측 문안이 118px로 가장 길어 테마 몫이 128px뿐이다. 다른 행처럼 잘라내면
                  테마의 절반이 사라지므로 여기만 2줄을 허용한다 — 6개 테마 전부 어절
                  단위로 2줄에 들어간다. 접히던 게 아니라 접기로 한 것이다 (ux B-3). */}
              <span className="line-clamp-2 min-w-0 flex-1 text-[15px] font-bold text-gb-text-dim">
                {r.theme}
              </span>
              <span className="flex-none text-[13px] font-bold text-[#7A85A6]">
                아직 열리지 않았습니다
              </span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
