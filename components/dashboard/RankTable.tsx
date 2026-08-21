"use client";

import { useState } from "react";

export type RankRow = {
  rank: number;
  name: string;
  sub: string;
  value: string;
  isMe: boolean;
};

type Props = {
  headers: [string, string, string, string];
  rows: RankRow[];
  visibleRows: number;
  emptyText: string;
  meBadgeLabel: string;
};

// 열 폭(375px 행 내부폭 313 = 32 + 120.6 + 80.4 + 62 + gap 6×3).
// 이름 열 90.5→120.6px — '우리 부서' 배지가 붙는 내 행이 37.7px까지 눌려
// 부서 193종을 구분할 수 없었다 (ux B-2). 값 열 62px은 헤더 '평균 포인트'
// 실측 폭(12px + tracking .08em = 62.0px)에 맞춘 값이다. 문안은 줄일 수 없으므로
// (규칙 9) 열을 문안에 맞춘다. 순위 열은 '128' + pl-1.5 = 28.3px면 충분해 32px.
// 값 열을 줄이려면 헤더 폭부터 다시 재야 한다.
const GRID =
  "grid grid-cols-[32px_minmax(0,1.5fr)_minmax(0,1fr)_62px] items-center gap-1.5";

// 1~3위 메달 — 육각형(안전표지 프레임)에 금/은/동 채움 (design/image-assets.md 2-3).
// 숫자를 지운 순수 메달 대신 숫자를 유지한다: 공동 순위가 있어 등수 자체가 정보다.
const HEX_CLIP =
  "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";
const MEDAL_COLORS: Record<number, string> = {
  1: "#C9A227", // 브라스 골드 — 성취 전용색
  2: "#A8B0C4", // 실버
  3: "#9A6B3C", // 브론즈
};

function RankMedal({ rank }: { rank: number }) {
  return (
    <span style={{ filter: "drop-shadow(2px 2px 0 #070a16)" }}>
      <span
        className="font-gb-num flex h-[26px] w-[24px] items-center justify-center text-[13px] font-bold text-gb-bg-screen"
        style={{ clipPath: HEX_CLIP, background: MEDAL_COLORS[rank] }}
      >
        {rank}
      </span>
    </span>
  );
}

// 빈 상태 — 아직 울리지 않은 종과 빈 시상대 (design/image-assets.md 2-5).
// 고장·오류가 아니라 "개시 전 대기"로 읽히도록 담담하게. 문구는 호출부의 emptyText 그대로.
function EmptyStateArt() {
  return (
    <svg width="128" height="76" viewBox="0 0 128 76" fill="none" aria-hidden="true">
      {/* 걸린 종 — 움직임 선 없이 정지 상태 */}
      <line x1="30" y1="6" x2="30" y2="12" stroke="#3a4468" strokeWidth="3" />
      <g transform="translate(15, 8) scale(1.35)" fill="#C9A227" opacity="0.55">
        <path d="M12 3c-3.1 0-5.2 2.3-5.2 5.4v3.4L5 14.4v1.2h14v-1.2l-1.8-2.6V8.4C17.2 5.3 15.1 3 12 3z" />
        <path d="M10.2 17.4a1.9 1.9 0 0 0 3.6 0h-3.6z" />
      </g>
      {/* 빈 시상대 3단 — 1위 칸 위 노란 점 하나가 유일한 강조 */}
      <circle cx="88" cy="30" r="3" fill="#FFD400" />
      <rect x="74" y="38" width="28" height="32" fill="#232b47" stroke="#3a4468" strokeWidth="2.5" />
      <rect x="48" y="50" width="26" height="20" fill="#1b2239" stroke="#2f3a5e" strokeWidth="2.5" />
      <rect x="102" y="56" width="24" height="14" fill="#1b2239" stroke="#2f3a5e" strokeWidth="2.5" />
    </svg>
  );
}

// 순위표: 기본 rank_visible_rows행, [더보기]로 전체 확장 (business-rules 5.2).
// 공동 순위로 20행을 넘는 payload도 그대로 표시한다 (G7).
// 확장 상태는 React state만 사용한다 — 브라우저 스토리지 금지 (규칙 5).
// 부모에서 key={탭}으로 사용해 탭·회차 전환 시 접힘으로 초기화된다.
export default function RankTable({
  headers,
  rows,
  visibleRows,
  emptyText,
  meBadgeLabel,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, visibleRows);

  if (rows.length === 0) {
    return (
      <div className="flex min-h-[164px] flex-col items-center justify-center gap-2.5 rounded border-[3px] border-gb-border-divider py-6">
        <EmptyStateArt />
        <p className="text-[14px] text-gb-text-secondary">{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="overflow-hidden rounded border-[3px] border-gb-border-divider">
        <div className={`${GRID} bg-gb-bg-panel px-3 py-[9px]`}>
          {/* nowrap 필수: '평균 포인트'(62.0px)는 값 열과 동일 폭이라 wrap을 허용하면
              평균·부서 탭에서만 헤더가 2줄이 되어 탭 전환 시 표가 세로로 튄다. */}
          {headers.map((h, i) => (
            <div
              key={h}
              className={`text-[12px] font-extrabold tracking-[0.08em] whitespace-nowrap text-gb-text-secondary ${
                i === 3 ? "text-right" : ""
              }`}
            >
              {h}
            </div>
          ))}
        </div>
        {shown.map((row, i) => (
          <div
            key={i}
            className={`${GRID} border-t-2 border-gb-border-row px-3 py-[11px] text-[14px] ${
              row.rank === 1 ? "bg-[#1e1a2e]" : "bg-gb-bg-screen"
            }`}
          >
            {row.rank <= 3 ? (
              <RankMedal rank={row.rank} />
            ) : (
              <div className="font-gb-num pl-1.5 font-bold text-gb-text-secondary tabular-nums">
                {row.rank}
              </div>
            )}
            <div className="flex min-w-0 items-center gap-1.5 font-bold text-gb-text-primary">
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                {row.name}
              </span>
              {row.isMe && (
                <span className="flex-none rounded-[2px] bg-gb-yellow px-[5px] py-[2px] text-[10px] font-extrabold text-gb-bg-screen">
                  {meBadgeLabel}
                </span>
              )}
            </div>
            <div className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-gb-text-secondary">
              {row.sub}
            </div>
            <div className="font-gb-num text-right font-bold text-gb-yellow tabular-nums">
              {row.value}
            </div>
          </div>
        ))}
      </div>

      {rows.length > visibleRows && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="min-h-12 w-full cursor-pointer rounded border-[3px] border-gb-border-card bg-gb-bg-panel text-[15px] font-bold text-gb-text-strong-sub shadow-gb-card active:translate-x-[3px] active:translate-y-[3px] active:shadow-gb-pressed"
        >
          {expanded ? "접기" : "더보기"}
        </button>
      )}
    </div>
  );
}
