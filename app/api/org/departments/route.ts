import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const unitId = Number(req.nextUrl.searchParams.get("unitId"));
  if (!Number.isInteger(unitId) || unitId <= 0) {
    return NextResponse.json(
      {
        code: "VALIDATION",
        message: "문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      },
      { status: 400 }
    );
  }

  try {
    const { data, error } = await getDb()
      .from("department")
      .select("id, name")
      .eq("org_unit_id", unitId)
      .order("sort_order");
    if (error) throw new Error(error.message);
    return NextResponse.json(data);
  } catch (err) {
    console.error(
      "[org/departments]",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      {
        code: "INTERNAL",
        message: "문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      },
      { status: 500 }
    );
  }
}
