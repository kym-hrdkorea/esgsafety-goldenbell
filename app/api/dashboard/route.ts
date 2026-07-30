import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getConfigValue } from "@/lib/config";
import { getParticipantId } from "@/lib/session";
import { apiError } from "@/lib/quiz";

export const dynamic = "force-dynamic";

// 대시보드 (business-rules 5.2·5.3).
// 순위 목록은 ranking_snapshot만 읽는다 — .in() 화이트리스트가 F항(org_unit 미노출) 방어선이다.
// 본인·본인 부서 순위 1건만 뷰 직접 조회를 허용한다 (addendum B항).
const SNAPSHOT_KINDS = ["total", "average", "department"] as const;
type SnapshotKind = (typeof SNAPSHOT_KINDS)[number];

export async function GET(req: NextRequest) {
  const pid = getParticipantId(req);
  if (!pid) return apiError(401, "UNAUTHENTICATED");

  try {
    const db = getDb();

    const { data: p, error: pErr } = await db
      .from("participant")
      .select("nickname, department_id, department:department_id(name)")
      .eq("id", pid)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!p) return apiError(401, "UNAUTHENTICATED");

    const [scoreRes, minRoundsRes, myRankRes, deptRankRes, snapRes, totalCntRes, deptCntRes] =
      await Promise.all([
        // 내 점수·포인트·참여 회차 — 순위 뷰와 동일한 원천(v_round_score)이라 집계가 어긋나지 않는다
        db.from("v_round_score").select("score, points").eq("participant_id", pid),
        // 최소 회차는 항상 fn_min_rounds() — app_config 직접 읽기 금지 (addendum C항)
        db.rpc("fn_min_rounds"),
        db.from("v_rank_total").select("rank").eq("participant_id", pid).maybeSingle(),
        db
          .from("v_rank_department")
          .select("rank")
          .eq("department_id", p.department_id)
          .maybeSingle(),
        db
          .from("ranking_snapshot")
          .select("kind, payload, computed_at")
          .in("kind", [...SNAPSHOT_KINDS]),
        // 분모(내 순위 카드 "n위 / 전체") — 순위 대상 인원·부서 수
        db.from("v_rank_total").select("participant_id", { count: "exact", head: true }),
        db.from("v_rank_department").select("department_id", { count: "exact", head: true }),
      ]);
    for (const r of [scoreRes, minRoundsRes, myRankRes, deptRankRes, snapRes, totalCntRes, deptCntRes]) {
      if (r.error) throw new Error(r.error.message);
    }
    // config 행 유실 시 함수가 null을 반환한다 — 조용히 "조건 없음"이 되면 안 된다
    if (minRoundsRes.data === null || minRoundsRes.data === undefined) {
      throw new Error("fn_min_rounds()가 null을 반환했습니다");
    }

    const roundsTaken = (scoreRes.data ?? []).length;
    const minRoundsRequired = Number(minRoundsRes.data);

    const lists: Record<SnapshotKind, unknown[]> = {
      total: [],
      average: [],
      department: [],
    };
    let computedAt: string | null = null;
    for (const row of snapRes.data ?? []) {
      lists[row.kind as SnapshotKind] = row.payload ?? [];
      if (computedAt === null || row.computed_at > computedAt) {
        computedAt = row.computed_at;
      }
    }

    const dept = p.department as unknown as { name: string };
    return NextResponse.json({
      me: {
        nickname: p.nickname,
        departmentName: dept.name,
        totalScore: (scoreRes.data ?? []).reduce((s, r) => s + r.score, 0),
        totalPoints: (scoreRes.data ?? []).reduce((s, r) => s + r.points, 0),
        roundsTaken,
        totalRank: myRankRes.data?.rank ?? null,
        departmentRank: deptRankRes.data?.rank ?? null,
        rankEligible: roundsTaken >= minRoundsRequired,
        minRoundsRequired,
        rankedParticipants: totalCntRes.count ?? 0,
        rankedDepartments: deptCntRes.count ?? 0,
      },
      total: lists.total,
      average: lists.average,
      department: lists.department,
      computedAt,
      visibleRows: await getConfigValue("rank_visible_rows"),
    });
  } catch (err) {
    console.error("[dashboard]", err instanceof Error ? err.message : err);
    return apiError(500, "INTERNAL");
  }
}
