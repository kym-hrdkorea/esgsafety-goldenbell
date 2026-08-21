import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

// 참가자 세션: HMAC 서명 쿠키 (DB 세션 테이블 없음 — 스키마에 로그인 세션 저장소가 없다).
// 쿠키 정책은 addendum G-2항: 이름 hq_session, path=/, httpOnly, sameSite=lax, secure, 12시간.
// 관리자 세션(hq_admin, T11)과 이름으로만 분리하며 서로의 쿠키를 절대 참조하지 않는다.

const COOKIE_NAME = "hq_session";
const SESSION_HOURS = 12;

// Secure 플래그: 운영(HTTPS)에서는 항상 켠다. 예외는 단 하나 —
// 사내 LAN에서 휴대폰으로 http://<PC IP>:3000 접속 테스트를 할 때다.
// 브라우저는 localhost가 아닌 평문 HTTP 출처에서 Secure 쿠키 저장을 거부하므로
// (로그인 200 후에도 세션이 안 남아 로그인 화면으로 되돌아온다),
// 그 경우에만 ALLOW_HTTP_COOKIE=1을 로컬 실행 환경변수로 지정해 끈다.
// 이 변수는 Vercel에 절대 등록하지 않는다 — README 사내망 절 참고.
const COOKIE_SECURE =
  process.env.NODE_ENV === "production" &&
  process.env.ALLOW_HTTP_COOKIE !== "1";

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
    secure: COOKIE_SECURE,
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
    secure: COOKIE_SECURE,
    path: "/",
    maxAge: 0,
  });
}

// ---------------------------------------------------------------------
// 관리자 세션 (addendum G-2항): 쿠키 이름만 hq_admin으로 분리, path=/.
// 참가자 엔드포인트는 hq_admin을, 관리자 엔드포인트는 hq_session을 절대 참조하지 않는다.
// payload 필드(aid vs pid)가 달라 쿠키 값을 서로 옮겨 붙여도 검증에 실패한다.
// ---------------------------------------------------------------------

const ADMIN_COOKIE_NAME = "hq_admin";

type AdminPayload = { aid: string; exp: number };

export function issueAdminSession(res: NextResponse, adminId: string): void {
  const payload: AdminPayload = {
    aid: adminId,
    exp: Date.now() + SESSION_HOURS * 3600_000,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  res.cookies.set(ADMIN_COOKIE_NAME, `${data}.${sign(data)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: COOKIE_SECURE,
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export function getAdminId(req: NextRequest): string | null {
  const raw = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
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
    ) as AdminPayload;
    if (typeof payload.aid !== "string" || typeof payload.exp !== "number")
      return null;
    if (payload.exp < Date.now()) return null;
    return payload.aid;
  } catch {
    return null;
  }
}

export function clearAdminSession(res: NextResponse): void {
  res.cookies.set(ADMIN_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: COOKIE_SECURE,
    path: "/",
    maxAge: 0,
  });
}
