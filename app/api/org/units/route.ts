import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data, error } = await getDb()
      .from("org_unit")
      .select("id, name, sort_order, org_category:category_code(code, name)")
      .order("sort_order");
    if (error) throw new Error(error.message);

    const units = data.map((u) => {
      const cat = u.org_category as unknown as { code: string; name: string };
      return {
        id: u.id,
        name: u.name,
        categoryCode: cat.code,
        categoryName: cat.name,
      };
    });
    return NextResponse.json(units);
  } catch (err) {
    console.error("[org/units]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      {
        code: "INTERNAL",
        message: "문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      },
      { status: 500 }
    );
  }
}
