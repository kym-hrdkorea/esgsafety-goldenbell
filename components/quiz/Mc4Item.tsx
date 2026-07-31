"use client";

// 4지선다 선택지 카드. 눌림·선택 스타일은 design/mocks/응시-답변단계 확정값.
export default function Mc4Item({
  choices,
  selected,
  onSelect,
}: {
  choices: string[];
  selected: number | null;
  onSelect: (displayIndex: number) => void;
}) {
  // 카드 높이는 48px 이상을 유지한다 — 터치 타깃 최소 44px를 지키면서
  // 4지선다가 작은 화면(375x667)에서도 스크롤 없이 들어가는 상한이다.
  return (
    <div className="flex flex-col gap-2">
      {choices.map((label, i) => {
        const on = selected === i;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(i)}
            className={`flex w-full min-h-12 items-center gap-3 rounded border-[3px] px-3.5 py-2.5 text-left text-[16px] leading-[1.45] break-keep active:translate-x-[3px] active:translate-y-[3px] active:shadow-gb-pressed ${
              on
                ? "translate-x-[2px] translate-y-[2px] shadow-[2px_2px_0_#6B5200]"
                : "shadow-gb-card"
            }`}
            style={
              on
                ? {
                    background: "#FFD400",
                    borderColor: "#FFE873",
                    color: "#12172b",
                    fontWeight: 700,
                  }
                : {
                    background: "#1b2239",
                    borderColor: "#3a4468",
                    color: "#EDF0F7",
                    fontWeight: 500,
                  }
            }
          >
            <span
              className="font-gb-num flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[2px] text-[16px] font-bold tabular-nums"
              style={
                on
                  ? { background: "#12172b", color: "#FFD400" }
                  : { background: "#2a3252", color: "#8B93AB" }
              }
            >
              {i + 1}
            </span>
            <span className="flex-1 text-left [text-wrap:pretty]">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
