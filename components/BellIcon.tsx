// 골든벨 종 아이콘 — design/mocks의 인라인 SVG 원본 (외부 이미지 없음)
export default function BellIcon({
  size = 42,
  fill = "#12172b",
}: {
  size?: number;
  fill?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3c-3.1 0-5.2 2.3-5.2 5.4v3.4L5 14.4v1.2h14v-1.2l-1.8-2.6V8.4C17.2 5.3 15.1 3 12 3z"
        fill={fill}
      />
      <path d="M10.2 17.4a1.9 1.9 0 0 0 3.6 0h-3.6z" fill={fill} />
    </svg>
  );
}

export function LockIcon({
  size = 20,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ flex: "0 0 auto" }}
    >
      <rect
        x="5"
        y="10.5"
        width="14"
        height="9"
        rx="1.5"
        stroke={color}
        strokeWidth="2.2"
      />
      <path d="M8.5 10V8a3.5 3.5 0 0 1 7 0v2" stroke={color} strokeWidth="2.2" />
    </svg>
  );
}
