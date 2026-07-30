import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getConfigValue } from "@/lib/config";
import { issueSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  empNo: z.string().regex(/^\d+$/),
  pin: z.string().regex(/^\d{4}$/),
});

const INVALID = () =>
  NextResponse.json(
    {
      code: "INVALID_CREDENTIALS",
      message: "사번 또는 비밀번호가 올바르지 않습니다.",
    },
    { status: 401 }
  );

function locked(lockedUntil: string) {
  const remainMin = Math.max(
    1,
    Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 60_000)
  );
  return NextResponse.json(
    {
      code: "LOCKED",
      lockedUntil,
      message: `비밀번호를 5회 틀렸습니다. ${remainMin}분 후 다시 시도해 주세요.`,
    },
    { status: 423 }
  );
}

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    const parsed = BodySchema.safeParse(await req.json());
    // 형식 불량은 자격 증명 오류와 동일하게 응답한다(사번 존재 여부 힌트 차단)
    if (!parsed.success) return INVALID();
    body = parsed.data;
  } catch {
    return INVALID();
  }

  try {
    const db = getDb();
    const { data: p, error } = await db
      .from("participant")
      .select(
        "id, nickname, password_hash, failed_attempts, locked_until, department:department_id(name), org_unit:org_unit_id(name)"
      )
      .eq("emp_no", body.empNo)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!p) return INVALID();

    const now = Date.now();

    // 잠금 중이면 올바른 PIN이라도 423 유지 (A7)
    if (p.locked_until && new Date(p.locked_until).getTime() > now) {
      return locked(p.locked_until);
    }

    const ok = await bcrypt.compare(body.pin, p.password_hash);

    if (!ok) {
      const maxAttempts = await getConfigValue("login_max_attempts");
      const lockMinutes = await getConfigValue("login_lock_minutes");

      // 만료된 잠금이 남아 있으면 연속 실패 카운트를 새로 시작한다
      const priorFails =
        p.locked_until && new Date(p.locked_until).getTime() <= now
          ? 0
          : p.failed_attempts;
      const fails = priorFails + 1;

      if (fails >= maxAttempts) {
        // 5번째 실패 응답에서 이미 423 (addendum I항)
        const until = new Date(now + lockMinutes * 60_000).toISOString();
        const { error: updErr } = await db
          .from("participant")
          .update({ failed_attempts: fails, locked_until: until })
          .eq("id", p.id);
        if (updErr) throw new Error(updErr.message);
        return locked(until);
      }

      const { error: updErr } = await db
        .from("participant")
        .update({ failed_attempts: fails, locked_until: null })
        .eq("id", p.id);
      if (updErr) throw new Error(updErr.message);
      return INVALID();
    }

    // 성공: 카운터 초기화 (A8)
    const { error: updErr } = await db
      .from("participant")
      .update({
        failed_attempts: 0,
        locked_until: null,
        last_login_at: new Date(now).toISOString(),
      })
      .eq("id", p.id);
    if (updErr) throw new Error(updErr.message);

    const dept = p.department as unknown as { name: string };
    const unit = p.org_unit as unknown as { name: string };
    const res = NextResponse.json({
      nickname: p.nickname,
      orgUnitName: unit.name,
      departmentName: dept.name,
    });
    issueSession(res, p.id);
    return res;
  } catch (err) {
    // 로그에 사번·PIN을 남기지 않는다 (규칙 10)
    console.error("[auth/login]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      {
        code: "INTERNAL",
        message: "문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      },
      { status: 500 }
    );
  }
}
