"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Prelearning = {
  roundNo: number;
  title: string | null;
  body: string | null;
  state: "open" | "closed";
};

// prelearning_body 마크다운 부분집합 렌더 (라이브러리 미사용 — 규칙 8).
// `## 제목` → 번호 카드(design/mocks/사전학습), `- ` → 목록, `**강조**` → 옐로 강조.
type Block = { kind: "p"; text: string } | { kind: "ul"; items: string[] };
type Section = { title: string | null; blocks: Block[] };

function parseBody(body: string): Section[] {
  const sections: Section[] = [];
  let cur: Section = { title: null, blocks: [] };
  let para: string[] = [];
  let list: string[] = [];

  const flushPara = () => {
    if (para.length) {
      cur.blocks.push({ kind: "p", text: para.join(" ") });
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      cur.blocks.push({ kind: "ul", items: list });
      list = [];
    }
  };
  const flushSection = () => {
    flushPara();
    flushList();
    if (cur.title !== null || cur.blocks.length) sections.push(cur);
  };

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = line.match(/^#{2,3}\s+(.+)$/);
    if (heading) {
      flushSection();
      cur = { title: heading[1], blocks: [] };
      continue;
    }
    if (line.startsWith("- ")) {
      flushPara();
      list.push(line.slice(2));
      continue;
    }
    if (line === "") {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(line);
  }
  flushSection();
  return sections;
}

function Inline({ text }: { text: string }) {
  // **강조** → 세이프티 옐로 (목업 확정)
  const parts = text.split(/\*\*([^*]+)\*\*/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-bold text-gb-yellow">
            {p}
          </strong>
        ) : (
          p
        )
      )}
    </>
  );
}

export default function LearnPage({
  params,
}: {
  params: Promise<{ no: string }>;
}) {
  const { no } = use(params);
  const router = useRouter();
  const [data, setData] = useState<Prelearning | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/rounds/${no}/prelearning`);
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (res.status === 404) {
          router.replace("/");
          return;
        }
        if (!res.ok) {
          const body = await res.json();
          setBlocked(body.message);
          return;
        }
        setData(await res.json());
      } catch {
        setBlocked("문제가 발생했습니다. 잠시 후 다시 시도해 주세요.");
      }
    })();
  }, [no, router]);

  if (blocked) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-5 text-center">
        <p className="text-[16px] leading-[1.65] text-gb-text-body">{blocked}</p>
        <button
          type="button"
          className="gb-cta max-w-[320px]"
          onClick={() => router.push("/")}
        >
          홈으로
        </button>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-[14px] text-gb-text-secondary">불러오는 중...</p>
      </main>
    );
  }

  const sections = data.body ? parseBody(data.body) : [];

  return (
    <main className="flex flex-1 flex-col">
      {/* 헤더 패널 */}
      <div className="flex flex-col gap-1.5 border-b-[3px] border-gb-border-divider bg-gb-bg-panel px-4 pt-4 pb-3.5">
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 bg-gb-yellow" />
          <h1 className="m-0 text-[21px] font-extrabold tracking-[-0.01em] text-white">
            {data.roundNo}회차 사전학습
          </h1>
        </div>
        <div className="text-[14px] leading-[1.6] text-gb-text-secondary">
          아래 내용만 읽어도 대부분의 문제를 풀 수 있습니다.
        </div>
      </div>

      {/* 학습 카드 */}
      <div className="flex flex-1 flex-col gap-3 px-4 pt-4 pb-2">
        {data.title && sections.length === 0 && (
          <div className="text-[15px] leading-[1.65] text-gb-text-body">
            {data.title}
          </div>
        )}
        {sections.map((s, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded border-[3px] border-gb-border-card bg-gb-bg-panel p-3.5 shadow-gb-card"
          >
            {s.title && (
              <div className="flex items-center gap-2">
                <span className="font-gb-num text-[14px] font-bold text-gb-yellow tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-[13px] font-extrabold text-gb-gold">
                  <Inline text={s.title} />
                </span>
              </div>
            )}
            {s.blocks.map((b, j) =>
              b.kind === "p" ? (
                <div
                  key={j}
                  className="text-[16px] leading-[1.65] text-[#E4E9F5]"
                >
                  <Inline text={b.text} />
                </div>
              ) : (
                <ul key={j} className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {b.items.map((li, k) => (
                    <li
                      key={k}
                      className="flex gap-2 text-[15px] leading-[1.6] text-[#E4E9F5]"
                    >
                      <span className="text-gb-yellow">·</span>
                      <span>
                        <Inline text={li} />
                      </span>
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>
        ))}
      </div>

      {/* 하단 CTA — 개방 중에만 (종료 회차는 열람 전용, H3) */}
      {data.state === "open" && (
        <div className="sticky bottom-0 border-t-[3px] border-gb-border-divider bg-gb-bg-panel px-4 pt-2.5 pb-4">
          <Link
            href={`/round/${data.roundNo}/quiz`}
            className="gb-cta flex items-center justify-center text-[19px] no-underline"
          >
            이제 문제 풀기
          </Link>
        </div>
      )}
    </main>
  );
}
