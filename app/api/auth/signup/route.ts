import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { issueSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  empNo: z.string().trim().regex(/^\d+$/),
  nickname: z.string().trim().min(2).max(12),
  departmentId: z.number().int().positive(),
  // 휴대폰 번호: 하이픈·공백 허용 입력 → 숫자만 정규화 저장 (P항).
  // 비밀번호는 서버가 끝 4자리로 자동 설정한다.
  phone: z
    .string()
    .transform((v) => v.replace(/\D/g, ""))
    .pipe(z.string().regex(/^01[016789]\d{7,8}$/)),
});

function validationResponse(field: string, message: string) {
  return NextResponse.json(
    { code: "VALIDATION", field, message },
    { status: 400 }
  );
}

function validationMessage(field: string): string {
  switch (field) {
    case "empNo":
      return "사번을 확인해 주세요.";
    case "nickname":
      return "닉네임을 2~12자로 입력해 주세요.";
    case "departmentId":
      return "소속과 부서를 선택해 주세요.";
    case "phone":
      return "올바른 휴대폰 번호를 입력해 주세요.";
    default:
      return "입력값을 확인해 주세요.";
  }
}

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      const field = String(parsed.error.issues[0]?.path[0] ?? "form");
      return validationResponse(field, validationMessage(field));
    }
    body = parsed.data;
  } catch {
    return validationResponse("form", "입력값을 확인해 주세요.");
  }

  try {
    const db = getDb();

    // 소속은 부서에서 서버가 결정한다. 클라이언트의 소속 값은 받지 않는다.
    const { data: dept, error: deptErr } = await db
      .from("department")
      .select("id, org_unit_id")
      .eq("id", body.departmentId)
      .maybeSingle();
    if (deptErr) throw new Error(deptErr.message);
    if (!dept) {
      return validationResponse("departmentId", "소속과 부서를 선택해 주세요.");
    }

    // 비밀번호 = 휴대폰 끝 4자리 (P항). phone은 정규화된 숫자만 저장한다.
    const passwordHash = await bcrypt.hash(body.phone.slice(-4), 10);
    const { data: created, error: insErr } = await db
      .from("participant")
      .insert({
        emp_no: body.empNo,
        nickname: body.nickname,
        password_hash: passwordHash,
        phone: body.phone,
        department_id: dept.id,
        org_unit_id: dept.org_unit_id,
      })
      .select("id, nickname")
      .single();

    if (insErr) {
      // UNIQUE 위반 시 실제 충돌한 필드를 구분해 표시한다.
      if (insErr.code === "23505") {
        if (insErr.message.includes("emp_no")) {
          return NextResponse.json(
            {
              code: "EMP_NO_TAKEN",
              message: "이미 가입된 사번입니다. 로그인해 주세요.",
            },
            { status: 409 }
          );
        }
        return NextResponse.json(
          { code: "NICKNAME_TAKEN", message: "이미 사용 중인 닉네임입니다." },
          { status: 409 }
        );
      }
      throw new Error(insErr.message);
    }

    const res = NextResponse.json(
      { participantId: created.id, nickname: created.nickname },
      { status: 201 }
    );
    issueSession(res, created.id);
    return res;
  } catch (err) {
    console.error("[auth/signup]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      {
        code: "INTERNAL",
        message: "문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      },
      { status: 500 }
    );
  }
}
