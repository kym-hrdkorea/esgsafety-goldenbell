import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "안전 골든벨 퀴즈 리그",
  description: "안전 이룸, 함께 해냄",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
