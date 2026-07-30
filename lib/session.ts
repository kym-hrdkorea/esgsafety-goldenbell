import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

// 참가자 세션: HMAC 서명 쿠키 (DB 세션 테이블 없음 — 스키마에 로그인 세션 저장소가 없다).
// 쿠키 정책은 addendum G-2항: 이름 hq_session, path=/, httpOnly, sameSite=lax, secure, 12시간.
// 관리자 세션(hq_admin, T11)과 이름으로만 분리하며 서로의 쿠키를 절대 참조하지 않는다.

const COOKIE_NAME = "hq_session";
const SESSION_HOURS = 12;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET 환경변수가 설정되지 않았습니다.");
  return s;
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

type SessionPayload = { pid: string; exp: number };

export function issueSession(res: NextResponse, participantId: string): void {
  const payload: SessionPayload = {
    pid: participantId,
    exp: Date.now() + SESSION_HOURS * 3600_000,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  res.cookies.set(COOKIE_NAME, `${data}.${sign(data)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export function getParticipantId(req: NextRequest): string | null {
  const raw = req.cookies.get(COOKIE_NAME)?.value;
  if (!raw) return null;

  const dot = raw.lastIndexOf(".");
  if (dot < 0) return null;
  const data = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);

  const expected = sign(data);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(data, "base64url").toString()
    ) as SessionPayload;
    if (typeof payload.pid !== "string" || typeof payload.exp !== "number")
      return null;
    if (payload.exp < Date.now()) return null;
    return payload.pid;
  } catch {
    return null;
  }
}

export function clearSession(res: NextResponse): void {
  res.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
