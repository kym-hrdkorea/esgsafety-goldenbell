import { NextResponse } from "next/server";
import { clearAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = new NextResponse(null, { status: 204 });
  clearAdminSession(res);
  return res;
}
