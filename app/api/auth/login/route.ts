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

// 401 응답 시간 하한 (addendum O항). 더미 해시 대조만으로는 부족하다 —
// 오답 경로는 bcrypt 대조 뒤에 카운터 CAS UPDATE(DB 왕복 1회)를 더 하므로
// 미가입(중앙값 ≈335ms)과 가입+오답(≈466ms)이 여전히 갈렸다(실측 131ms 차).
// 401 경로에만 하한을 걸어 두 경로를 수렴시킨다. 성공·423은 건드리지 않으므로
// 정상 로그인 지연은 그대로다. 부수 효과로 무차별 시도 속도도 낮아진다.
const FAIL_FLOOR_MS = 700;

const INVALID = async (startedAt: number) => {
  const wait = FAIL_FLOOR_MS - (Date.now() - startedAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  return NextResponse.json(
    {
      code: "INVALID_CREDENTIALS",
      message: "사번 또는 비밀번호가 올바르지 않습니다.",
    },
    { status: 401 }
  );
};

// 미가입 사번의 응답 시간을 가입 사번과 맞추기 위한 더미 해시 (addendum O항).
// 반드시 유효한 cost-10 bcrypt 해시여야 한다 — 형식이 깨진 문자열을 넘기면
// bcrypt.compare가 연산 없이 즉시 false를 반환해(0ms) 패딩 효과가 사라진다.
// 값은 bcrypt.hash("0000", 10)의 산출물이며 어떤 계정과도 연결되지 않는다.
const DUMMY_HASH =
  "$2b$10$ZbAi/VtINXZLQv57cw1az.7vXA/Bzcenz3N4Ew224TQYLrHYXnMYO";

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
  const startedAt = Date.now();

  let body: z.infer<typeof BodySchema>;
  try {
    const parsed = BodySchema.safeParse(await req.json());
    // 형식 불량은 자격 증명 오류와 동일하게 응답한다(사번 존재 여부 힌트 차단)
    if (!parsed.success) return INVALID(startedAt);
    body = parsed.data;
  } catch {
    return INVALID(startedAt);
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
    if (!p) {
      // 미가입 사번도 가입 사번과 같은 시간을 쓰게 한다. 이 대조가 없으면
      // 빠른 401 = "미가입 사번", 느린 401 = "가입됨, PIN 오류"로 갈려
      // 로그인 자체가 사번 존재 여부 오라클이 된다.
      await bcrypt.compare(body.pin, DUMMY_HASH);
      return INVALID(startedAt);
    }

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
      return outcome.kind === "locked"
        ? locked(outcome.lockedUntil)
        : INVALID(startedAt);
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
