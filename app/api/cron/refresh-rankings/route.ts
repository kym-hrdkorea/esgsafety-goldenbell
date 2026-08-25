import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getConfigValue } from "@/lib/config";
import { apiError } from "@/lib/quiz";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 순위 뷰 → ranking_snapshot 적재 (business-rules 5.3). 대시보드는 snapshot만 읽는다.
// 60초는 5.3이 고정한 스펙 상수다(운영 파라미터 아님). F항에 따라 org_unit도 적재한다.
const REFRESH_MIN_INTERVAL_MS = 60_000;

type PayloadRow = Record<string, unknown>;

// 유니크 인덱스가 표현식(kind, COALESCE(round_no,-1))이라 PostgREST upsert를 쓸 수 없다.
// 단일 실행(cron) 전제로 update → 없으면 insert. 경합의 유니크 위반은 무해하게 무시.
async function upsertSnapshot(
  kind: string,
  roundNo: number | null,
  payload: PayloadRow[],
  nowIso: string
) {
  const db = getDb();
  let q = db
    .from("ranking_snapshot")
    .update({ payload, computed_at: nowIso })
    .eq("kind", kind);
  q = roundNo === null ? q.is("round_no", null) : q.eq("round_no", roundNo);
  const { data: updated, error } = await q.select("id");
  if (error) throw new Error(error.message);
  if (updated && updated.length > 0) return;

  const { error: insErr } = await db
    .from("ranking_snapshot")
    .insert({ kind, round_no: roundNo, payload, computed_at: nowIso });
  if (insErr && insErr.code !== "23505") throw new Error(insErr.message);
}

