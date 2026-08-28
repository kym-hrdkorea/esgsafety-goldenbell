"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import BellIcon, { LockIcon } from "@/components/BellIcon";
import SoundToggle from "@/components/SoundToggle";
import { requestBgm } from "@/lib/sound";

type OrgUnit = {
  id: number;
  name: string;
  categoryCode: string;
  categoryName: string;
};
type Department = { id: number; name: string };
type DeptSearchRow = {
  id: number;
  name: string;
  orgUnitId: number;
  orgUnitName: string;
};

export default function SignupPage() {
  const router = useRouter();

  const [units, setUnits] = useState<OrgUnit[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [empNo, setEmpNo] = useState("");
  const [unitId, setUnitId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [nickname, setNickname] = useState("");
  const [phone, setPhone] = useState("");
  const [empNoError, setEmpNoError] = useState<string | null>(null);
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 소속·부서 통합 검색 (기본 모드). 부서명 6종이 지역 소속 수십 곳에 반복되므로
  // 소속명+부서명을 함께 매칭하고 결과는 "{소속} · {부서}"로 표기한다.
  // 불변식: departmentId가 비어있지 않다 ⇔ 화면에 확정 표시(picked 또는 목록 선택)가 있다.
  const [mode, setMode] = useState<"search" | "list">("search");
  const [allDepts, setAllDepts] = useState<DeptSearchRow[]>([]);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<DeptSearchRow | null>(null);
  const [deptError, setDeptError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // 첫 화면부터 대기 배경음악 — 실제 재생은 첫 터치·키 입력 직후 시작
  useEffect(() => {
    requestBgm("main");
  }, []);

  useEffect(() => {
    fetch("/api/org/units")
      .then((r) => r.json())
      .then(setUnits)
      .catch(() => setUnits([]));
  }, []);

  // list(폴백) 모드 전용 — search 모드에서 실행되면 departmentId를 초기화해
  // 검색 선택을 깨뜨리므로 모드 가드가 필수다
  useEffect(() => {
    if (mode !== "list") return;
    if (!unitId) {
      setDepartments([]);
      setDepartmentId("");
      return;
    }
    fetch(`/api/org/departments?unitId=${unitId}`)
      .then((r) => r.json())
      .then((list: Department[]) => {
        setDepartments(list);
        setDepartmentId("");
      })
      .catch(() => setDepartments([]));
  }, [unitId, mode]);

  // 검색용 전체 목록(193행, 소속명 포함) 1회 로드. 실패하면 검색 결과가 비어
  // 빈 상태 문구가 목록 폴백으로 안내한다.
  useEffect(() => {
    fetch("/api/org/departments")
      .then((r) => r.json())
      .then((list: DeptSearchRow[]) =>
        setAllDepts(Array.isArray(list) ? list : [])
      )
      .catch(() => setAllDepts([]));
  }, []);

  // 토큰 AND 매칭: 모든 토큰이 "{소속명}{부서명}"(공백 제거·소문자)에 포함.
  // categoryName은 대상에서 제외한다 — "본부" 검색 시 본부(HQ) 16개 소속 전체가
  // 딸려 오는 노이즈 방지. 영문 소속(AI디지털정보국) 대비 소문자 변환 유지.
  const results = useMemo(() => {
    const tokens = query
      .normalize("NFC")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (tokens.length === 0) return [];
    return allDepts.filter((d) => {
      const hay = (d.orgUnitName + d.name)
        .replace(/\s/g, "")
        .normalize("NFC")
        .toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [query, allDepts]);

  function pickDept(d: DeptSearchRow) {
    searchRef.current?.blur(); // 모바일 키보드 내림
    setPicked(d);
    setDepartmentId(String(d.id));
    setQuery("");
    setDeptError(null);
  }

  function resetPick() {
    setPicked(null);
    setDepartmentId("");
    setQuery("");
  }

  // 모드 전환 시 선택 상태 전부 초기화 — 잔존값이 제출되면 안 된다
  function switchMode(next: "search" | "list") {
    setMode(next);
    setPicked(null);
    setQuery("");
    setDepartmentId("");
    setUnitId("");
    setDeptError(null);
  }

  // 소속 드롭다운은 본부/부설기관/소속기관/국외 EPS를 optgroup으로 구분 (business-rules 1.1)
  const groupedUnits = useMemo(() => {
    const groups: { categoryName: string; items: OrgUnit[] }[] = [];
    for (const u of units) {
      const last = groups[groups.length - 1];
      if (last && last.categoryName === u.categoryName) {
        last.items.push(u);
      } else {
        groups.push({ categoryName: u.categoryName, items: [u] });
      }
    }
    return groups;
  }, [units]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setEmpNoError(null);
    setNicknameError(null);
    setPhoneError(null);
    setFormError(null);
    setDeptError(null);

    // 검색 콤보박스는 native required가 없다 — 미선택 제출을 여기서 차단
    if (!departmentId) {
      setDeptError("소속과 부서를 선택해 주세요.");
      searchRef.current?.scrollIntoView({ block: "center" });
      searchRef.current?.focus();
      return;
    }

    // 클라이언트 검증 (A4·A5) — 문안은 design/copy.md 그대로.
    // 하이픈·공백 허용 입력을 숫자만으로 정규화해 보낸다 (P항).
    const normalizedPhone = phone.replace(/\D/g, "");
    if (!/^01[016789]\d{7,8}$/.test(normalizedPhone)) {
      setPhoneError("올바른 휴대폰 번호를 입력해 주세요.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          empNo,
          nickname,
          departmentId: Number(departmentId),
          phone: normalizedPhone,
        }),
      });
      if (res.status === 201) {
        router.push("/");
        return;
      }
      const body = await res.json();
      if (body.code === "EMP_NO_TAKEN") {
        setEmpNoError(body.message);
      } else if (body.code === "NICKNAME_TAKEN") {
        setNicknameError(body.message);
      } else if (body.field === "empNo") {
        setEmpNoError(body.message);
      } else if (body.field === "nickname") {
        setNicknameError(body.message);
      } else if (body.field === "departmentId") {
        setDeptError(body.message);
      } else if (body.field === "phone") {
        setPhoneError(body.message);
      } else {
        setFormError(body.message);
      }
    } catch {
      setFormError("문제가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="gb-auth-bg mx-auto w-full max-w-[640px]">
      <form
        className="flex min-h-[calc(100dvh-10px)] flex-col"
        onSubmit={onSubmit}
      >
        <div className="flex flex-1 flex-col gap-[18px] px-5 pt-[22px] pb-2">
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-[9px]">
              <div className="flex h-[38px] w-[38px] items-center justify-center rounded-[3px] border-2 border-gb-yellow-light bg-gb-gold">
                <BellIcon size={24} />
              </div>
              <div className="flex flex-col gap-px">
                <div className="text-[15px] font-extrabold tracking-[0.02em] text-gb-yellow">
                  HRDK 안전·청렴 ON! 골든벨
                </div>
                <div className="text-[13px] font-semibold tracking-[0.04em] text-gb-text-strong-sub">
                  안전 이룸, 함께 해냄
                </div>
              </div>
              <div className="flex-1" />
              <SoundToggle />
            </div>
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-extrabold tracking-[-0.01em] text-white">
                처음이신가요?
              </h1>
              <div className="text-[14px] leading-[1.6] text-gb-text-secondary">
                사번과 소속을 입력하면 바로 시작할 수 있습니다.
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3.5">
            <div className="flex flex-col gap-1.5">
              <label className="gb-label" htmlFor="empNo">
                사번
              </label>
              <input
                id="empNo"
                className="gb-input"
                type="text"
                inputMode="numeric"
                placeholder="사번을 입력하세요"
                value={empNo}
                onChange={(e) => setEmpNo(e.target.value)}
                aria-invalid={empNoError !== null}
                required
              />
              {empNoError && (
                <div className="gb-field-error">
                  <span className="font-black">✕</span>
                  {empNoError}
                </div>
              )}
            </div>

            {mode === "search" ? (
              <div className="flex flex-col gap-1.5">
                <label className="gb-label" htmlFor="deptSearch">
                  소속 · 부서
                </label>
                {picked ? (
                  <div className="flex gap-2">
                    <div className="flex min-h-[52px] min-w-0 flex-1 items-center gap-1.5 rounded border-[3px] border-gb-yellow bg-gb-bg-card px-3.5">
                      <span className="truncate text-[14px] font-semibold text-gb-text-secondary">
                        {picked.orgUnitName}
                      </span>
                      <span className="flex-none text-gb-text-dim">·</span>
                      <span className="truncate text-[15px] font-bold text-white">
                        {picked.name}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={resetPick}
                      className="flex-none cursor-pointer rounded-[3px] border-2 border-gb-border-chip bg-gb-bg-screen px-3 text-[13px] font-bold text-gb-text-strong-sub active:translate-x-px active:translate-y-px"
                    >
                      다시 검색
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      id="deptSearch"
                      ref={searchRef}
                      className="gb-input"
                      type="text"
                      placeholder="소속이나 부서명으로 검색하세요"
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setDeptError(null);
                      }}
                      // Enter(모바일 '완료' 포함)로 form이 제출되면 안 된다.
                      // preventDefault만 하면 한글 IME 조합 중 Enter도 자동 회피된다.
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.preventDefault();
                      }}
                      autoComplete="off"
                      aria-invalid={deptError !== null}
                    />
                    {query.trim() !== "" &&
                      (results.length > 0 ? (
                        // 인라인 목록(오버레이 금지 — iOS 키보드 viewport 대응).
                        // 하드 캡 없음: 동명 부서가 32곳까지 나오므로 잘리면 안 된다.
                        <div className="max-h-[40vh] overflow-y-auto rounded border-[3px] border-gb-border-card">
                          {results.map((d) => (
                            <button
                              key={d.id}
                              type="button"
                              onClick={() => pickDept(d)}
                              className="flex w-full cursor-pointer items-baseline gap-1.5 border-t-2 border-gb-border-row bg-gb-bg-card px-3.5 py-3 text-left first:border-t-0 active:bg-gb-bg-highlight"
                            >
                              <span className="min-w-0 truncate text-[14px] font-semibold text-gb-text-secondary">
                                {d.orgUnitName}
                              </span>
                              <span className="flex-none text-[13px] text-gb-text-dim">
                                ·
                              </span>
                              <span className="min-w-0 truncate text-[15px] font-bold text-gb-text-primary">
                                {d.name}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="text-[13px] leading-[1.6] text-gb-text-secondary">
                          검색 결과가 없습니다. 목록에서 직접 선택해 주세요.
                        </div>
                      ))}
                  </>
                )}
                {deptError && (
                  <div className="gb-field-error">
                    <span className="font-black">✕</span>
                    {deptError}
                  </div>
                )}
                {!picked && (
                  <button
                    type="button"
                    onClick={() => switchMode("list")}
                    className="inline-flex min-h-11 cursor-pointer items-center self-start bg-transparent px-1 py-2.5 -mx-1 text-[13px] font-bold text-gb-yellow underline underline-offset-[3px]"
                  >
                    목록에서 직접 선택
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="flex flex-col gap-1.5">
                    <label className="gb-label" htmlFor="unit">
                      소속
                    </label>
                    <select
                      id="unit"
                      className="gb-input gb-select"
                      value={unitId}
                      onChange={(e) => setUnitId(e.target.value)}
                      required
                    >
                      <option value="" disabled>
                        소속을 선택하세요
                      </option>
                      {groupedUnits.map((g) => (
                        <optgroup key={g.categoryName} label={g.categoryName}>
                          {g.items.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="gb-label" htmlFor="department">
                      부서
                    </label>
                    <select
                      id="department"
                      className="gb-input gb-select"
                      value={departmentId}
                      onChange={(e) => setDepartmentId(e.target.value)}
                      disabled={!unitId}
                      required
                    >
                      <option value="" disabled>
                        부서를 선택하세요
                      </option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => switchMode("search")}
                  className="inline-flex min-h-11 cursor-pointer items-center self-start bg-transparent px-1 py-2.5 -mx-1 text-[13px] font-bold text-gb-yellow underline underline-offset-[3px]"
                >
                  소속이나 부서명으로 검색하세요
                </button>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="gb-label" htmlFor="nickname">
                닉네임
              </label>
              <input
                id="nickname"
                className="gb-input"
                type="text"
                placeholder="순위표에 표시될 이름"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                minLength={2}
                maxLength={12}
                aria-invalid={nicknameError !== null}
                required
              />
              {nicknameError && (
                <div className="gb-field-error">
                  <span className="font-black">✕</span>
                  {nicknameError}
                </div>
              )}
              <div className="text-[13px] leading-[1.6] text-gb-text-secondary">
                닉네임은 순위표에 표시되며, 가입 후 변경할 수 없습니다.
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="gb-label" htmlFor="phone">
                휴대폰 번호
              </label>
              <input
                id="phone"
                className="gb-input"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={13}
                placeholder="휴대폰 번호를 입력하세요"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                aria-invalid={phoneError !== null}
                required
              />
              {phoneError && (
                <div className="gb-field-error">
                  <span className="font-black">✕</span>
                  {phoneError}
                </div>
              )}
              <div className="text-[13px] leading-[1.6] text-gb-text-secondary">
                휴대폰 번호 끝 4자리가 비밀번호로 설정됩니다.
              </div>
            </div>
            {formError && (
              <div className="gb-field-error -mt-2">
                <span className="font-black">✕</span>
                {formError}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 px-5 pt-2.5 pb-[18px]">
          <div className="flex items-start gap-1.5 text-[13px] text-gb-text-secondary">
            <LockIcon size={14} />
            <span>
              이름과 이메일은 수집하지 않습니다. 휴대폰 번호는 포상 지급
              연락에만 사용합니다.
            </span>
          </div>
          <button type="submit" className="gb-cta" disabled={submitting}>
            가입하고 시작하기
          </button>
          <div className="text-center text-[14px] text-gb-text-secondary">
            이미 가입하셨나요?{" "}
            <Link
              href="/login"
              className="font-bold text-gb-yellow underline underline-offset-[3px] hover:text-gb-yellow-light"
            >
              로그인
            </Link>
          </div>
        </div>
      </form>
    </main>
  );
}
