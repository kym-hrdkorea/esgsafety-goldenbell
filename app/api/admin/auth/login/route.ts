import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getConfigValue } from "@/lib/config";
import { issueAdminSession } from "@/lib/session";
import { registerFailedAttempt, clearFailedAttempts } from "@/lib/login-lock";

export const dynamic = "force-dynamic";

// 관리자 로그인 (addendum G항). 잠금 로직은 참가자 로그인과 동일 패턴이되
// 임계값은 완화한다: admin_max_attempts(10회) / admin_lock_minutes(10분) — G-1항.
// 유일한 운영자가 잠기는 것 자체가 운영 위험이므로 참가자(5회/15분)보다 느슨하다.

const BodySchema = z.object({
  loginId: z.string().min(1),
  password: z.string().min(1),
});

const INVALID = () =>
  NextResponse.json(
    {
      code: "INVALID_CREDENTIALS",
      message: "아이디 또는 비밀번호가 올바르지 않습니다.",
    },
    { status: 401 }
  );

function locked(lockedUntil: string, maxAttempts: number) {
  const remainMin = Math.max(
    1,
    Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 60_000)
  );
  return NextResponse.json(
    {
      code: "LOCKED",
      lockedUntil,
      message: `비밀번호를 ${maxAttempts}회 틀렸습니다. ${remainMin}분 후 다시 시도해 주세요.`,
    },
    { status: 423 }
  );
}

// 최초 계정 시딩 (G항): admin_user가 비어 있고 ADMIN_LOGIN_ID/ADMIN_INIT_PASSWORD가
// 설정된 경우에만 1회 생성한다. 시딩 후 환경변수를 삭제하면 이 경로는 다시 실행되지 않는다.
async function seedIfEmpty(): Promise<void> {
  const loginId = process.env.ADMIN_LOGIN_ID;
  const initPassword = process.env.ADMIN_INIT_PASSWORD;
  if (!loginId || !initPassword) return;
  if (initPassword.length < 12) {
    throw new Error("ADMIN_INIT_PASSWORD는 12자 이상이어야 합니다.");
  }

  const db = getDb();
  const { count, error } = await db
    .from("admin_user")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  if ((count ?? 0) > 0) return;

  const { error: insErr } = await db.from("admin_user").insert({
    login_id: loginId,
    password_hash: await bcrypt.hash(initPassword, 10),
  });
  // 동시 시딩 경합의 유니크 위반은 무해하게 무시
  if (insErr && insErr.code !== "23505") throw new Error(insErr.message);
}

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return INVALID();
    body = parsed.data;
  } catch {
    return INVALID();
  }

  try {
    await seedIfEmpty();

    const db = getDb();
    const { data: a, error } = await db
      .from("admin_user")
      .select("id, login_id, password_hash, failed_attempts, locked_until")
      .eq("login_id", body.loginId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!a) return INVALID();

    const now = Date.now();
    const maxAttempts = await getConfigValue("admin_max_attempts");
    const lockMinutes = await getConfigValue("admin_lock_minutes");

    if (a.locked_until && new Date(a.locked_until).getTime() > now) {
      return locked(a.locked_until, maxAttempts);
    }

    const ok = await bcrypt.compare(body.password, a.password_hash);

    if (!ok) {
      // 참가자 로그인과 동일한 낙관적 동시성 (lib/login-lock.ts)
      const outcome = await registerFailedAttempt(
        "admin_user",
        a,
        maxAttempts,
        lockMinutes
      );
      return outcome.kind === "locked"
        ? locked(outcome.lockedUntil, maxAttempts)
        : INVALID();
    }

    const cleared = await clearFailedAttempts("admin_user", a);
    if (!cleared.ok) return locked(cleared.lockedUntil, maxAttempts);

    const res = NextResponse.json({ loginId: a.login_id });
    issueAdminSession(res, a.id);
    return res;
  } catch (err) {
    console.error("[admin/login]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      {
        code: "INTERNAL",
        message: "문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      },
      { status: 500 }
    );
  }
}
