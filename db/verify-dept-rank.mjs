// 부서·소속 순위 뷰 독립 재계산 대조 (addendum Q항, business-rules 5.2 G11·G12)
// 뷰를 믿지 않는다 — 원본 테이블(quiz_session·quiz_session_item·participant·
// quiz_round·app_config)에서 포인트 산식을 인라인으로 다시 구현해 종합점수를
// 재계산하고 v_rank_department / v_rank_org_unit 전행과 대조한다.
// lib/grading.ts를 import하지 않는다 — 독립 경로여야 대조에 의미가 있다.
//
// 실행: node --env-file=.env.local db/verify-dept-rank.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 필요합니다.");
}
const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const errors = [];
const expect = (condition, message) => {
  if (!condition) errors.push(message);
};

// 소수 필드는 numeric(SQL) vs double(JS) 오차를 허용한다
const TOLERANCE = 0.05;
const close = (a, b) => Math.abs(a - b) <= TOLERANCE;
// 뷰의 ROUND(numeric, 1)와 동일하게 마지막에만 1자리 반올림한다
const round1 = (x) => Math.round(x * 10) / 10;

async function fetchAll(table, columns, apply = (q) => q) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await apply(
      db.from(table).select(columns).range(from, from + 999)
    );
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

// ---------------------------------------------------------------- 입력 수집
const configRows = await fetchAll("app_config", "key,value");
const cfg = Object.fromEntries(configRows.map((r) => [r.key, Number(r.value)]));
for (const k of [
  "items_per_round",
  "point_base",
  "point_time_bonus_max",
  "item_time_limit_sec",
  "min_participants_for_dept",
  "min_participants_for_unit",
]) {
  if (!Number.isFinite(cfg[k])) throw new Error(`app_config.${k} 누락 또는 숫자 아님`);
}
const roundMax = cfg.items_per_round * (cfg.point_base + cfg.point_time_bonus_max);
const limitMs = cfg.item_time_limit_sec * 1000;
// 가중치 0.5/0.5는 운영자 확정 정책 상수 (addendum Q항 — 뷰 산식과 동일하게 상수)
const W_POINTS = 0.5;
const W_PART = 0.5;

const roundRows = await fetchAll("quiz_round", "round_no,is_published,opens_at,closes_at");
const nowMs = Date.now();
const openRoundsJs = roundRows.filter(
  (r) => r.is_published && new Date(r.opens_at).getTime() <= nowMs
).length;

// fn_open_rounds() 교차검증 — opens_at이 지금 ±2분 이내인 회차가 있으면 경고로 강등
const { data: openRoundsFn, error: orErr } = await db.rpc("fn_open_rounds");
if (orErr) throw new Error(`fn_open_rounds: ${orErr.message}`);
if (openRoundsFn !== openRoundsJs) {
  const nearBoundary = roundRows.some(
    (r) => Math.abs(new Date(r.opens_at).getTime() - nowMs) < 2 * 60_000
  );
  if (nearBoundary) {
    console.warn(
      `경고: fn_open_rounds=${openRoundsFn}, JS 재계산=${openRoundsJs} — opens_at 경계(±2분) 회차 존재`
    );
  } else {
    expect(false, `개방 회차 수 불일치: fn_open_rounds=${openRoundsFn}, JS=${openRoundsJs}`);
  }
}
const openRounds = openRoundsFn;

const sessions = await fetchAll("quiz_session", "id,participant_id,round_no", (q) =>
  q.in("status", ["completed", "expired"])
);
const sessionIds = sessions.map((s) => s.id);
const items = [];
for (let i = 0; i < sessionIds.length; i += 50) {
  const chunk = sessionIds.slice(i, i + 50);
  const part = await fetchAll(
    "quiz_session_item",
    "session_id,is_correct,is_timeout,elapsed_ms",
    (q) => q.in("session_id", chunk)
  );
  items.push(...part);
}
const participants = await fetchAll("participant", "id,department_id,org_unit_id");
const pById = new Map(participants.map((p) => [p.id, p]));

