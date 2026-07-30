import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getParticipantId } from "@/lib/session";
import { apiError, parseRoundNo, roundState, MSG } from "@/lib/quiz";

export const dynamic = "force-dynamic";

// 사전학습 자료. 개방·종료 회차 열람 가능, 미개방 차단 (business-rules 2·6절, H3).
// 진입 시 열람 로그를 upsert한다 — 캠페인 성과 근거이므로 기록 실패 시 응답도 실패시켜
// 누락을 막는다(재시도 유도). 재진입은 중복 없이 무시된다 (H1·H2).
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ no: string }> }
) {
  const pid = getParticipantId(req);
  if (!pid) return apiError(401, "UNAUTHENTICATED");

  const { no: noParam } = await ctx.params;
  const no = parseRoundNo(noParam);
  if (no === null) return apiError(404, "NOT_FOUND");

  try {
    const db = getDb();
    const { data: round, error } = await db
      .from("quiz_round")
      .select(
        "round_no, theme, opens_at, closes_at, is_published, prelearning_title, prelearning_body"
      )
      .eq("round_no", no)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!round) return apiError(404, "NOT_FOUND");

    const state = roundState(round);
    if (state === "locked") {
      return apiError(403, "ROUND_NOT_OPEN", MSG.notOpen);
    }

    const { error: logErr } = await db
      .from("prelearning_view")
      .upsert(
        { participant_id: pid, round_no: no },
        { onConflict: "participant_id,round_no", ignoreDuplicates: true }
      );
    if (logErr) throw new Error(logErr.message);

    return NextResponse.json({
      roundNo: round.round_no,
      title: round.prelearning_title,
      body: round.prelearning_body,
      state, // open이면 화면 하단에 [이제 문제 풀기]를 노출한다
    });
  } catch (err) {
    console.error(
      "[rounds/prelearning]",
      err instanceof Error ? err.message : err
    );
    return apiError(500, "INTERNAL");
  }
}
