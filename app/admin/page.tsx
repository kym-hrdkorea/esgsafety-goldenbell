"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

// 관리자 조회 화면 (T11). 규칙 9의 예외(addendum H항) — 운영자 1~2명 전용이라
// 문안은 재량으로 작성하되, 참가자 실명·사번은 노출하지 않는다(닉네임 기준).
// 조회 + CSV 내려받기만 제공한다. 문항 CRUD·순위 조작 UI는 만들지 않는다.

type Participation = { roundNo: number; started: number; finished: number; registered: number };
type ItemStat = {
  itemCode: string; roundNo: number; level: string; itemType: string;
  category: string | null; anchorCode: string | null; measureCode: string | null;
  n: number; pValue: number; timeoutPct: number; discrimination: number;
};
type Matched = {
  nickname: string; orgUnitName: string; preN: number; postN: number;
  prePct: number; postPct: number; gainPp: number;
};
type Heat = { orgUnitName: string; category: string; n: number; pct: number };
type PrelearnEffect = { roundNo: number; viewed: boolean; n: number; avgPct: number };
type ShortRow = { itemCode: string; roundNo: number | null; nickname: string; submitted: string; answeredAt: string };
type RoundStatus = {
  roundNo: number; season: number; theme: string;
  opensAt: string; closesAt: string; isPublished: boolean;
  state: "locked" | "open" | "closed"; hasBody: boolean;
};

// 표시 전용 KST 변환. 개방 판정은 서버가 이미 state로 내려준다 (business-rules 2절)
function kst(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(iso));
}

const STATE_LABEL: Record<RoundStatus["state"], string> = {
  locked: "대기", open: "열림", closed: "종료",
};

const EXPORTS: { kind: string; label: string }[] = [
  { kind: "answers", label: "응답 원본" },
  { kind: "scores", label: "회차별 점수" },
  { kind: "items", label: "문항 통계" },
  { kind: "matched", label: "동일인 대조" },
  { kind: "heatmap", label: "히트맵" },
  { kind: "participation", label: "참여 지표" },
];

const TH = "px-2.5 py-1.5 text-left text-[12px] font-extrabold tracking-[0.06em] text-gb-text-secondary";
const TD = "px-2.5 py-1.5 text-[13px] text-gb-text-primary";
const NUM = "font-gb-num tabular-nums";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <div className="h-[14px] w-1 bg-gb-yellow" />
        <div className="text-[14px] font-extrabold text-gb-text-strong-sub">{title}</div>
      </div>
      {children}
    </div>
  );
}

