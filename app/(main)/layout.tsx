import TabBar from "@/components/TabBar";

// 본편 화면 공통 레이아웃. 하단 탭은 TabBar가 경로 기준으로 표시를 스스로 결정한다
// (탭 루트 3종에서만 보이고, 응시 화면에서는 이탈 방지를 위해 없다).
export default function MainLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-10px)] w-full max-w-[640px] flex-col">
      <div className="flex flex-1 flex-col">{children}</div>
      <TabBar />
    </div>
  );
}
