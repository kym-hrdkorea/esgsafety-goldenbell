"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// 하단 탭 3종 (홈/순위/내 기록) — design/mocks/홈.
// 탭 루트 화면에서만 표시한다. 응시·결과 등 상세 화면에는 없음(목업 확정) —
// 특히 응시 중 탭 숨김은 이탈 방지 요구사항이다 (T03 리뷰 배정 → T07).
const TABS = [
  { href: "/", label: "홈" },
  { href: "/dashboard", label: "순위" },
  { href: "/me", label: "내 기록" },
] as const;

function TabIcon({ label }: { label: string }) {
  if (label === "홈") {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path
          d="M4 11l8-7 8 7v9h-5.5v-5h-5v5H4v-9z"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (label === "순위") {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path
          d="M4 20V10M12 20V4M20 20v-7"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="3.6" stroke="currentColor" strokeWidth="2.2" />
      <path
        d="M5 20c1.2-3.2 3.8-4.8 7-4.8s5.8 1.6 7 4.8"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function TabBar() {
  const pathname = usePathname();
  const visible =
    pathname === "/" ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/me");
  if (!visible) return null;

  return (
    <nav className="sticky bottom-0 z-10 grid w-full grid-cols-3 border-t-[3px] border-gb-border-divider bg-gb-bg-panel">
      {TABS.map((t) => {
        const active =
          t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className="-mt-[3px] flex flex-col items-center gap-1 border-t-[3px] pt-2.5 pb-3.5 text-[13px] font-bold no-underline"
            style={
              active
                ? { color: "#FFD400", borderTopColor: "#FFD400" }
                : // 3.11:1 → 5.45:1 — 순위표로 가는 유일한 경로가 반사광에서 사라지지 않게 (ux A-3)
                  { color: "#8B93AB", borderTopColor: "transparent" }
            }
          >
            <TabIcon label={t.label} />
            <span>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