// ------------------------------------------------------------ 독립 재계산
// 문항 포인트 (business-rules 5.0과 동일식 — 양수 구간에서 SQL ROUND와 Math.round 동치)
const pointsBySession = new Map(sessionIds.map((id) => [id, 0]));
for (const si of items) {
  const pts =
    si.is_correct === true && !si.is_timeout
      ? cfg.point_base +
        Math.round(
          (cfg.point_time_bonus_max *
            Math.max(limitMs - (si.elapsed_ms ?? limitMs), 0)) /
            limitMs
        )
      : 0;
  pointsBySession.set(si.session_id, (pointsBySession.get(si.session_id) ?? 0) + pts);
}

// 참가자별: 응시 회차 수 → 참여율(100% 클램프)
const byParticipant = new Map();
for (const s of sessions) {
  const cur = byParticipant.get(s.participant_id) ?? { roundsTaken: 0 };
  cur.roundsTaken += 1;
  byParticipant.set(s.participant_id, cur);
}

// 그룹(부서·소속)별 집계 → 종합점수 → RANK 부여 → 뷰와 대조
function recomputeGroups(groupKeyOf) {
  const groups = new Map();
  for (const s of sessions) {
    const p = pById.get(s.participant_id);
    if (!p) throw new Error(`participant ${s.participant_id} 조회 실패`);
    const gid = groupKeyOf(p);
    const g = groups.get(gid) ?? { sessionPoints: [], participantIds: new Set() };
    g.sessionPoints.push(pointsBySession.get(s.id) ?? 0);
    g.participantIds.add(s.participant_id);
    groups.set(gid, g);
  }
  const rows = [];
  for (const [gid, g] of groups) {
    const avgPointsRaw =
      g.sessionPoints.reduce((a, b) => a + b, 0) / g.sessionPoints.length;
    const parts = [...g.participantIds].map((pid) =>
      Math.min(byParticipant.get(pid).roundsTaken / openRounds, 1)
    );
    const avgPart = parts.reduce((a, b) => a + b, 0) / parts.length;
    rows.push({
      id: gid,
      participants: g.participantIds.size,
      sessions: g.sessionPoints.length,
      avgPoints: round1(avgPointsRaw),
      avgParticipationPct: round1(avgPart * 100),
      compositeScore: round1(
        (avgPointsRaw / roundMax) * 100 * W_POINTS + avgPart * 100 * W_PART
      ),
    });
  }
  return rows;
}

// 뷰와 동일 정렬·RANK 의미(1,2,2,4). 동순위 = 종합점수·참여자 수 모두 동일.
// ★ 뷰의 RANK()는 WHERE(최소 참여자 필터) 이후 행에만 매겨지므로,
//   재계산도 반드시 "필터 통과 집합"에만 순위를 부여해야 한다 (2026-08-28 수정 —
//   미달 그룹까지 포함해 매기면 미달 그룹이 중간 순위에 끼는 순간 오탐이 난다).
function assignRanks(rows) {
  rows.sort(
    (a, b) => b.compositeScore - a.compositeScore || b.participants - a.participants
  );
  let rank = 0;
  rows.forEach((r, i) => {
    if (
      i === 0 ||
      r.compositeScore !== rows[i - 1].compositeScore ||
      r.participants !== rows[i - 1].participants
    ) {
      rank = i + 1;
    }
    r.rank = rank;
  });
  return rows;
}

