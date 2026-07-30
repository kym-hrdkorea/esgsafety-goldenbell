import { NextResponse } from "next/server";
import { clearSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = new NextResponse(null, { status: 204 });
  clearSession(res);
  return res;
}
