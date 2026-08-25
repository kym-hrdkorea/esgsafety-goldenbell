// 가상 응시 드라이버 — 테스트 참가자를 만들고 계획된 회차를 실제 API로 응시시킨다.
//
// 순위·대시보드 검증용이다. 문항 정답을 DB(service role)에서 읽어 표시 위치로 역산하므로
// 목표 정답 수가 정확히 만들어지고, 서버 판정이 의도와 다르면 즉시 예외로 멈춘다.
//
//   node --env-file=.env.local db/e2e-drive.mjs run [시작번호] [끝번호]
//   node --env-file=.env.local db/e2e-drive.mjs plan      계획만 출력(쓰기 없음)
//   node --env-file=.env.local db/e2e-drive.mjs cleanup   테스트 대역만 삭제
//
// 안전장치
//  - 사번 9000xxxx 대역만 만들고 지운다. 실제 참가자 계정은 절대 건드리지 않는다.
//  - 회차가 닫혀 있으면 세션 생성이 막히므로 응시 전 개방 상태를 확인해 알려준다.
import { createRequire } from "node:module";
const require = createRequire("file:///C:/안전골든벨 퀴즈대회/package.json");
const { createClient } = require("@supabase/supabase-js");

const BASE = process.env.TEST_BASE ?? "http://localhost:3000";
const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// ── 참가자 계획 ─────────────────────────────────────────────
// 부서 A 4명 / B 3명(경계값) / C 1명(미달) → 부서 순위 최소 3명 필터 검증
// 응시 회차 수를 6·5·3·2로 흩어 최소 3회 조건과 평균 순위를 함께 검증
const ALL = [1, 2, 3, 4, 5, 6];
export const PLAN = [
  { n: 1, dept: "A", rounds: ALL,          base: 12, delayMs: 120 },
  { n: 2, dept: "A", rounds: ALL,          base: 10, delayMs: 260 },
  { n: 3, dept: "A", rounds: ALL,          base: 8,  delayMs: 420 },
  { n: 4, dept: "A", rounds: [1, 2, 3],    base: 11, delayMs: 180 },
  { n: 5, dept: "B", rounds: ALL,          base: 9,  delayMs: 300 },
  { n: 6, dept: "B", rounds: [1, 2, 3, 4, 5], base: 7, delayMs: 240 },
  { n: 7, dept: "B", rounds: [1, 2],       base: 12, delayMs: 140 },  // 3회 미만 → 종합 제외 대상
  { n: 8, dept: "C", rounds: [1, 2],       base: 6,  delayMs: 360 },  // 부서 1명 → 부서 순위 제외
];

const EMP_BASE = 90000000;
const nick = (n) => `가상응시${String(n).padStart(2, "0")}`;
const empNo = (n) => String(EMP_BASE + n);
const phone = (n) => `010${String(70000000 + n).padStart(8, "0")}`;
// 회차가 갈수록 정답 수를 1씩 줄여 향상/하락이 아닌 '변별 있는 분포'를 만든다
const target = (p, round) => Math.max(2, p.base - (round - 1));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pickDepartments() {
  const { data, error } = await db
    .from("department")
    .select("id, name, org_unit:org_unit_id(name)")
    .order("id")
    .limit(3);
  if (error) throw new Error(error.message);
  return { A: data[0], B: data[1], C: data[2] };
}

async function openRounds() {
  const { data } = await db
    .from("quiz_round")
    .select("round_no, is_published, opens_at, closes_at")
    .order("round_no");
  const now = Date.now();
  return data.map((r) => ({
    round_no: r.round_no,
    open:
      r.is_published &&
      new Date(r.opens_at).getTime() <= now &&
      now <= new Date(r.closes_at).getTime(),
  }));
}

const cookieOf = (res) => {
  const m = (res.headers.get("set-cookie") ?? "").match(/hq_session=([^;]+)/);
  return m ? `hq_session=${m[1]}` : null;
};

async function login(p, deptId) {
  let r = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      empNo: empNo(p.n), nickname: nick(p.n),
      departmentId: deptId, phone: phone(p.n),
    }),
  });
  if (r.status === 201) return cookieOf(r);
  if (r.status === 409) {
    r = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empNo: empNo(p.n), pin: phone(p.n).slice(-4) }),
    });
    if (!r.ok) throw new Error(`${nick(p.n)} 로그인 실패 ${r.status}`);
    return cookieOf(r);
  }
  throw new Error(`${nick(p.n)} 가입 실패 ${r.status} ${await r.text()}`);
}

