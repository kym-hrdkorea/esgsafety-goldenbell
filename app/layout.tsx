import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HRDK 안전 골든벨 퀴즈 리그",
  description: "안전 이룸, 함께 해냄",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#12172b",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/* 숫자 전용 폰트(타이머·점수·순위). 한글 픽셀 폰트는 금지 — design/handoff.md */}
        <link
          href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@600;700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
          rel="stylesheet"
        />
      </head>
      <body className="bg-gb-bg-screen">
        {/* 전 화면 공통: 최상단 10px 해저드 스트라이프 */}
        <div className="gb-hazard h-[10px]" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
