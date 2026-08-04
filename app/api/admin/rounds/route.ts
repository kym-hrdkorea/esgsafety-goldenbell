import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminId } from "@/lib/session";
import { apiError, roundState, type Round } from "@/lib/quiz";

export const dynamic = "force-dynamic";

// 회차 개방 상태 조회 (읽기 전용).
// 개방은 일정(opens_at/closes_at)이 단독으로 결정하고 is_published 는 긴급 중단 스위치로만
// 쓴다. 그래도 "열려야 할 회차가 열렸는지"를 눈으로 확인할 곳이 없으면 실패가 조용히
// 지나간다 — 참가자 홈에는 '아직 열리지 않았습니다'만 뜨고 로그도 남지 않는다.
// 이 라우트가 그 관측 지점이다. 상태를 바꾸는 기능은 두지 않는다(관리자 API는 읽기 전용).
export async function GET(req: NextRequest) {
  if (!getAdminId(req)) return apiError(401, "UNAUTHENTICATED");

  try {
    const { data, error } = await getDb()
      .from("quiz_round")
      .select(
        "round_no, season, theme, opens_at, closes_at, is_published, prelearning_body"
      )
      .order("round_no");
    if (error) throw new Error(error.message);

    return NextResponse.json(
      (data ?? []).map((r) => ({
        roundNo: r.round_no,
        season: r.season,
        theme: r.theme,
        opensAt: r.opens_at,
        closesAt: r.closes_at,
        isPublished: r.is_published,
        // 판정은 항상 서버 시각으로 한다 (business-rules 2절). 클라이언트가 다시 계산하지 않는다.
        state: roundState(r as Round),
        // 본문은 보내지 않는다 — 존재 여부만으로 충분하고 페이로드가 커진다
        hasBody: r.prelearning_body != null,
      }))
    );
  } catch (err) {
    console.error("[admin/rounds]", err instanceof Error ? err.message : err);
    return apiError(500, "INTERNAL");
  }
}
