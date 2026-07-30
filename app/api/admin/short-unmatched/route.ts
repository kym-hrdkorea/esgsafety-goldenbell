import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminId } from "@/lib/session";
import { fetchAll } from "@/lib/admin";
import { apiError } from "@/lib/quiz";

export const dynamic = "force-dynamic";

// SHORT 미매칭 응답 (business-rules 4절): 정규화 후에도 정답과 일치하지 않은
// 제출 원문을 모아 사후 수동 인정 검토용으로 조회만 제공한다. 수정 API는 없다.
export async function GET(req: NextRequest) {
  if (!getAdminId(req)) return apiError(401, "UNAUTHENTICATED");

  try {
    const db = getDb();

    const { data: shortItems, error: iErr } = await db
      .from("quiz_item")
      .select("id, item_code, round_no")
      .eq("item_type", "SHORT");
    if (iErr) throw new Error(iErr.message);
    if (!shortItems || shortItems.length === 0) {
      return NextResponse.json([]);
    }
    const itemById = new Map(shortItems.map((i) => [i.id, i]));

    const rows = await fetchAll((from, to) =>
      db
        .from("quiz_session_item")
        .select("item_id, session_id, submitted, answered_at")
        .in(
          "item_id",
          shortItems.map((i) => i.id)
        )
        .eq("is_correct", false)
        .not("submitted", "is", null)
        .order("answered_at", { ascending: false })
        .range(from, to)
    );
    if (rows.length === 0) return NextResponse.json([]);

    const { data: sessions, error: sErr } = await db
      .from("quiz_session")
      .select("id, participant_id")
      .in("id", [...new Set(rows.map((r) => r.session_id))]);
    if (sErr) throw new Error(sErr.message);
    const pidBySession = new Map(
      (sessions ?? []).map((s) => [s.id, s.participant_id])
    );

    const { data: parts, error: pErr } = await db
      .from("participant")
      .select("id, nickname")
      .in("id", [...new Set((sessions ?? []).map((s) => s.participant_id))]);
    if (pErr) throw new Error(pErr.message);
    const nickById = new Map((parts ?? []).map((p) => [p.id, p.nickname]));

    return NextResponse.json(
      rows.map((r) => {
        const item = itemById.get(r.item_id);
        return {
          itemCode: item?.item_code ?? "",
          roundNo: item?.round_no ?? null,
          nickname: nickById.get(pidBySession.get(r.session_id) ?? "") ?? "",
          submitted: r.submitted,
          answeredAt: r.answered_at,
        };
      })
    );
  } catch (err) {
    console.error(
      "[admin/short-unmatched]",
      err instanceof Error ? err.message : err
    );
    return apiError(500, "INTERNAL");
  }
}
