import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// unitId 있음 → 해당 소속의 부서만 [{ id, name }] (기존 계약).
// unitId 없음 → 전체 부서 + 소속명 [{ id, name, orgUnitId, orgUnitName }] —
//   가입 화면의 소속·부서 통합 검색용. 부서명 6종이 지역 소속 수십 곳에
//   반복되므로(직업능력개발부 32곳 등) 소속명 병기가 필수다.
// 파라미터가 존재하나 무효한 경우(?unitId=abc)는 여전히 400이다.
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("unitId");

  try {
    if (raw === null) {
      const { data, error } = await getDb()
        .from("department")
        .select("id, name, sort_order, org_unit:org_unit_id(id, name, sort_order)");
      if (error) throw new Error(error.message);

      // org_unit.sort_order는 카테고리를 관통하는 전역 일련번호(1~50) —
      // 소속 → 부서 2단 정렬이 화면 카테고리 순서와 일치한다
      const rows = (data ?? [])
        .map((d) => {
          const unit = d.org_unit as unknown as {
            id: number;
            name: string;
            sort_order: number;
          };
          return {
            id: d.id,
            name: d.name,
            orgUnitId: unit.id,
            orgUnitName: unit.name,
            _unitSort: unit.sort_order,
            _deptSort: d.sort_order,
          };
        })
        .sort((a, b) => a._unitSort - b._unitSort || a._deptSort - b._deptSort)
        .map(({ id, name, orgUnitId, orgUnitName }) => ({
          id,
          name,
          orgUnitId,
          orgUnitName,
        }));
      return NextResponse.json(rows);
    }

    const unitId = Number(raw);
    if (!Number.isInteger(unitId) || unitId <= 0) {
      return NextResponse.json(
        {
          code: "VALIDATION",
          message: "문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
        },
        { status: 400 }
      );
    }

    const { data, error } = await getDb()
      .from("department")
      .select("id, name")
      .eq("org_unit_id", unitId)
      .order("sort_order");
    if (error) throw new Error(error.message);
    return NextResponse.json(data);
  } catch (err) {
    console.error(
      "[org/departments]",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      {
        code: "INTERNAL",
        message: "문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      },
      { status: 500 }
    );
  }
}
