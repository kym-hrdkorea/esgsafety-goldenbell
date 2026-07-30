import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getConfigValue } from "@/lib/config";
import { getParticipantId } from "@/lib/session";
import { shuffledIndices, randomSeed } from "@/lib/shuffle";
import {
  apiError,
  expireIfIdle,
  loadRound,
  loadSession,
  parseRoundNo,
  roundState,
  MSG,
  type Session,
} from "@/lib/quiz";

export const dynamic = "force-dynamic";

function sessionPayload(s: Session, theme: string) {
  return NextResponse.json({
    sessionId: s.id,
    totalItems: s.total_items,
    currentIndex: s.current_index,
    status: s.status,
    roundNo: s.round_no,
    theme,
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ no: string }> }
) {
  const pid = getParticipantId(req);
  if (!pid) return apiError(401, "UNAUTHENTICATED");

  const { no: noParam } = await ctx.params;
  const no = parseRoundNo(noParam);
  if (no === null) return apiError(404, "NOT_FOUND");

  try {
    const round = await loadRound(no);
    if (!round) return apiError(404, "NOT_FOUND");

    const state = roundState(round);
    if (state !== "open") {
      return apiError(
        403,
        "ROUND_NOT_OPEN",
        state === "locked" ? MSG.notOpen : MSG.closed
      );
    }

    // 1인 1회차 1회 — 기존 세션이 있으면 새로 만들지 않는다 (C1·C2)
    let existing = await loadSession(pid, no);
    if (existing) {
      // 30분 방치 세션은 재개 대신 만료 확정 → 아래 409로 결과 화면 유도 (F2, K항)
      existing = await expireIfIdle(existing);
      if (existing.status === "in_progress") {
        return sessionPayload(existing, round.theme);
      }
      return apiError(409, "ALREADY_COMPLETED", MSG.alreadyCompleted, {
        status: existing.status,
      });
    }

    const db = getDb();

    // measure_code/anchor_code/level은 조회 자체를 하지 않는다 (규칙 2-1)
    const { data: items, error: itemsErr } = await db
      .from("quiz_item")
      .select("id, item_type, choices")
      .eq("round_no", no)
      .order("seq_no");
    if (itemsErr) throw new Error(itemsErr.message);

    const itemsPerRound = await getConfigValue("items_per_round");
    if (items.length !== itemsPerRound) {
      throw new Error(
        `회차 ${no} 문항 수 불일치: ${items.length} != ${itemsPerRound}`
      );
    }

    const { data: created, error: insErr } = await db
      .from("quiz_session")
      .insert({ participant_id: pid, round_no: no, total_items: items.length })
      .select(
        "id, participant_id, round_no, status, current_index, total_items, score, last_activity_at"
      )
      .single();

    if (insErr) {
      // 동시 생성 경합 (J2): UNIQUE 위반이면 기존 세션으로 재개
      if (insErr.code === "23505") {
        const raced = await loadSession(pid, no);
        if (raced?.status === "in_progress") {
          return sessionPayload(raced, round.theme);
        }
        return apiError(409, "ALREADY_COMPLETED", MSG.alreadyCompleted, {
          status: raced?.status,
        });
      }
      throw new Error(insErr.message);
    }
    const session = created as Session;

    // 문항 순서 + 선택지 순서(MC4·ORDER만) 셔플을 이 시점 1회만 수행해 저장 (규칙 4, C3·C4)
    const itemOrder = shuffledIndices(items.length, randomSeed());
    const rows = itemOrder.map((itemIdx, seq) => {
      const item = items[itemIdx];
      const needsChoiceOrder =
        item.item_type === "MC4" || item.item_type === "ORDER";
      const choiceCount = Array.isArray(item.choices)
        ? item.choices.length
        : 0;
      return {
        session_id: session.id,
        item_id: item.id,
        seq,
        choice_order: needsChoiceOrder
          ? shuffledIndices(choiceCount, randomSeed())
          : null,
      };
    });

    const { error: rowsErr } = await db.from("quiz_session_item").insert(rows);
    if (rowsErr) {
      // 12행 생성 실패 시 세션을 남기지 않는다 (재시도 가능하도록 보상 삭제)
      await db.from("quiz_session").delete().eq("id", session.id);
      throw new Error(rowsErr.message);
    }

    return sessionPayload(session, round.theme);
  } catch (err) {
    console.error("[rounds/session]", err instanceof Error ? err.message : err);
    return apiError(500, "INTERNAL");
  }
}