async function refresh() {
  const db = getDb();

  // 60초 이내 중복 실행 스킵 (5.3)
  const { data: last, error: lastErr } = await db
    .from("ranking_snapshot")
    .select("computed_at")
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastErr) throw new Error(lastErr.message);
  if (
    last &&
    Date.now() - new Date(last.computed_at).getTime() < REFRESH_MIN_INTERVAL_MS
  ) {
    return { skipped: true as const };
  }

  // rank ≤ rank_max_rows 로 자른다 — 공동 순위는 행 수가 넘어도 포함된다 (G7)
  const maxRows = await getConfigValue("rank_max_rows");
  const nowIso = new Date().toISOString();
  const refreshed: string[] = [];

  // '전체 누적'(kind='total')은 적재하지 않는다 — 포상 기준(평균)과 어긋나
  // 2026-08-25 개편에서 제거했다(addendum Q항). 잔여 행은 배포 후 1회 DELETE
  // (db/10_views_migration_2026-08-26.sql 하단 DML 블록).

  // ③ 평균 포인트
  const { data: avg, error: aErr } = await db
    .from("v_rank_average")
    .select("rank, nickname, org_unit_name, avg_points, rounds_taken")
    .lte("rank", maxRows)
    .order("rank");
  if (aErr) throw new Error(aErr.message);
  await upsertSnapshot(
    "average",
    null,
    (avg ?? []).map((r) => ({
      rank: Number(r.rank),
      nickname: r.nickname,
      orgUnitName: r.org_unit_name,
      avgPoints: Number(r.avg_points),
      roundsTaken: Number(r.rounds_taken),
    })),
    nowIso
  );
  refreshed.push("average");

  // ④ 부서 (참여자 3명 이상 — 뷰가 거른다. 순위 기준은 종합점수, Q항)
  const { data: dept, error: dErr } = await db
    .from("v_rank_department")
    .select(
      "rank, department_id, department_name, org_unit_name, participants, avg_points, composite_score, avg_participation_pct"
    )
    .lte("rank", maxRows)
    .order("rank");
  if (dErr) throw new Error(dErr.message);
  await upsertSnapshot(
    "department",
    null,
    (dept ?? []).map((r) => ({
      rank: Number(r.rank),
      // 부서명은 유일하지 않다 — 193개 중 108개가 동명이다('직업능력개발부' 32곳).
      // 화면의 '우리 부서' 배지 판정은 반드시 이 id로 한다.
      departmentId: Number(r.department_id),
      departmentName: r.department_name,
      orgUnitName: r.org_unit_name,
      participants: Number(r.participants),
      avgPoints: Number(r.avg_points),
      compositeScore: Number(r.composite_score),
      avgParticipationPct: Number(r.avg_participation_pct),
    })),
    nowIso
  );
  refreshed.push("department");

  // ⑤ 소속 — 적재하되 대시보드 미노출 (addendum F항. 산식은 부서와 동일, Q항)
  const { data: unit, error: uErr } = await db
    .from("v_rank_org_unit")
    .select(
      "rank, org_unit_name, category_name, participants, avg_points, composite_score, avg_participation_pct"
    )
    .lte("rank", maxRows)
    .order("rank");
  if (uErr) throw new Error(uErr.message);
  await upsertSnapshot(
    "org_unit",
    null,
    (unit ?? []).map((r) => ({
      rank: Number(r.rank),
      orgUnitName: r.org_unit_name,
      categoryName: r.category_name,
      participants: Number(r.participants),
      avgPoints: Number(r.avg_points),
      compositeScore: Number(r.composite_score),
      avgParticipationPct: Number(r.avg_participation_pct),
    })),
    nowIso
  );
  refreshed.push("org_unit");

  // ② 회차별 — 확정 세션이 있는 회차만 뷰에 행이 생긴다.
  const { data: roundRows, error: rErr } = await db
    .from("v_rank_round")
    .select("round_no, rank, nickname, org_unit_name, points, score, pct")
    .lte("rank", maxRows)
    .order("round_no")
    .order("rank");
  if (rErr) throw new Error(rErr.message);
  const byRound = new Map<number, PayloadRow[]>();
  for (const r of roundRows ?? []) {
    const list = byRound.get(r.round_no) ?? [];
    list.push({
      rank: Number(r.rank),
      nickname: r.nickname,
      orgUnitName: r.org_unit_name,
      points: Number(r.points),
      score: Number(r.score),
      pct: Number(r.pct),
    });
    byRound.set(r.round_no, list);
  }

  // 뷰에 남은 회차만 돌면 세션이 전부 사라진 회차의 옛 payload가 스냅샷에 그대로
  // 남아 '회차별' 탭에 유령 순위로 계속 노출된다. 시작된 회차 전체를 순회해
  // 빈 회차는 []로 덮어쓴다 — total/average/department/org_unit과 같은 방식이다.
  // 시작 판정은 대시보드 회차 선택칩(roundState의 locked 제외)과 동일하게 맞춘다.
  const { data: started, error: sErr } = await db
    .from("quiz_round")
    .select("round_no")
    .eq("is_published", true)
    .lte("opens_at", nowIso);
  if (sErr) throw new Error(sErr.message);

  // 운영 중 회차를 되돌리는 등으로 뷰에만 남은 회차가 생겨도 빠뜨리지 않는다
  const targets = [
    ...new Set([...(started ?? []).map((r) => r.round_no), ...byRound.keys()]),
  ].sort((a, b) => a - b);
  for (const no of targets) {
    await upsertSnapshot("round", no, byRound.get(no) ?? [], nowIso);
    refreshed.push(`round:${no}`);
  }

  // 대상에서 빠진 회차(비공개 전환 등)의 스냅샷 행은 남겨두지 않는다.
  // /api/dashboard/round/[no]는 행이 없으면 []를 반환하므로 결과는 동일하다.
  let del = db.from("ranking_snapshot").delete().eq("kind", "round");
  if (targets.length > 0) {
    del = del.not("round_no", "in", `(${targets.join(",")})`);
  }
  const { data: removed, error: dropErr } = await del.select("round_no");
  if (dropErr) throw new Error(dropErr.message);
  for (const r of removed ?? []) refreshed.push(`round:${r.round_no}:removed`);

  return { skipped: false as const, refreshed, computedAt: nowIso };
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  // I6: 무인증 차단. 시크릿 미설정 시에도 전면 차단(fail-closed)
  if (!secret || auth !== `Bearer ${secret}`) {
    return apiError(401, "UNAUTHENTICATED");
  }
  try {
    return NextResponse.json(await refresh());
  } catch (err) {
    console.error(
      "[cron/refresh-rankings]",
      err instanceof Error ? err.message : err
    );
    return apiError(500, "INTERNAL");
  }
}

// Vercel Cron은 GET으로 호출한다 — 계약의 POST와 함께 둘 다 지원
export const GET = handle;
export const POST = handle;
