"use client";

// 단답 — 입력란은 문항 바로 아래에 두어 키보드가 올라와도 문항이 보인다 (design/handoff.md)
export default function ShortItem({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onSubmit();
        }
      }}
      placeholder="정답을 입력하세요"
      maxLength={30}
      className="w-full min-h-[56px] rounded border-[3px] border-gb-border-card bg-gb-bg-card px-4 text-[18px] font-bold text-white shadow-gb-card outline-none focus:border-gb-yellow"
    />
  );
}
