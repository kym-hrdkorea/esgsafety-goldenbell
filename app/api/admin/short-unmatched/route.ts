import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminId } from "@/lib/session";
import { fetchAll } from "@/lib/admin";
import { apiError } from "@/lib/quiz";

export const dynamic = "force-dynamic";

type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

async function fetchByIdChunks<T>(
  ids: string[],
  build: (chunk: string[], from: number, to: number) => PromiseLike<PageResult<T>>
): Promise<T[]> {
  const CHUNK_IDS = 500;
  const rows: T[] = [];
  for (let offset = 0; offset < ids.length; offset += CHUNK_IDS) {
    const chunk = ids.slice(offset, offset + CHUNK_IDS);
    rows.push(
      ...(await fetchAll((from, to) => build(chunk, from, to)))
    );
  }
  return rows;
}

// SHORT 미매칭 응답 (business-rules 4절): 정규화 후에도 정답과 일치하지 않은
// 제출 원문을 모아 사후 수동 인정 검토용으로 조회만 제공한다. 수정 API는 없다.
export async function GET(req: NextRequest) {
  if (!getAdminId(req)) return apiError(401, "UNAUTHENTICATED");

  try {
    const db = getDb();

    const shortItems = await fetchAll((from, to) =>
      db
        .from("quiz_item")
        .select("id, item_code, round_no")
        .eq("item_type", "SHORT")
        .order("id")
        .range(from, to)
    );
    if (shortItems.length === 0) {
      return NextResponse.json([]);
    }
    const itemById = new Map(shortItems.map((i) => [i.id, i]));

    const rows = await fetchAll((from, to) =>
      db
        .from("quiz_session_item")
        .select("id, item_id, session_id, submitted, answered_at")
        .in(
          "item_id",
          shortItems.map((i) => i.id)
        )
        .eq("is_correct", false)
        .not("submitted", "is", null)
        .order("id", { ascending: false })
        .range(from, to)
    );
    if (rows.length === 0) return NextResponse.json([]);

    const sessions = await fetchByIdChunks(
      [...new Set(rows.map((r) => r.session_id))],
      (ids, from, to) =>
        db
          .from("quiz_session")
          .select("id, participant_id")
          .in("id", ids)
          .order("id")
          .range(from, to)
    );
    const pidBySession = new Map(
      sessions.map((s) => [s.id, s.participant_id])
    );

    const parts = await fetchByIdChunks(
      [...new Set(sessions.map((s) => s.participant_id))],
      (ids, from, to) =>
        db
          .from("participant")
          .select("id, nickname")
          .in("id", ids)
          .order("id")
          .range(from, to)
    );
    const nickById = new Map(parts.map((p) => [p.id, p.nickname]));

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
