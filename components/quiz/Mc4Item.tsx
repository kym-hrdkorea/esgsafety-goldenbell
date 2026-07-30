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
  return (
    <div className="flex flex-col gap-2.5">
      {choices.map((label, i) => {
        const on = selected === i;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(i)}
            className="flex w-full min-h-[56px] items-center gap-3 rounded border-[3px] px-3.5 py-[13px] text-left text-[17px] leading-[1.5] break-keep active:translate-x-[3px] active:translate-y-[3px] active:shadow-gb-pressed"
            style={
              on
                ? {
                    background: "#FFD400",
                    borderColor: "#FFE873",
                    boxShadow: "2px 2px 0 #6B5200",
                    transform: "translate(2px,2px)",
                    color: "#12172b",
                    fontWeight: 700,
                  }
                : {
                    background: "#1b2239",
                    borderColor: "#3a4468",
                    boxShadow: "4px 4px 0 #070a16",
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
