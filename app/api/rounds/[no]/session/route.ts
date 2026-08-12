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
  sessionFromRpc,
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

    // 기존 세션 조회를 회차 상태보다 먼저 한다. 금요일 마감 직전에
    // 시작한 세션은 마감 후에도 이어서 진행할 수 있어야 한다.
    let existing = await loadSession(pid, no);
    if (existing) {
      existing = await expireIfIdle(existing);
      if (existing.status === "in_progress") {
        return sessionPayload(existing, round.theme);
      }
      return apiError(409, "ALREADY_COMPLETED", MSG.alreadyCompleted, {
        status: existing.status,
      });
    }

    // 신규 생성만 개방 상태를 요구한다.
    const state = roundState(round);
    if (state !== "open") {
      return apiError(
        403,
        "ROUND_NOT_OPEN",
        state === "locked" ? MSG.notOpen : MSG.closed
      );
    }

    const db = getDb();

    // measure_code/anchor_code/level은 조회 자체를 하지 않는다 (규칙 2-1).
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

    // 문항 순서와 선택지 순서를 먼저 확정한다. 두 값은 RPC의 JSONB로
    // 함께 전달되어 세션 1행·문항 12행과 같은 트랜잭션에서 저장된다.
    const itemOrder = shuffledIndices(items.length, randomSeed());
    const rows = itemOrder.map((itemIdx, seq) => {
      const item = items[itemIdx];
      const needsChoiceOrder =
        item.item_type === "MC4" || item.item_type === "ORDER";
      const choiceCount = Array.isArray(item.choices)
        ? item.choices.length
        : 0;
      return {
        item_id: item.id,
        seq,
        choice_order: needsChoiceOrder
          ? shuffledIndices(choiceCount, randomSeed())
          : null,
      };
    });

    const { data: created, error: createErr } = await db.rpc(
      "fn_create_quiz_session",
      {
        p_participant_id: pid,
        p_round_no: no,
        p_items: rows,
      }
    );

    if (createErr) {
      // 동시 생성 경합: UNIQUE 위반으로 함수 호출이 대기 후 실패하면
      // 이미 커밋된 기존 세션을 다시 읽어 재개한다.
      if (createErr.code === "23505") {
        const raced = await loadSession(pid, no);
        if (raced) {
          const current = await expireIfIdle(raced);
          if (current.status === "in_progress") {
            return sessionPayload(current, round.theme);
          }
          return apiError(409, "ALREADY_COMPLETED", MSG.alreadyCompleted, {
            status: current.status,
          });
        }
        throw new Error("동시 세션 생성 경합 후 기존 세션을 찾지 못했습니다");
      }
      throw new Error(createErr.message);
    }

    return sessionPayload(sessionFromRpc(created), round.theme);
  } catch (err) {
    console.error("[rounds/session]", err instanceof Error ? err.message : err);
    return apiError(500, "INTERNAL");
  }
}
