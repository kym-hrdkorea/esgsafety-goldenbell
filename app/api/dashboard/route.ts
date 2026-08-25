import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { getParticipantId } from "@/lib/session";
import { apiError } from "@/lib/quiz";

export const dynamic = "force-dynamic";

// 대시보드 (business-rules 5.2·5.3).
// 순위 목록은 ranking_snapshot만 읽는다 — .in() 화이트리스트가 F항(org_unit 미노출) 방어선이다.
// 뷰 직접 조회는 본인·본인 부서 순위 1건 + 승인된 count 2건뿐이다 (addendum B항).
// 2026-08-25(Q항): '전체 누적'(total)은 포상 기준(평균)과 어긋나 응답에서 제거했다.
// 내 순위는 평균 포인트 기준(v_rank_average)이다.
const SNAPSHOT_KINDS = ["average", "department"] as const;
type SnapshotKind = (typeof SNAPSHOT_KINDS)[number];

export async function GET(req: NextRequest) {
  const pid = getParticipantId(req);
  if (!pid) return apiError(401, "UNAUTHENTICATED");

  try {
    const db = getDb();

    const [pRes, sesRes] = await Promise.all([
      db
        .from("participant")
        .select("nickname, department_id")
        .eq("id", pid)
        .maybeSingle(),
      // 내 참여 회차 수 — rankEligible 판정용. 확정 세션만 (/api/me와 동일 기준)
      db
        .from("quiz_session")
        .select("id", { count: "exact", head: true })
        .eq("participant_id", pid)
        .in("status", ["completed", "expired"]),
    ]);
    if (pRes.error) throw new Error(pRes.error.message);
    if (sesRes.error) throw new Error(sesRes.error.message);
    const p = pRes.data;
    if (!p) return apiError(401, "UNAUTHENTICATED");
    const roundsTaken = sesRes.count ?? 0;

    const cfg = await getConfig();

    const [minRoundsRes, myRankRes, deptRankRes, snapRes, avgCntRes, deptCntRes] =
      await Promise.all([
        // 최소 회차는 항상 fn_min_rounds() — app_config 직접 읽기 금지 (addendum C항)
        db.rpc("fn_min_rounds"),
        // 내 순위 1건 — 평균 포인트 기준 (Q항. 원래 v_rank_total)
        db.from("v_rank_average").select("rank").eq("participant_id", pid).maybeSingle(),
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
        db.from("v_rank_average").select("participant_id", { count: "exact", head: true }),
        db.from("v_rank_department").select("department_id", { count: "exact", head: true }),
      ]);
    for (const r of [minRoundsRes, myRankRes, deptRankRes, snapRes, avgCntRes, deptCntRes]) {
      if (r.error) throw new Error(r.error.message);
    }
    // config 행 유실 시 함수가 null을 반환한다 — 조용히 "조건 없음"이 되면 안 된다
    if (minRoundsRes.data === null || minRoundsRes.data === undefined) {
      throw new Error("fn_min_rounds()가 null을 반환했습니다");
    }

    const minRoundsRequired = Number(minRoundsRes.data);

    const lists: Record<SnapshotKind, unknown[]> = {
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

    return NextResponse.json({
      me: {
        nickname: p.nickname,
        // 부서 탭 '우리 부서' 배지 판정용. 부서명은 유일하지 않으므로(193개 중 108개 동명)
        // 반드시 id로 비교한다 — 이름 비교는 남의 부서에 배지를 붙인다.
        departmentId: p.department_id,
        averageRank: myRankRes.data?.rank ?? null,
        departmentRank: deptRankRes.data?.rank ?? null,
        rankEligible: roundsTaken >= minRoundsRequired,
        minRoundsRequired,
        rankedParticipants: avgCntRes.count ?? 0,
        rankedDepartments: deptCntRes.count ?? 0,
      },
      average: lists.average,
      department: lists.department,
      computedAt,
      visibleRows: cfg.rank_visible_rows,
    });
  } catch (err) {
    console.error("[dashboard]", err instanceof Error ? err.message : err);
    return apiError(500, "INTERNAL");
  }
}
