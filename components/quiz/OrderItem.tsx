"use client";

// 순서배열 — 탭 순서 배지 방식. 드래그 없음 (tasks T03, design/mocks/응시-답변단계).
// 탭하면 배지에 순번이 붙고, 다시 탭하면 해제된다.
export default function OrderItem({
  choices,
  orderSeq,
  onTap,
  onReset,
}: {
  choices: string[];
  orderSeq: number[]; // 표시 위치 인덱스, 탭한 순서대로
  onTap: (displayIndex: number) => void;
  onReset: () => void;
}) {
  // 최대 5지(7-03)까지 있으므로 MC4보다 더 촘촘해야 한 화면에 들어간다.
  // 그래도 카드는 48px, [다시 선택]은 44px로 터치 타깃 최소치를 지킨다.
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2.5">
        <div className="text-[13px] font-bold text-gb-yellow">
          순서대로 눌러 주세요
        </div>
        <button
          type="button"
          onClick={onReset}
          className="min-h-11 cursor-pointer rounded-[3px] border-2 border-gb-border-card bg-transparent px-3.5 text-[14px] font-bold text-gb-text-strong-sub active:translate-x-px active:translate-y-px"
        >
          다시 선택
        </button>
      </div>
      {choices.map((label, i) => {
        const at = orderSeq.indexOf(i);
        const picked = at >= 0;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onTap(i)}
            className={`flex w-full min-h-12 items-center gap-3 rounded border-[3px] px-3.5 py-2.5 text-left text-[16px] leading-[1.45] break-keep active:translate-x-[3px] active:translate-y-[3px] active:shadow-gb-pressed ${
              picked
                ? "translate-x-[2px] translate-y-[2px] shadow-[2px_2px_0_#6B5200]"
                : "shadow-gb-card"
            }`}
            style={
              picked
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
                picked
                  ? { background: "#12172b", color: "#FFD400" }
                  : { background: "#2a3252", color: "#8B93AB" }
              }
            >
              {picked ? at + 1 : "·"}
            </span>
            <span className="flex-1 text-left [text-wrap:pretty]">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
