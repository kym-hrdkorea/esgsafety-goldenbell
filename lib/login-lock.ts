import { getDb } from "./db";

// 로그인 실패 카운터의 낙관적 동시성(CAS).
//
// SELECT failed_attempts → bcrypt.compare(cost 10, 수십~수백ms) → 읽은 값+1 UPDATE
// 사이에 다른 요청이 카운터를 올리면 읽은 값이 낡는다. 낙관적 가드가 없으면 동시에
// 도착한 N개 요청이 전부 같은 값을 읽고 같은 값을 써서 N번 틀려도 카운터가 1만 오른다.
// 4자리 PIN은 조합이 1만 개뿐이라(business-rules 1.2) 이 통제가 뚫리면 전수 대입이 가능하다.
//
// UPDATE에 읽은 값을 조건으로 걸고 갱신 행 수로 승패를 판정한다 —
// app/api/rounds/[no]/answer/route.ts 의 claim 패턴과 동일한 방식이다.
// Supabase JS는 트랜잭션·컬럼 상대 증분을 지원하지 않고, RPC 함수 생성은 DDL이라 금지다(규칙 9-1).
//
// ★ 이 모듈은 사번·로그인ID를 인자로 받지도, 로그로 남기지도 않는다 (규칙 10).
//   식별은 이미 조회된 행의 PK(id)로만 한다.

type LockTable = "participant" | "admin_user";

export type LockRow = {
  id: string;
  failed_attempts: number;
  locked_until: string | null;
};

const MAX_CAS_ATTEMPTS = 4;

// 읽은 스냅샷과 DB가 일치할 때만 갱신한다.
// locked_until 도 조건에 넣어야 '만료 잠금 리셋' 경합에서 두 요청이 서로를 덮지 않는다.
function casFilter<
  Q extends {
    eq(column: string, value: unknown): Q;
    is(column: string, value: null): Q;
  },
>(q: Q, row: LockRow): Q {
  const base = q.eq("id", row.id).eq("failed_attempts", row.failed_attempts);
  return row.locked_until === null
    ? base.is("locked_until", null)
    : base.eq("locked_until", row.locked_until);
}

async function reread(table: LockTable, id: string): Promise<LockRow | null> {
  const { data, error } = await getDb()
    .from(table)
    .select("id, failed_attempts, locked_until")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as LockRow) ?? null;
}

export type FailOutcome =
  | { kind: "locked"; lockedUntil: string }
  | { kind: "counted" };

// 로그인 실패 1건을 기록한다. 잠금 임계값에 도달하면 locked 를 반환한다.
// 임계값 도달은 addendum I항에 따라 "5번째 실패 응답에서 이미 423"이다.
export async function registerFailedAttempt(
  table: LockTable,
  row: LockRow,
  maxAttempts: number,
  lockMinutes: number
): Promise<FailOutcome> {
  const db = getDb();
  let cur = row;

  for (let i = 0; i < MAX_CAS_ATTEMPTS; i++) {
    const now = Date.now();
    // 만료된 잠금이 남아 있으면 연속 실패 카운트를 새로 시작한다
    const expired =
      cur.locked_until !== null && new Date(cur.locked_until).getTime() <= now;
    const fails = (expired ? 0 : cur.failed_attempts) + 1;
    const willLock = fails >= maxAttempts;
    const until = willLock
      ? new Date(now + lockMinutes * 60_000).toISOString()
      : null;

    const { data, error } = await casFilter(
      db
        .from(table)
        .update({ failed_attempts: fails, locked_until: until }),
      cur
    ).select("id");
    if (error) throw new Error(error.message);

    if (data && data.length > 0) {
      return willLock ? { kind: "locked", lockedUntil: until! } : { kind: "counted" };
    }

    // 0행 = 경합 패배. 최신 값으로 재시도한다.
    const fresh = await reread(table, cur.id);
    if (!fresh) return { kind: "counted" }; // 행 소멸 — 401로 끝낸다
    if (fresh.locked_until && new Date(fresh.locked_until).getTime() > Date.now()) {
      // 다른 요청이 이미 잠갔다. 내 실패도 잠금으로 귀결된다.
      return { kind: "locked", lockedUntil: fresh.locked_until };
    }
    cur = fresh;
  }

  // 상한 초과: 한 계정에 4회 이상 동시 실패가 겹치는 패턴은 정상 사용자에게 나오지 않는다.
  // 그 자체가 공격 신호이므로 보수적으로 잠근다(fail-closed).
  const until = new Date(Date.now() + lockMinutes * 60_000).toISOString();
  const { error } = await db
    .from(table)
    .update({ failed_attempts: maxAttempts, locked_until: until })
    .eq("id", cur.id);
  if (error) throw new Error(error.message);
  return { kind: "locked", lockedUntil: until };
}

export type ClearOutcome = { ok: true } | { ok: false; lockedUntil: string };

// 성공 로그인의 카운터 초기화. 값이 고정(0/null)이라 그 자체는 멱등하지만,
// 잠금 검사 → bcrypt → UPDATE 사이에 다른 요청의 실패가 잠금을 걸었을 수 있다.
// 그대로 덮으면 "잠금 중에는 올바른 PIN이어도 423"이 동시성에서만 뚫린다.
export async function clearFailedAttempts(
  table: LockTable,
  row: LockRow
): Promise<ClearOutcome> {
  const db = getDb();
  let cur = row;

  for (let i = 0; i < MAX_CAS_ATTEMPTS; i++) {
    const { data, error } = await casFilter(
      db.from(table).update({
        failed_attempts: 0,
        locked_until: null,
        last_login_at: new Date().toISOString(),
      }),
      cur
    ).select("id");
    if (error) throw new Error(error.message);

    if (data && data.length > 0) return { ok: true };

    const fresh = await reread(table, cur.id);
    if (!fresh) return { ok: true };
    if (fresh.locked_until && new Date(fresh.locked_until).getTime() > Date.now()) {
      return { ok: false, lockedUntil: fresh.locked_until };
    }
    cur = fresh; // 다른 성공 요청이 이미 리셋했다 — 재시도
  }

  // 상한 초과인데 잠금은 아니다 = 이미 누군가 0/null로 만들어 놨다. 성공으로 본다(fail-open).
  // 실패 경로와 방향이 반대인 이유: 올바른 자격증명이 이미 제시됐으므로 계정 보호 목적이 없다.
  return { ok: true };
}
