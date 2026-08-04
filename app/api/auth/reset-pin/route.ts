import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { allowResetRequest, clientIp, padTo } from "@/lib/reset-throttle";

export const dynamic = "force-dynamic";

// 비밀번호 자율 재설정 (addendum O항).
//
// lib/login-lock.ts를 import하지 않는다. 재사용이 자연스러워 보이지만 버그를 들여온다:
//  - clearFailedAttempts()가 last_login_at을 무조건 써서, 스키마에서 "마지막 인증
//    시각"을 담는 유일한 컬럼을 오염시킨다. 재설정은 로그인이 아니다.
//  - 그 함수는 CAS 충돌 시 잠금 중이면 해제를 거부한다. 로그인에는 맞지만
//    ("잠금 중엔 올바른 PIN이어도 423") 재설정에는 정반대다 — 비밀번호는 바뀌었는데
//    잠금이 안 풀려 여전히 로그인이 안 된다.
//  - registerFailedAttempt()는 잠금 상태에서 호출되면 잠금을 15분 더 연장한다.
//    로그인은 423을 먼저 리턴해 이 경로에 닿지 않지만, 재설정이 첫 호출자가 되면
//    공격자가 15분에 요청 1건으로 피해자를 계속 잠가둘 수 있다.
//
// 따라서 실패 시 failed_attempts를 건드리지 않는다. 계정 단위 카운터를 포기해도
// 손실이 적은 이유: 공격자의 추측은 매번 다른 participant 행을 향하므로 계정별
// 카운터로는 애초에 막히지 않는다. 정량적 제동은 lib/reset-throttle.ts가 맡는다.

const BodySchema = z.object({
  empNo: z.string().regex(/^\d+$/).max(20),
  nickname: z.string().min(2).max(12),
  departmentId: z.number().int().positive(),
  newPin: z.string().regex(/^\d{4}$/),
});

const GENERIC = "문제가 발생했습니다. 잠시 후 다시 시도해 주세요.";

// DB 읽기에 의존하는 실패는 이것 하나뿐이다. 사번 부재·닉네임 불일치·부서 불일치를
// 구분하지 않는다 — 구분하면 사번 존재 여부와 닉네임→사번 대응을 캐는 열거 오라클이 된다.
// 423과 lockedUntil은 절대 반환하지 않는다. 잠금은 존재하는 행만 갖는 속성이라
// 잠금 파생 필드는 전부 존재 여부 오라클이다.
const VERIFY_FAILED = () =>
  NextResponse.json(
    {
      code: "VERIFICATION_FAILED",
      message:
        "입력한 정보가 일치하지 않습니다. 사번·닉네임·부서를 다시 확인해 주세요.",
    },
    { status: 401 }
  );

export async function POST(req: NextRequest) {
  const startedAt = Date.now();

  // 요청 제한 — DB 접근 전이라 존재 여부가 새지 않는다.
  if (!allowResetRequest(clientIp(req))) {
    await padTo(startedAt);
    return NextResponse.json(
      {
        code: "TOO_MANY_REQUESTS",
        message: "요청이 많습니다. 잠시 후 다시 시도해 주세요.",
      },
      { status: 429 }
    );
  }

  // 파싱 + zod — DB 접근 전. 어느 필드가 틀렸는지 구분하지 않는다.
  // 필드별 문안은 클라이언트 폼에서만 쓴다.
  let body: z.infer<typeof BodySchema>;
  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      await padTo(startedAt);
      return NextResponse.json(
        { code: "VALIDATION", message: GENERIC },
        { status: 400 }
      );
    }
    body = parsed.data;
  } catch {
    await padTo(startedAt);
    return NextResponse.json(
      { code: "VALIDATION", message: GENERIC },
      { status: 400 }
    );
  }

  try {
    // 해시를 SELECT보다 먼저 계산한다 — 실패 경로도 같은 비용을 치르게 해서
    // "사번이 있다/없다"가 응답 시간으로 새지 않게 한다. 성공 경로에서는 어차피
    // 필요한 값이라 추가 비용이 없다.
    const newHash = await bcrypt.hash(body.newPin, 10);

    // 세 조건을 한 쿼리에 넣는 것이 이 설계의 핵심이다. 사번으로 먼저 조회한 뒤
    // 코드에서 비교하면 핸들러가 "이 사번은 있는데 나머지가 틀렸다"는 사실을 손에
    // 쥐게 되고, 그 순간 열거 차단이 "조심해서 지켜야 하는 규칙"으로 바뀐다.
    // 한 쿼리로 합치면 그 사실이 애초에 생기지 않아 구조적으로 불가능해진다.
    //
    // 닉네임은 trim·소문자화하지 않는다. 가입(app/api/auth/signup/route.ts)이
    // trim하지 않으므로 앞뒤 공백이 붙은 닉네임이 이미 저장될 수 있고, 여기서
    // trim하면 그 사용자는 영구히 재설정할 수 없다. UNIQUE 인덱스가 대소문자를
    // 구분하므로(Kim/kim 공존 가능) 대소문자 무시 비교도 매칭 범위를 넓혀 위험하다.
    const db = getDb();
    const { data: p, error } = await db
      .from("participant")
      .select("id")
      .eq("emp_no", body.empNo)
      .eq("nickname", body.nickname)
      .eq("department_id", body.departmentId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    if (!p) {
      // 식별자를 남기지 않는다(규칙 10). 재설정 실패가 카운터를 올리지 않으므로
      // 이 줄의 발생량이 유일한 공격 탐지 신호다.
      console.warn("[auth/reset-pin] verify_fail");
      await padTo(startedAt);
      return VERIFY_FAILED();
    }

    // 잠금 컬럼을 같은 UPDATE에서 함께 지운다. 이게 없으면 사용자는 비밀번호를
    // 바꾸고도 최대 15분간 로그인할 수 없어 기능이 고장난 것으로 읽힌다.
    // 절대값 쓰기(read-modify-write가 아님)라 CAS가 필요 없다.
    const { error: updErr } = await db
      .from("participant")
      .update({
        password_hash: newHash,
        failed_attempts: 0,
        locked_until: null,
      })
      .eq("id", p.id);
    if (updErr) throw new Error(updErr.message);

    // 참가자 UUID만 남긴다 — 사번은 금지(규칙 10). 감사 테이블이 없으므로
    // 이 한 줄이 사후 조사에 쓸 수 있는 유일한 흔적이다.
    console.warn("[auth/reset-pin] ok", { pid: p.id });
    await padTo(startedAt);

    // 세션을 발급하지 않는다. hq_session은 서버 저장소가 없어 취소 불가능한
    // 12시간 베어러 자격증명이므로 로그인보다 약한 증명으로 만들지 않는다.
    // 성공 응답에 닉네임·부서명을 담지 않는다 — 클라이언트가 보낸 값이고,
    // 되돌려주면 그 자체가 확인 오라클이 된다.
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[auth/reset-pin]", err instanceof Error ? err.message : err);
    await padTo(startedAt);
    return NextResponse.json(
      { code: "INTERNAL", message: GENERIC },
      { status: 500 }
    );
  }
}
