// 영역 아이콘 8종 — BellIcon·LockIcon과 같은 규격의 인라인 SVG (24×24, stroke 2.2).
//
// raster 이미지를 쓰지 않는 이유는 design/image-assets.md 3-3에 있다:
// 24px에서 8개가 한 세트로 보여야 하는데 생성 이미지는 선 굵기 일관성을 못 맞추고,
// 기존 아이콘이 전부 인라인 SVG라 여기만 이미지를 섞으면 어긋난다.
//
// 실루엣을 일부러 겹치지 않게 골랐다(불꽃/집/하트/가로직사각/십자상자/클립보드/책/기둥건물).
// 작은 크기에서 서로 구별되는 것이 형태 자체의 완성도보다 중요하다.

import type { ReactNode } from "react";

type IconProps = { size?: number; color?: string };

function Frame({
  size = 18,
  color = "currentColor",
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: "0 0 auto" }}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** F — 화재·대피 */
// 좌우 대칭 물방울은 불꽃으로 안 읽힌다. 왼쪽에 안쪽으로 감기는 굴곡을 넣어
// 비대칭 실루엣을 만들었다.
export function FireIcon(p: IconProps) {
  return (
    <Frame {...p}>
      <path d="M12.6 2.8c.4 2.4 1.7 3.9 3.1 5.5 1.3 1.5 2.1 3 2.1 4.9a5.8 5.8 0 0 1-11.6 0c0-1.5.5-2.7 1.5-3.9.5 1.2 1.2 1.9 2.1 2.2-.8-3-.2-5.6 2.8-8.7Z" />
    </Frame>
  );
}

/** G — 생활안전 */
export function HomeIcon(p: IconProps) {
  return (
    <Frame {...p}>
      <path d="M3.6 10.6 12 4.2l8.4 6.4v9.1a1 1 0 0 1-1 1H4.6a1 1 0 0 1-1-1v-9.1Z" />
      <path d="M9.7 20.7v-5.3h4.6v5.3" />
    </Frame>
  );
}

/** H — 직장 건강 */
// 하트 안에 맥박선을 넣으면 18px에서 두 선이 붙어 덩어리가 된다.
// 라벨이 옆에 붙어 있어 "좋아요"로 오해될 여지가 없으므로 하트만 남겼다.
export function HealthIcon(p: IconProps) {
  return (
    <Frame {...p}>
      <path d="M20.2 6.1a5.1 5.1 0 0 0-7.2 0L12 7.1l-1-1a5.1 5.1 0 0 0-7.2 7.2l8.2 8.2 8.2-8.2a5.1 5.1 0 0 0 0-7.2Z" />
    </Frame>
  );
}

/** O — 사무실 안전 */
export function OfficeIcon(p: IconProps) {
  return (
    <Frame {...p}>
      <rect x="3" y="4.6" width="18" height="11.4" rx="1.6" />
      <path d="M12 16v4.4" />
      <path d="M9.2 20.4h5.6" />
    </Frame>
  );
}

/** E — 응급처치 */
export function FirstAidIcon(p: IconProps) {
  return (
    <Frame {...p}>
      <rect x="3" y="7.2" width="18" height="12.6" rx="2" />
      <path d="M9 7.2V5.6A1.6 1.6 0 0 1 10.6 4h2.8A1.6 1.6 0 0 1 15 5.6v1.6" />
      <path d="M12 11v5" />
      <path d="M9.5 13.5h5" />
    </Frame>
  );
}

/** K — 위험성평가 */
export function AssessIcon(p: IconProps) {
  return (
    <Frame {...p}>
      <rect x="5.4" y="5.2" width="13.2" height="15.4" rx="2" />
      <path d="M9.4 5.2V3.6h5.2v1.6" />
      <path d="M9.2 13.2l2.3 2.3 4-4.2" />
    </Frame>
  );
}

/** L — 안전 법령 */
export function LawIcon(p: IconProps) {
  return (
    <Frame {...p}>
      <path d="M12 6.6C10 5.2 7.4 4.9 4.4 5.5v12.6c3-.6 5.6-.3 7.6 1.1 2-1.4 4.6-1.7 7.6-1.1V5.5c-3-.6-5.6-.3-7.6 1.1Z" />
      <path d="M12 6.6v12.6" />
    </Frame>
  );
}

/** S — 공단 안전 */
export function AgencyIcon(p: IconProps) {
  return (
    <Frame {...p}>
      <path d="M3.4 9.2 12 4.4l8.6 4.8" />
      <path d="M4.8 11.4h14.4" />
      <path d="M7.4 11.4v8.2" />
      <path d="M12 11.4v8.2" />
      <path d="M16.6 11.4v8.2" />
      <path d="M3.4 19.6h17.2" />
    </Frame>
  );
}

/** C — 청렴 (2026-08-26 청렴 혼합 개편) */
// 방패 실루엣은 기존 8종(불꽃/집/하트/가로직사각/십자상자/클립보드/책/기둥건물)과
// 겹치지 않는다. 체크는 클립보드(K)에도 있지만 바깥 윤곽이 달라 18px에서 구별된다.
export function IntegrityIcon(p: IconProps) {
  return (
    <Frame {...p}>
      <path d="M12 3.2 19 6v5c0 4.4-2.9 7.6-7 9.2-4.1-1.6-7-4.8-7-9.2V6l7-2.8Z" />
      <path d="M9.2 11.6l2.1 2.1 3.6-3.9" />
    </Frame>
  );
}

/** 영역 코드 → 아이콘. me 화면의 CATEGORY_LABELS와 같은 코드를 쓴다. */
export const CATEGORY_ICONS: Record<
  string,
  (props: IconProps) => React.ReactElement
> = {
  F: FireIcon,
  G: HomeIcon,
  H: HealthIcon,
  O: OfficeIcon,
  E: FirstAidIcon,
  K: AssessIcon,
  L: LawIcon,
  S: AgencyIcon,
  C: IntegrityIcon,
};
