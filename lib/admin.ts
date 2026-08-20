import { getDb } from "./db.ts";

// 관리자 조회·CSV 공용 헬퍼 (T11).
// PostgREST는 기본 1,000행에서 잘리므로 전량 조회는 반드시 range 페이지네이션으로 한다.

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>
): Promise<T[]> {
  const CHUNK = 1000;
  const CONCURRENCY = 4;
  const rows: T[] = [];
  const first = await build(0, CHUNK - 1);
  if (first.error) throw new Error(first.error.message);
  const firstBatch = first.data ?? [];
  rows.push(...firstBatch);
  if (firstBatch.length < CHUNK) return rows;

  // 대용량 관리자 조회는 1,000행 페이지를 순차로 170회 이상 기다리지 않도록
  // 네 페이지씩 병렬로 가져온다. 각 호출자는 안정적인 order를 함께 지정한다.
  for (let base = CHUNK; ; base += CHUNK * CONCURRENCY) {
    const pages = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, index) => {
        const from = base + index * CHUNK;
        return build(from, from + CHUNK - 1);
      })
    );
    let reachedEnd = false;
    for (const page of pages) {
      if (page.error) throw new Error(page.error.message);
      const batch = page.data ?? [];
      rows.push(...batch);
      if (batch.length < CHUNK) reachedEnd = true;
    }
    if (reachedEnd) return rows;
  }
}

// Excel 호환 CSV: UTF-8 BOM + CRLF. 쉼표·따옴표·개행은 따옴표로 감싼다.
function esc(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s =
    typeof v === "string"
      ? v
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v);
  // 참가자 닉네임·SHORT 응답이 Excel 수식으로 실행되지 않도록 방어한다.
  // 숫자 타입은 문자열로 바꾸지 않고 그대로 두므로 정상적인 음수 수치에는
  // 영향을 주지 않는다. 공백 뒤 수식도 Excel이 해석할 수 있어 함께 차단한다.
  const safe = /^[\t ]*[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe)
    ? `"${safe.replace(/"/g, '""')}"`
    : safe;
}

const BOM = String.fromCharCode(0xfeff);

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers, ...rows].map((r) => r.map(esc).join(","));
  return BOM + lines.join("\r\n") + "\r\n";
}

// 관리자 기록·CSV의 표시 시각은 저장값(UTC)을 KST로 변환한다.
export function formatKst(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

// CSV 조인용 참가자 맵. 사번은 CSV에만 싣는다(운영자 확정 결정) —
// 관리자 화면 API에는 닉네임만 노출한다(addendum H항).
export type ParticipantInfo = {
  empNo: string;
  nickname: string;
  phone: string; // 포상 연락용 (P항). 2026-08-20 이전 가입 행은 빈 문자열
  orgUnitName: string;
  departmentName: string;
};

export async function participantMap(): Promise<Map<string, ParticipantInfo>> {
  const db = getDb();
  const rows = await fetchAll((from, to) =>
    db
      .from("participant")
      .select(
        "id, emp_no, nickname, phone, org_unit:org_unit_id(name), department:department_id(name)"
      )
      .order("id")
      .range(from, to)
  );
  const map = new Map<string, ParticipantInfo>();
  for (const r of rows) {
    const row = r as unknown as {
      id: string;
      emp_no: string;
      nickname: string;
      phone: string | null;
      org_unit: { name: string };
      department: { name: string };
    };
    map.set(row.id, {
      empNo: row.emp_no,
      nickname: row.nickname,
      phone: row.phone ?? "",
      orgUnitName: row.org_unit.name,
      departmentName: row.department.name,
    });
  }
  return map;
}
