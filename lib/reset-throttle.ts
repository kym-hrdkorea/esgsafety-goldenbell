import type { NextRequest } from "next/server";

// 자율 재설정(POST /api/auth/reset-pin) 요청 제한 + 응답 시간 하한.
//
// 이 엔드포인트는 계정 단위 카운터(participant.failed_attempts)를 쓰지 않는다.
// 공격자의 추측은 매번 다른 participant 행을 향하므로 계정별 카운터로는 애초에
// 막히지 않고, lib/login-lock.ts를 재사용하면 잠금 15분 연장·last_login_at 오염
// 버그가 함께 따라온다(addendum O항). 그래서 이 모듈이 유일한 정량적 제동장치다.
//
// 한도를 app_config가 아니라 env로 받는 이유: lib/config.ts가 등록된 모든 키의
// 존재를 검증하고 없으면 throw하므로, DB 시드 없이 키를 추가하면 설정 로딩 전체가
// 깨진다. 또한 이건 캠페인 운영 파라미터가 아니라 보안 파라미터다(규칙 7의 예외).

const WINDOW_MS = 60 * 60 * 1000;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

// IP당 20/시간 — 공단 사무실이 NAT 뒤에 있어 촘촘하게 잡으면 월요일 아침에
// 정상 사용자가 서로를 막는다. 의도적으로 느슨하게 둔다.
const PER_IP_LIMIT = envInt("RESET_PIN_PER_IP_HOURLY", 20);

// 인스턴스 전역 40/시간 — 실제 제동장치. 1,800명 6주 기준 정상 수요는
// 하루 1~3건이라 약 300배 여유다.
const GLOBAL_LIMIT = envInt("RESET_PIN_GLOBAL_HOURLY", 40);

// 응답 시간 하한. bcrypt cost-10 해시 최악값보다 커야 패딩이 실제로 지배한다.
export const FLOOR_MS = envInt("RESET_PIN_FLOOR_MS", 700);

// 위조 IP로 Map을 무한히 키울 수 있으므로 상한이 필수다. 없으면 요청 제한
// 자체가 메모리 고갈 벡터가 된다.
const MAX_KEYS = 5_000;

const hits = new Map<string, number[]>();
let globalHits: number[] = [];

// 타임스탬프는 시간순으로만 append되므로 앞에서부터 잘라내면 된다.
function prune(list: number[], now: number): number[] {
  const cutoff = now - WINDOW_MS;
  let i = 0;
  while (i < list.length && list[i] <= cutoff) i++;
  return i === 0 ? list : list.slice(i);
}

export function clientIp(req: NextRequest): string {
  // Next 15는 NextRequest.ip를 제거했다. Vercel은 두 헤더를 모두 채운다.
  const real = req.headers.get("x-real-ip");
  if (real?.trim()) return real.trim();

  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    // 앞쪽 항목은 클라이언트가 주장한 값이라 위조 가능하다. 가장 가까운
    // 프록시가 덧붙인 마지막 항목을 쓴다.
    const parts = fwd.split(",");
    const last = parts[parts.length - 1]?.trim();
    if (last) return last;
  }
  return "unknown";
}

// 통과 시에만 카운트를 적립한다. 거부된 요청은 적립하지 않는다.
export function allowResetRequest(ip: string): boolean {
  const now = Date.now();

  globalHits = prune(globalHits, now);
  if (globalHits.length >= GLOBAL_LIMIT) return false;

  const cur = prune(hits.get(ip) ?? [], now);
  if (cur.length >= PER_IP_LIMIT) {
    hits.set(ip, cur);
    return false;
  }

  cur.push(now);
  // 재삽입으로 최근 사용 키를 뒤로 보낸다 — 축출할 때 오래된 것부터 버리기 위해.
  hits.delete(ip);
  hits.set(ip, cur);
  globalHits.push(now);

  if (hits.size > MAX_KEYS) {
    // Map은 삽입 순서를 보존하므로 첫 키가 가장 오래 안 쓰인 키다.
    const oldest = hits.keys().next().value;
    if (oldest !== undefined) hits.delete(oldest);
  }

  return true;
}

// 응답 직전에 호출한다. 성공·검증실패·스키마오류·과다요청 경로 전부에 적용해야
// 빠른 응답이 탐지 채널이 되지 않는다.
export async function padTo(startedAt: number): Promise<void> {
  const wait = FLOOR_MS - (Date.now() - startedAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
