import { randomInt } from "node:crypto";

// 시드 기반 셔플. 세션 생성 시 1회만 실행하고 결과를 DB에 저장한다 (규칙 4).
// 요청마다 다시 섞으면 정답 판정이 어긋난다 — 저장된 choice_order만 재사용할 것.

// mulberry32 PRNG — 시드가 같으면 결과가 같아 단위테스트가 가능하다
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(arr: readonly T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// 0..n-1 인덱스 배열을 섞는다. choice_order = 표시순 → 원본 인덱스 매핑
export function shuffledIndices(n: number, seed: number): number[] {
  return seededShuffle(
    Array.from({ length: n }, (_, i) => i),
    seed
  );
}

export function randomSeed(): number {
  return randomInt(0, 2 ** 31);
}