// 표시 위치 기준 정답/오답을 만든다. choice_order[표시위치] = 원본 index 규칙의 역산.
async function answerFor(sessionId, seq, wantCorrect) {
  const { data, error } = await db
    .from("quiz_session_item")
    .select("choice_order, item:item_id(item_type, answer)")
    .eq("session_id", sessionId).eq("seq", seq).single();
  if (error) throw new Error(error.message);
  const { item_type: t, answer: ans } = data.item;

  if (t === "OX") return wantCorrect ? ans : !ans;
  if (t === "MC4") {
    const pos = data.choice_order.indexOf(ans);
    return wantCorrect ? pos : pos === 0 ? 1 : 0;
  }
  if (t === "ORDER") {
    const correct = ans.map((o) => data.choice_order.indexOf(o));
    if (wantCorrect) return correct;
    const w = [...correct]; [w[0], w[1]] = [w[1], w[0]]; return w;
  }
  return wantCorrect ? (Array.isArray(ans) ? ans[0] : String(ans)) : "의도된오답";
}

async function takeRound(cookie, round, want, delayMs, label) {
  const H = { "Content-Type": "application/json", Cookie: cookie };
  const s = await fetch(`${BASE}/api/rounds/${round}/session`, { method: "POST", headers: H });
  if (s.status === 409) return "이미응시";
  if (!s.ok) throw new Error(`${label} R${round} 세션 ${s.status}`);

  const { data: rows } = await db
    .from("quiz_session")
    .select("id, participant:participant_id(nickname)")
    .eq("round_no", round).order("started_at", { ascending: false }).limit(80);
  const mine = rows.find((x) => x.participant.nickname === label);
  if (!mine) throw new Error(`${label} R${round} 세션 조회 실패`);

  let given = 0;
  for (let seq = 0; seq < 12; seq++) {
    const it = await fetch(`${BASE}/api/rounds/${round}/item?seq=${seq}`, { headers: H });
    if (!it.ok) throw new Error(`${label} R${round} seq${seq} item ${it.status}`);
    await it.json();
    if (delayMs) await sleep(delayMs);

    const wantCorrect = given < want;
    const submitted = await answerFor(mine.id, seq, wantCorrect);
    if (wantCorrect) given++;

    const a = await fetch(`${BASE}/api/rounds/${round}/answer`, {
      method: "POST", headers: H, body: JSON.stringify({ seq, submitted }),
    });
    if (!a.ok) throw new Error(`${label} R${round} seq${seq} answer ${a.status}`);
    const v = await a.json();
    if (v.isCorrect !== wantCorrect)
      throw new Error(`${label} R${round} seq${seq} 판정 불일치: 의도=${wantCorrect} 실제=${v.isCorrect}`);

    if (seq < 11) {
      const nx = await fetch(`${BASE}/api/rounds/${round}/next`, { method: "POST", headers: H });
      if (!nx.ok) throw new Error(`${label} R${round} next ${nx.status}`);
    }
  }
  return `${given}/12`;
}

async function cleanup() {
  const emps = PLAN.map((p) => empNo(p.n));
  const { data: t } = await db.from("participant").select("id, nickname").in("emp_no", emps);
  if (!t?.length) return console.log("삭제 대상 없음");
  const ids = t.map((x) => x.id);
  const { data: s } = await db.from("quiz_session").select("id").in("participant_id", ids);
  const sids = (s ?? []).map((x) => x.id);
  for (let i = 0; i < sids.length; i += 50)
    await db.from("quiz_session_item").delete().in("session_id", sids.slice(i, i + 50));
  await db.from("quiz_session").delete().in("participant_id", ids);
  await db.from("prelearning_view").delete().in("participant_id", ids);
  await db.from("participant").delete().in("id", ids);
  console.log(`삭제 완료: ${t.length}명 / 세션 ${sids.length}건`);
  const { count } = await db.from("participant").select("*", { count: "exact", head: true });
  console.log("남은 참가자:", count);
}

// ── 실행 ────────────────────────────────────────────────────
const cmd = process.argv[2] ?? "run";

if (cmd === "cleanup") {
  await cleanup();
} else {
  const depts = await pickDepartments();
  const open = await openRounds();
  const closed = open.filter((o) => !o.open).map((o) => o.round_no);
  console.log("개방 회차:", open.filter((o) => o.open).map((o) => o.round_no).join(",") || "없음");
  if (closed.length) console.log("⚠ 닫힌 회차(응시 불가):", closed.join(","));

  if (cmd === "plan") {
    console.log("\n계획:");
    for (const p of PLAN)
      console.log(` ${nick(p.n)} [${depts[p.dept].name}] 회차 ${p.rounds.join(",")} 목표정답 ${p.rounds.map((r) => target(p, r)).join(",")}`);
    process.exit(0);
  }

  const from = Number(process.argv[3] ?? 1);
  const to = Number(process.argv[4] ?? PLAN.length);
  for (const p of PLAN.filter((x) => x.n >= from && x.n <= to)) {
    const label = nick(p.n);
    const cookie = await login(p, depts[p.dept].id);
    const done = [];
    for (const r of p.rounds) {
      if (!open.find((o) => o.round_no === r)?.open) { done.push(`R${r}:닫힘`); continue; }
      done.push(`R${r}:${await takeRound(cookie, r, target(p, r), p.delayMs, label)}`);
    }
    console.log(`${label} [${depts[p.dept].name}] ${done.join(" ")}`);
  }
  console.log(`슬라이스 ${from}~${to} 완료`);
}
