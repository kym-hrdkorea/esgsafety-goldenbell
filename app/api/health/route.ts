import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data, error } = await getDb()
      .from("app_config")
      .select("key, value")
      .limit(1)
      .single();
    if (error) {
      throw new Error(error.message);
    }
    return NextResponse.json({ ok: true, config: data });
  } catch (err) {
    console.error("[health]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      {
        code: "HEALTH_CHECK_FAILED",
        message: "문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      },
      { status: 500 }
    );
  }
}
