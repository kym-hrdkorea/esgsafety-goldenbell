import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fetchAll, formatKst, toCsv } from "./admin.ts";

describe("관리자 조회·CSV", () => {
  test("대용량 페이지를 병렬로 가져와도 행을 빠뜨리지 않는다", async () => {
    const source = Array.from({ length: 2_500 }, (_, index) => index);
    const pages: number[] = [];
    const rows = await fetchAll(async (from, to) => {
      pages.push(from);
      return {
        data: source.slice(from, to + 1),
        error: null,
      };
    });

    assert.deepEqual(rows, source);
    assert.deepEqual(pages.sort((a, b) => a - b), [0, 1_000, 2_000, 3_000, 4_000]);
  });

  test("사용자 입력이 Excel 수식으로 해석되지 않는다", () => {
    const csv = toCsv(["값"], [["=1+1"], ["+cmd"], ["-2"], ["@cmd"], ["  =cmd"]]);
    assert.match(csv, /'=1\+1/);
    assert.match(csv, /'\+cmd/);
    assert.match(csv, /'-2/);
    assert.match(csv, /'@cmd/);
    assert.match(csv, /'  =cmd/);
  });

  test("CSV·관리자 화면 시각을 KST로 변환한다", () => {
    assert.equal(formatKst("2026-08-13T00:00:00.000Z"), "2026-08-13 09:00:00");
    assert.equal(formatKst(null), "");
  });
});
