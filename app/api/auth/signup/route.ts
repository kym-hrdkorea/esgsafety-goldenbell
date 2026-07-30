import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { issueSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  empNo: z.string().regex(/^\d+$/),
  nickname: z.string().min(2).max(12),
  departmentId: z.number().int().positive(),
  pin: z.string().regex(/^\d{4}$/),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION", message: "숫자 4자리를 입력해 주세요." },
        { status: 400 }
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json(
      {
        code: "VALIDATION",
        message: "문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      },
      { status: 400 }
    );
  }

  try {
    const db = getDb();

    // org_unit_id는 부서로부터 서버가 결정한다. 클라이언트 값은 받지도 않는다. (A9)
    const { data: dept, error: deptErr } = await db
      .from("department")
      .select("id, org_unit_id")
      .eq("id", body.departmentId)
      .maybeSingle();
    if (deptErr) throw new Error(deptErr.message);
    if (!dept) {
      return NextResponse.json(
        {
          code: "VALIDATION",
          message: "문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
        },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(body.pin, 10);

    const { data: created, error: insErr } = await db
      .from("participant")
      .insert({
        emp_no: body.empNo,
        nickname: body.nickname,
        password_hash: passwordHash,
        department_id: dept.id,
        org_unit_id: dept.org_unit_id,
      })
      .select("id, nickname")
      .single();

    if (insErr) {
      // UNIQUE 위반 → 어느 컬럼인지 구분해 응답 (A2·A3)
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
          {
            code: "NICKNAME_TAKEN",
            message: "이미 사용 중인 닉네임입니다.",
          },
          { status: 409 }
        );
      }
      throw new Error(insErr.message);
    }

    // 가입 즉시 로그인 상태 (A1)
    const res = NextResponse.json(
      { participantId: created.id, nickname: created.nickname },
      { status: 201 }
    );
    issueSession(res, created.id);
    return res;
  } catch (err) {
    // 로그에 사번·PIN을 남기지 않는다 (규칙 10)
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