function Empty() {
  return <div className="rounded border-[3px] border-gb-border-divider p-4 text-[13px] text-gb-text-secondary">아직 데이터가 없습니다.</div>;
}

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [rounds, setRounds] = useState<RoundStatus[]>([]);
  const [participation, setParticipation] = useState<Participation[]>([]);
  const [items, setItems] = useState<ItemStat[]>([]);
  const [matched, setMatched] = useState<Matched[]>([]);
  const [heatmap, setHeatmap] = useState<Heat[]>([]);
  const [prelearn, setPrelearn] = useState<PrelearnEffect[]>([]);
  const [shorts, setShorts] = useState<ShortRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const paths = [
      "/api/admin/rounds",
      "/api/admin/stats/participation",
      "/api/admin/stats/items",
      "/api/admin/stats/matched",
      "/api/admin/stats/heatmap",
      "/api/admin/stats/prelearning",
      "/api/admin/short-unmatched",
    ];
    const results = await Promise.all(paths.map((p) => fetch(p)));
    if (results.some((r) => r.status === 401)) {
      setAuthed(false);
      return;
    }
    if (results.some((r) => !r.ok)) {
      setLoadError("조회에 실패했습니다. 새로고침해 주세요.");
      setAuthed(true);
      return;
    }
    // ★ paths 순서와 아래 구조분해 순서가 1:1로 맞아야 한다
    const [ro, pa, it, ma, he, pl, sh] = await Promise.all(results.map((r) => r.json()));
    setRounds(ro);
    setParticipation(pa);
    setItems(it);
    setMatched(ma);
    setHeatmap(he);
    setPrelearn(pl);
    setShorts(sh);
    setAuthed(true);
  }, []);

  useEffect(() => {
    loadAll().catch(() => setLoadError("조회에 실패했습니다. 새로고침해 주세요."));
  }, [loadAll]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setLoginError(null);
    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ loginId, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setLoginError(body?.message ?? "로그인에 실패했습니다.");
        return;
      }
      setPassword("");
      await loadAll();
    } catch {
      setLoginError("문제가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/admin/auth/logout", { method: "POST" });
    setAuthed(false);
  }

  if (authed === null) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-[14px] text-gb-text-secondary">불러오는 중...</p>
      </main>
    );
  }

  if (!authed) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <form
          onSubmit={handleLogin}
          className="flex w-full max-w-sm flex-col gap-4 rounded border-[3px] border-gb-border-card bg-gb-bg-panel p-6 shadow-gb-card"
        >
          <div className="flex items-center gap-2">
            <h1 className="m-0 text-[22px] font-extrabold text-white">관리자</h1>
            <span className="rounded-[2px] bg-gb-red px-1.5 py-[3px] text-[11px] font-extrabold tracking-[0.08em] text-white">
              ADMIN
            </span>
          </div>
          <label className="gb-label flex flex-col gap-1.5">
            아이디
            <input
              className="gb-input"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              autoComplete="username"
            />
          </label>
          <label className="gb-label flex flex-col gap-1.5">
            비밀번호
            <input
              className="gb-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          {loginError && (
            <p className="gb-field-error m-0 text-[13px]">{loginError}</p>
          )}
          <button type="submit" className="gb-cta" disabled={submitting}>
            로그인
          </button>
        </form>
      </main>
    );
  }

  const latest = [...participation].reverse().find((p) => p.started > 0);
  const registered = participation[0]?.registered ?? 0;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-7 px-4 py-6">
      <div className="flex items-center gap-2">
        <h1 className="m-0 text-[24px] font-extrabold tracking-[-0.01em] text-white">관리자</h1>
        <span className="rounded-[2px] bg-gb-red px-1.5 py-[3px] text-[11px] font-extrabold tracking-[0.08em] text-white">
          ADMIN
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleLogout}
          className="cursor-pointer rounded-[3px] border-2 border-gb-border-chip bg-transparent px-3 py-1.5 text-[13px] font-bold text-gb-text-secondary"
        >
          로그아웃
        </button>
      </div>

      {loadError && <p className="m-0 text-[14px] text-gb-red-text">{loadError}</p>}

      <div className="grid grid-cols-3 gap-2.5">
        <div className="flex flex-col gap-1 rounded border-[3px] border-gb-border-card bg-gb-bg-panel px-3.5 py-3 shadow-gb-card">
          <div className="text-[12px] font-bold text-gb-text-secondary">가입자</div>
          <div className={`${NUM} text-[22px] font-bold text-gb-text-primary`}>{registered.toLocaleString("ko-KR")}</div>
        </div>
        <div className="flex flex-col gap-1 rounded border-[3px] border-gb-border-card bg-gb-bg-panel px-3.5 py-3 shadow-gb-card">
          <div className="text-[12px] font-bold text-gb-text-secondary">
            {latest ? `${latest.roundNo}회차 시작` : "시작"}
          </div>
          <div className={`${NUM} text-[22px] font-bold text-gb-yellow`}>{(latest?.started ?? 0).toLocaleString("ko-KR")}</div>
        </div>
        <div className="flex flex-col gap-1 rounded border-[3px] border-gb-border-card bg-gb-bg-panel px-3.5 py-3 shadow-gb-card">
          <div className="text-[12px] font-bold text-gb-text-secondary">
            {latest ? `${latest.roundNo}회차 완료` : "완료"}
          </div>
          <div className={`${NUM} text-[22px] font-bold text-gb-yellow`}>{(latest?.finished ?? 0).toLocaleString("ko-KR")}</div>
        </div>
      </div>

      <Section title="회차 개방 상태">
        {rounds.length === 0 ? (
          <Empty />
        ) : (
          <div className="overflow-hidden rounded border-[3px] border-gb-border-divider">
            <table className="w-full border-collapse">
              <thead className="bg-gb-bg-panel">
                <tr>
                  <th className={TH}>회차</th>
                  <th className={TH}>주제</th>
                  <th className={TH}>개방(KST)</th>
                  <th className={TH}>마감(KST)</th>
                  <th className={TH}>상태</th>
                  <th className={TH}>사전학습</th>
                </tr>
              </thead>
              <tbody>
                {rounds.map((r) => (
                  <tr key={r.roundNo} className="border-t-2 border-gb-border-row">
                    <td className={`${TD} ${NUM}`}>{r.roundNo}</td>
                    <td className={TD}>{r.theme}</td>
                    <td className={`${TD} ${NUM}`}>{kst(r.opensAt)}</td>
                    <td className={`${TD} ${NUM}`}>{kst(r.closesAt)}</td>
                    <td className={TD}>
                      <span className={r.state === "open" ? "font-bold text-gb-yellow" : undefined}>
                        {STATE_LABEL[r.state]}
                      </span>
                      {!r.isPublished && " (비공개)"}
                    </td>
                    <td className={TD}>
                      {r.hasBody ? "O" : <span className="font-bold text-gb-red-text">없음</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="CSV 내려받기">
        <div className="flex flex-wrap gap-2">
          {EXPORTS.map((e) => (
            <a
              key={e.kind}
              href={`/api/admin/export/${e.kind}`}
              className="rounded-[3px] border-2 border-gb-border-card bg-gb-bg-panel px-3.5 py-2 text-[13px] font-bold text-gb-yellow no-underline"
            >
              {e.label}.csv
            </a>
          ))}
        </div>
      </Section>

      <Section title="참여 현황">
        {participation.length === 0 ? (
          <Empty />
        ) : (
          <div className="overflow-hidden rounded border-[3px] border-gb-border-divider">
            <table className="w-full border-collapse">
              <thead className="bg-gb-bg-panel">
                <tr>
                  <th className={TH}>회차</th>
                  <th className={TH}>시작</th>
                  <th className={TH}>완료</th>
                  <th className={TH}>가입자</th>
                </tr>
              </thead>
              <tbody>
                {participation.map((p) => (
                  <tr key={p.roundNo} className="border-t-2 border-gb-border-row">
                    <td className={`${TD} ${NUM}`}>{p.roundNo}</td>
                    <td className={`${TD} ${NUM}`}>{p.started}</td>
                    <td className={`${TD} ${NUM}`}>{p.finished}</td>
                    <td className={`${TD} ${NUM}`}>{p.registered}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="사전학습 열람 효과">
        {prelearn.length === 0 ? (
          <Empty />
        ) : (
          <div className="overflow-hidden rounded border-[3px] border-gb-border-divider">
            <table className="w-full border-collapse">
              <thead className="bg-gb-bg-panel">
                <tr>
                  <th className={TH}>회차</th>
                  <th className={TH}>구분</th>
                  <th className={TH}>인원</th>
                  <th className={TH}>평균 정답률</th>
                </tr>
              </thead>
              <tbody>
                {prelearn.map((p, i) => (
                  <tr key={i} className="border-t-2 border-gb-border-row">
                    <td className={`${TD} ${NUM}`}>{p.roundNo}</td>
                    <td className={TD}>{p.viewed ? "열람" : "미열람"}</td>
                    <td className={`${TD} ${NUM}`}>{p.n}</td>
                    <td className={`${TD} ${NUM}`}>{p.avgPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="문항 통계 (P·D)">
        {items.length === 0 ? (
          <Empty />
        ) : (
          <div className="max-h-96 overflow-auto rounded border-[3px] border-gb-border-divider">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-gb-bg-panel">
                <tr>
                  <th className={TH}>문항</th>
                  <th className={TH}>유형</th>
                  <th className={TH}>난이도</th>
                  <th className={TH}>영역</th>
                  <th className={TH}>측정</th>
                  <th className={TH}>앵커</th>
                  <th className={TH}>n</th>
                  <th className={TH}>P(%)</th>
                  <th className={TH}>초과(%)</th>
                  <th className={TH}>D</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.itemCode} className="border-t-2 border-gb-border-row">
                    <td className={`${TD} ${NUM}`}>{it.itemCode}</td>
                    <td className={TD}>{it.itemType}</td>
                    <td className={TD}>{it.level}</td>
                    <td className={TD}>{it.category ?? "-"}</td>
                    <td className={TD}>{it.measureCode ?? "-"}</td>
                    <td className={TD}>{it.anchorCode ?? "-"}</td>
                    <td className={`${TD} ${NUM}`}>{it.n}</td>
                    <td className={`${TD} ${NUM}`}>{it.pValue}</td>
                    <td className={`${TD} ${NUM}`}>{it.timeoutPct}</td>
                    <td className={`${TD} ${NUM}`}>{it.discrimination}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="동일인 사전·사후 대조">
        {matched.length === 0 ? (
          <Empty />
        ) : (
          <div className="max-h-96 overflow-auto rounded border-[3px] border-gb-border-divider">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-gb-bg-panel">
                <tr>
                  <th className={TH}>닉네임</th>
                  <th className={TH}>소속</th>
                  <th className={TH}>사전 n</th>
                  <th className={TH}>사후 n</th>
                  <th className={TH}>사전(%)</th>
                  <th className={TH}>사후(%)</th>
                  <th className={TH}>향상(pp)</th>
                </tr>
              </thead>
              <tbody>
                {matched.map((m, i) => (
                  <tr key={i} className="border-t-2 border-gb-border-row">
                    <td className={TD}>{m.nickname}</td>
                    <td className={TD}>{m.orgUnitName}</td>
                    <td className={`${TD} ${NUM}`}>{m.preN}</td>
                    <td className={`${TD} ${NUM}`}>{m.postN}</td>
                    <td className={`${TD} ${NUM}`}>{m.prePct}</td>
                    <td className={`${TD} ${NUM}`}>{m.postPct}</td>
                    <td className={`${TD} ${NUM}`}>{m.gainPp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="취약영역 히트맵 (소속 × 영역)">
        {heatmap.length === 0 ? (
          <Empty />
        ) : (
          <div className="max-h-96 overflow-auto rounded border-[3px] border-gb-border-divider">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-gb-bg-panel">
                <tr>
                  <th className={TH}>소속</th>
                  <th className={TH}>영역</th>
                  <th className={TH}>n</th>
                  <th className={TH}>정답률(%)</th>
                </tr>
              </thead>
              <tbody>
                {heatmap.map((h, i) => (
                  <tr key={i} className="border-t-2 border-gb-border-row">
                    <td className={TD}>{h.orgUnitName}</td>
                    <td className={TD}>{h.category}</td>
                    <td className={`${TD} ${NUM}`}>{h.n}</td>
                    <td className={`${TD} ${NUM}`}>{h.pct}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="SHORT 미매칭 응답 (수동 인정 검토용)">
        {shorts.length === 0 ? (
          <Empty />
        ) : (
          <div className="max-h-96 overflow-auto rounded border-[3px] border-gb-border-divider">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-gb-bg-panel">
                <tr>
                  <th className={TH}>문항</th>
                  <th className={TH}>회차</th>
                  <th className={TH}>닉네임</th>
                  <th className={TH}>제출값</th>
                  <th className={TH}>답변 시각</th>
                </tr>
              </thead>
              <tbody>
                {shorts.map((s, i) => (
                  <tr key={i} className="border-t-2 border-gb-border-row">
                    <td className={`${TD} ${NUM}`}>{s.itemCode}</td>
                    <td className={`${TD} ${NUM}`}>{s.roundNo}</td>
                    <td className={TD}>{s.nickname}</td>
                    <td className={TD}>{s.submitted}</td>
                    <td className={`${TD} ${NUM}`}>{s.answeredAt?.slice(0, 19).replace("T", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="flex items-start gap-2 rounded border-2 border-gb-border-divider bg-gb-bg-panel px-3.5 py-3">
        <div className="text-[13px] leading-[1.6] text-gb-text-secondary">
          개인정보 보호를 위해 참가자는 닉네임으로만 표시됩니다. 사번은 CSV
          파일에만 포함되므로 내려받은 파일의 보관·폐기에 유의해 주세요.
        </div>
      </div>
    </main>
  );
}