function compare(label, viewRows, jsRows, idField, minParticipants, hasSessions) {
  const eligible = assignRanks(jsRows.filter((r) => r.participants >= minParticipants));
  const viewById = new Map(viewRows.map((r) => [Number(r[idField]), r]));
  expect(
    viewRows.length === eligible.length &&
      eligible.every((r) => viewById.has(r.id)),
    `${label}: 집합 불일치 — 뷰 ${viewRows.length}개(${[...viewById.keys()].join(",")}) vs ` +
      `재계산 ${eligible.length}개(${eligible.map((r) => r.id).join(",")})`
  );
  // 3명 미만 그룹이 뷰에 노출되지 않는지 (G4·G5 경계)
  for (const r of jsRows.filter((x) => x.participants < minParticipants)) {
    expect(!viewById.has(r.id), `${label}: 참여자 ${r.participants}명 그룹 ${r.id}이 뷰에 노출됨`);
  }
  for (const js of eligible) {
    const v = viewById.get(js.id);
    if (!v) continue;
    const checks = [
      ["rank", Number(v.rank) === js.rank, `${Number(v.rank)} vs ${js.rank}`],
      ["participants", Number(v.participants) === js.participants, `${v.participants} vs ${js.participants}`],
      ...(hasSessions
        ? [["sessions", Number(v.sessions) === js.sessions, `${v.sessions} vs ${js.sessions}`]]
        : []),
      ["avg_points", close(Number(v.avg_points), js.avgPoints), `${v.avg_points} vs ${js.avgPoints}`],
      ["composite_score", close(Number(v.composite_score), js.compositeScore), `${v.composite_score} vs ${js.compositeScore}`],
      ["avg_participation_pct", close(Number(v.avg_participation_pct), js.avgParticipationPct), `${v.avg_participation_pct} vs ${js.avgParticipationPct}`],
    ];
    for (const [field, ok, detail] of checks) {
      expect(ok, `${label} ${js.id}: ${field} 불일치 (뷰 vs 재계산: ${detail})`);
    }
    expect(
      Number(v.avg_participation_pct) <= 100,
      `${label} ${js.id}: 참여율 ${v.avg_participation_pct} > 100 (클램프 실패)`
    );
  }
  // 뷰 자체의 정렬 회귀 — rank 오름차순에서 composite가 내림차순인가
  const sortedView = [...viewRows].sort((a, b) => Number(a.rank) - Number(b.rank));
  for (let i = 1; i < sortedView.length; i++) {
    expect(
      Number(sortedView[i].composite_score) <= Number(sortedView[i - 1].composite_score) + TOLERANCE,
      `${label}: rank ${sortedView[i].rank}의 종합점수가 상위보다 큼(정렬 회귀)`
    );
  }
}

// ---------------------------------------------------------------- 대조 실행
if (sessions.length === 0) {
  const deptView = await fetchAll("v_rank_department", "rank");
  expect(deptView.length === 0, "확정 세션 0인데 부서 순위 뷰에 행이 있음");
  console.log("확정 세션 0 — 부서 순위 뷰 0행 확인만 수행");
} else if (openRounds === 0) {
  throw new Error("개방 회차 0인데 확정 세션 존재 — 회차 상태를 먼저 확인하라");
} else {
  const [deptView, unitView] = await Promise.all([
    fetchAll(
      "v_rank_department",
      "rank,department_id,participants,sessions,avg_points,composite_score,avg_participation_pct"
    ),
    fetchAll(
      "v_rank_org_unit",
      "rank,org_unit_id,participants,avg_points,composite_score,avg_participation_pct"
    ),
  ]);
  compare(
    "부서",
    deptView,
    recomputeGroups((p) => p.department_id),
    "department_id",
    cfg.min_participants_for_dept,
    true
  );
  compare(
    "소속",
    unitView,
    recomputeGroups((p) => p.org_unit_id),
    "org_unit_id",
    cfg.min_participants_for_unit,
    false
  );
  if (errors.length === 0) {
    console.log(
      `부서·소속 순위 재계산 대조 통과 — 개방 회차 ${openRounds}, 확정 세션 ${sessions.length}, ` +
        `부서 뷰 ${deptView.length}행, 소속 뷰 ${unitView.length}행, 회차만점 ${roundMax}P`
    );
  }
}

if (errors.length) {
  console.error(errors.map((e) => `- ${e}`).join("\n"));
  process.exit(1);
}
