import fs from "node:fs";

const root = new URL("../", import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, root), "utf8");
const vercel = JSON.parse(read("vercel.json"));
const refreshRoute = read("app/api/cron/refresh-rankings/route.ts");
const expireRoute = read("app/api/cron/expire-sessions/route.ts");
const adminLogin = read("app/api/admin/auth/login/route.ts");
const envExample = read(".env.example");
const adminHelpers = read("lib/admin.ts");
const adminPage = read("app/admin/page.tsx");
const dashboardPage = read("app/(main)/dashboard/page.tsx");
const roundSeed = read("db/03_seed_rounds.sql");

const errors = [];
const expect = (condition, message) => {
  if (!condition) errors.push(message);
};

expect(
  vercel.$schema === "https://openapi.vercel.sh/vercel.json",
  "vercel.json 스키마 선언 누락"
);
expect(
  Array.isArray(vercel.regions) &&
    vercel.regions.length === 1 &&
    vercel.regions[0] === "icn1",
  "Vercel 함수 리전이 서울 icn1 단일 리전이 아님"
);

const cronByPath = new Map(
  (vercel.crons ?? []).map((cron) => [cron.path, cron.schedule])
);
expect(
  cronByPath.size === 2,
  "Vercel Cron은 순위 갱신·세션 만료 2개여야 함"
);
expect(
  cronByPath.get("/api/cron/refresh-rankings") === "* * * * *",
  "순위 갱신 Cron이 매분 일정이 아님"
);
expect(
  cronByPath.get("/api/cron/expire-sessions") === "*/5 * * * *",
  "세션 만료 Cron이 5분 일정이 아님"
);

for (const [name, route] of [
  ["순위 갱신", refreshRoute],
  ["세션 만료", expireRoute],
]) {
  expect(
    route.includes("export const maxDuration = 60;"),
    `${name} 함수 maxDuration 60초 누락`
  );
  expect(
    route.includes("auth !== `Bearer ${secret}`"),
    `${name} Cron 인증 검사가 누락됨`
  );
  expect(
    route.includes("if (!secret"),
    `${name} Cron 비밀값 미설정 시 fail-closed 검사가 누락됨`
  );
}

for (const name of [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SESSION_SECRET",
  "CRON_SECRET",
  "ADMIN_LOGIN_ID",
  "ADMIN_INIT_PASSWORD",
]) {
  expect(envExample.includes(`${name}=`), `.env.example의 ${name} 누락`);
}
expect(
  !envExample.includes("\nTZ="),
  "Vercel 예약 환경변수 TZ에 의존하면 안 됨"
);
expect(
  !envExample.includes("NEXT_PUBLIC_SUPABASE"),
  "클라이언트 Supabase 환경변수를 추가하면 안 됨"
);
for (const [name, source] of [
  ["관리자 CSV", adminHelpers],
  ["관리자 화면", adminPage],
  ["참가자 대시보드", dashboardPage],
]) {
  expect(
    source.includes('timeZone: "Asia/Seoul"'),
    `${name}의 명시적 KST 변환 누락`
  );
}
expect(
  roundSeed.includes("Asia/Seoul = UTC+9") &&
    roundSeed.includes("2026-09-01 00:00:00+09") &&
    roundSeed.includes("2026-10-09 23:59:59+09"),
  "회차 일정의 명시적 KST 오프셋 누락"
);
expect(
  adminLogin.includes("async function seedIfEmpty()") &&
    adminLogin.includes("if ((count ?? 0) > 0) return;"),
  "관리자 최초 1회 시딩 보호 로직 누락"
);
expect(
  adminLogin.includes("if (initPassword.length < 12)"),
  "관리자 초기 비밀번호 12자 최소 조건 누락"
);

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(
  "T22 정적 검증 통과: icn1·Cron 매분/5분·60초 제한·인증·서버 환경변수·명시적 KST·관리자 1회 시딩"
);
