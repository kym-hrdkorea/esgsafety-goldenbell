import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getParticipantId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const pid = getParticipantId(req);
  if (!pid) {
    return NextResponse.json({ code: "UNAUTHENTICATED" }, { status: 401 });
  }

  try {
    const db = getDb();
    const { data: p, error } = await db
      .from("participant")
      .select(
        "nickname, department:department_id(name), org_unit:org_unit_id(name)"
      )
      .eq("id", pid)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!p) {
      return NextResponse.json({ code: "UNAUTHENTICATED" }, { status: 401 });
    }

    const { data: sessions, error: sErr } = await db
      .from("quiz_session")
      .select("score")
      .eq("participant_id", pid)
      .in("status", ["completed", "expired"]);
    if (sErr) throw new Error(sErr.message);

    const dept = p.department as unknown as { name: string };
    const unit = p.org_unit as unknown as { name: string };
    return NextResponse.json({
      nickname: p.nickname,
      orgUnitName: unit.name,
      departmentName: dept.name,
      totalScore: sessions.reduce((sum, s) => sum + s.score, 0),
      roundsTaken: sessions.length,
    });
  } catch (err) {
    console.error("[me]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      {
        code: "INTERNAL",
        message: "문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      },
      { status: 500 }
    );
  }
}
