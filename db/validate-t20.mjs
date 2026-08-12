import fs from "node:fs";

const root = new URL("../", import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, root), "utf8");
const views = read("db/05_views.sql");
const admin = read("lib/admin.ts");
const exportRoute = read("app/api/admin/export/[kind]/route.ts");
const shortRoute = read("app/api/admin/short-unmatched/route.ts");
const signupRoute = read("app/api/auth/signup/route.ts");
const signupPage = read("app/(auth)/signup/page.tsx");
const home = read("app/(main)/page.tsx");
const dashboard = read("app/(main)/dashboard/page.tsx");
const shortItem = read("components/quiz/ShortItem.tsx");
const grading = read("lib/grading.ts");
const reviewRoute = read("app/api/rounds/[no]/review/route.ts");
const adminPage = read("app/admin/page.tsx");
const adminLogout = read("app/api/admin/auth/logout/route.ts");

const errors = [];
const expect = (condition, message) => {
  if (!condition) errors.push(message);
};

expect(views.includes("WHERE closes_at < now()"), "최소 회차가 실제 종료 회차를 세지 않음");
expect(!views.includes("WHERE is_published AND opens_at <= now()"), "최소 회차가 개방 회차 기준으로 남아 있음");
expect(admin.includes("CONCURRENCY = 4"), "대용량 관리자 조회 병렬 페이지네이션 누락");
expect(admin.includes("/^[\\t ]*[=+\\-@]/"), "CSV 수식 인젝션 방어 누락");
expect(exportRoute.includes("formatKst(r.answered_at)"), "응답 CSV KST 변환 누락");
expect(exportRoute.includes('.order("participant_id")'), "동일인 CSV 안정 정렬키 누락");
expect(shortRoute.includes("fetchByIdChunks") && shortRoute.includes(".range(from, to)"), "SHORT 대용량 조인 페이지네이션 누락");
expect(signupRoute.includes("{ code: \"VALIDATION\", field, message }"), "가입 검증 필드 식별자 누락");
expect(signupPage.includes('body.field === "empNo"') && signupPage.includes('body.field === "nickname"'), "가입 오류 필드별 표시 누락");
expect(home.includes("예정 회차") && home.includes("closed.length > 0"), "홈 예정·지난 회차 분리 누락");
expect(dashboard.includes("const ended = started.filter((r) => r.state === \"closed\")"), "대시보드 기본 회차 보정 누락");
expect(shortItem.includes("isComposing") && shortItem.includes("onSubmit"), "SHORT Enter 제출 누락");
expect(grading.includes("choices?.[o] ?? String(o + 1)"), "ORDER 복습 선택지 표시 누락");
expect(reviewRoute.includes("choices?.[o] ?? String(o + 1)"), "ORDER 복습 내 답 표시 누락");
expect(adminPage.includes("로그아웃") && adminPage.includes("다시 시도") && adminPage.includes("kst(s.answeredAt)"), "관리자 로그아웃·조회실패·KST UI 누락");
expect(adminLogout.includes("clearAdminSession"), "관리자 로그아웃 API 연결 누락");

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log("T20 검증 통과: 종료 회차 순위·CSV 안전성·대용량 조회·가입 오류·홈·관리자·퀴즈 사용성");
