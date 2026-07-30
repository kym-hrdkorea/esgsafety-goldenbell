import { getDb } from "./db";

// 관리자 조회·CSV 공용 헬퍼 (T11).
// PostgREST는 기본 1,000행에서 잘리므로 전량 조회는 반드시 range 페이지네이션으로 한다.

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>
): Promise<T[]> {
  const CHUNK = 1000;
  const rows: T[] = [];
  for (let off = 0; ; off += CHUNK) {
    const { data, error } = await build(off, off + CHUNK - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < CHUNK) break;
  }
  return rows;
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
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const BOM = String.fromCharCode(0xfeff);

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers, ...rows].map((r) => r.map(esc).join(","));
  return BOM + lines.join("\r\n") + "\r\n";
}

// CSV 조인용 참가자 맵. 사번은 CSV에만 싣는다(운영자 확정 결정) —
// 관리자 화면 API에는 닉네임만 노출한다(addendum H항).
export type ParticipantInfo = {
  empNo: string;
  nickname: string;
  orgUnitName: string;
  departmentName: string;
};

export async function participantMap(): Promise<Map<string, ParticipantInfo>> {
  const db = getDb();
  const rows = await fetchAll((from, to) =>
    db
      .from("participant")
      .select(
        "id, emp_no, nickname, org_unit:org_unit_id(name), department:department_id(name)"
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
      org_unit: { name: string };
      department: { name: string };
    };
    map.set(row.id, {
      empNo: row.emp_no,
      nickname: row.nickname,
      orgUnitName: row.org_unit.name,
      departmentName: row.department.name,
    });
  }
  return map;
}
