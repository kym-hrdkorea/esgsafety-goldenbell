"use client";

// OX 선택 — 2열 대형 버튼, 글리프는 숫자 폰트 64px (design/mocks/응시-답변단계)
export default function OxItem({
  selected,
  onSelect,
}: {
  selected: number | null; // 0=O, 1=X
  onSelect: (index: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {["O", "X"].map((label, i) => {
        const on = selected === i;
        return (
          <button
            key={label}
            type="button"
            onClick={() => onSelect(i)}
            className={`flex h-[150px] items-center justify-center rounded cursor-pointer active:translate-x-1 active:translate-y-1 active:shadow-gb-pressed ${
              on
                ? "translate-x-[2px] translate-y-[2px] shadow-[3px_3px_0_#6B5200]"
                : "shadow-[6px_6px_0_#070a16]"
            }`}
            style={
              on
                ? {
                    background: "#FFD400",
                    border: "4px solid #FFE873",
                    color: "#12172b",
                  }
                : {
                    background: "#1b2239",
                    border: "4px solid #3a4468",
                    color: "#C6CEE4",
                  }
            }
          >
            <span className="font-gb-num text-[64px] leading-none font-bold">
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
