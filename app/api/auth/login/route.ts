import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getConfigValue } from "@/lib/config";
import { issueSession } from "@/lib/session";
import { registerFailedAttempt, clearFailedAttempts } from "@/lib/login-lock";

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
      const [maxAttempts, lockMinutes] = await Promise.all([
        getConfigValue("login_max_attempts"),
        getConfigValue("login_lock_minutes"),
      ]);
      // 카운터 증가는 낙관적 동시성으로 원자화한다 — 동시 요청이 같은 값을 읽고
      // 같은 값을 쓰면 잠금 자체가 무력화된다 (lib/login-lock.ts)
      const outcome = await registerFailedAttempt(
        "participant",
        p,
        maxAttempts,
        lockMinutes
      );
      // 5번째 실패 응답에서 이미 423 (addendum I항)
      return outcome.kind === "locked" ? locked(outcome.lockedUntil) : INVALID();
    }

    // 성공: 카운터 초기화 (A8).
    // 그 사이 다른 요청의 실패가 잠금을 걸었으면 올바른 PIN이어도 423 유지 (A7)
    const cleared = await clearFailedAttempts("participant", p);
    if (!cleared.ok) return locked(cleared.lockedUntil);

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
