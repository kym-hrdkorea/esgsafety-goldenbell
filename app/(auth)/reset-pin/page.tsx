"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import BellIcon from "@/components/BellIcon";
import SoundToggle from "@/components/SoundToggle";
import { requestBgm } from "@/lib/sound";

type DeptSearchRow = {
  id: number;
  name: string;
  orgUnitId: number;
  orgUnitName: string;
};

// 비밀번호 자율 재설정 (addendum O항).
//
// 2단계로 보여주지만 제출은 마지막에 1회다. 서버를 2단계로 나누면 세션 저장소가
// 없어 베어러 티켓을 stateless HMAC으로 만들어야 하는데, 그건 소각 불가·유효기간 내
// 재사용 가능한 비밀번호 변경 권한이 된다. 같은 UX, 티켓 없음, 제한 지점 하나.
export default function ResetPinPage() {
  const [step, setStep] = useState<1 | 2>(1);
  const [done, setDone] = useState(false);

  const [empNo, setEmpNo] = useState("");
  const [nickname, setNickname] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [allDepts, setAllDepts] = useState<DeptSearchRow[]>([]);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<DeptSearchRow | null>(null);

  const [deptError, setDeptError] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestBgm("main");
  }, []);

  // 검색용 전체 목록(193행, 소속명 포함) 1회 로드. unitId 없이 호출하면
  // 전 부서 + 소속명을 소속→부서 순으로 정렬해 돌려준다.
  useEffect(() => {
    fetch("/api/org/departments")
      .then((r) => r.json())
      .then((list: DeptSearchRow[]) =>
        setAllDepts(Array.isArray(list) ? list : [])
      )
      .catch(() => setAllDepts([]));
  }, []);

  // 토큰 AND 매칭 — 가입 화면과 같은 규칙. 부서명 6종이 지역 소속 수십 곳에
  // 반복되므로 "{소속명}{부서명}"을 함께 매칭해야 한다.
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
    setQuery("");
    setDeptError(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    if (step === 1) {
      if (!picked) {
        setDeptError("소속과 부서를 선택해 주세요.");
        return;
      }
      setStep(2);
      return;
    }

    if (!/^\d{4}$/.test(pin)) {
      setPinError("숫자 4자리를 입력해 주세요.");
      return;
    }
    if (pin !== pinConfirm) {
      setPinError("비밀번호가 일치하지 않습니다.");
      return;
    }
    setPinError(null);

    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/reset-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 닉네임을 trim하지 않는다. 가입이 trim하지 않으므로 앞뒤 공백이 붙은
        // 닉네임이 저장돼 있을 수 있고, 여기서 다듬으면 그 사용자는 입력한 그대로도
        // 맞출 수 없게 된다. 서버도 그대로 비교한다(app/api/auth/reset-pin/route.ts).
        body: JSON.stringify({
          empNo,
          nickname,
          departmentId: picked!.id,
          newPin: pin,
        }),
      });

      if (res.ok) {
        setDone(true);
        return;
      }

      if (res.status === 401) {
        // 불일치는 1단계 입력의 문제다 — 되돌려 보내 고칠 수 있게 한다.
        setStep(1);
        setFormError(
          "입력한 정보가 일치하지 않습니다. 사번·닉네임·부서를 다시 확인해 주세요."
        );
        return;
      }
      if (res.status === 429) {
        setFormError("요청이 많습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }
      setFormError("문제가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } catch {
      setFormError("문제가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <main className="mx-auto w-full max-w-[640px]">
        <div className="flex min-h-[calc(100dvh-10px)] flex-col">
          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-5 text-center">
            <div className="flex h-[78px] w-[78px] items-center justify-center rounded-full border-[3px] border-gb-yellow-light bg-gb-gold">
              <BellIcon size={42} />
            </div>
            <div className="text-[17px] leading-[1.6] font-bold text-gb-text-primary">
              비밀번호가 변경되었습니다.
              <br />
              새 비밀번호로 로그인해 주세요.
            </div>
          </div>
          <div className="px-5 pt-2.5 pb-[18px]">
            {/* .gb-cta는 width:100%만 있고 display가 없다 — <a>는 inline이라
                width가 무시되므로 flex를 얹는다(learn·result 화면과 같은 관례) */}
            <Link
              href="/login"
              className="gb-cta flex items-center justify-center no-underline"
            >
              로그인으로 돌아가기
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[640px]">
      <form
        className="flex min-h-[calc(100dvh-10px)] flex-col"
        onSubmit={onSubmit}
      >
        <div className="flex flex-1 flex-col gap-7 px-5 pt-4 pb-2">
          <div className="flex justify-end">
            <SoundToggle />
          </div>

          <div className="flex flex-col gap-1">
            <h1 className="text-[24px] font-extrabold tracking-[-0.01em] text-white">
              비밀번호를 잊으셨나요?
            </h1>
            <div className="text-[14px] leading-[1.6] text-gb-text-secondary">
              가입할 때 입력한 정보로 확인한 뒤 새 비밀번호를 설정합니다.
            </div>
          </div>

          {formError && (
            <div className="rounded border-[3px] border-gb-red bg-gb-red-bg px-3.5 py-[13px] text-[14px] leading-[1.5] font-bold text-gb-red-text">
              {formError}
            </div>
          )}

          {step === 1 ? (
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
                  autoComplete="off"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="gb-label" htmlFor="nickname">
                  닉네임
                </label>
                <input
                  id="nickname"
                  className="gb-input"
                  type="text"
                  placeholder="가입할 때 정한 닉네임"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  minLength={2}
                  maxLength={12}
                  autoComplete="off"
                  required
                />
              </div>

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
                      onClick={() => {
                        setPicked(null);
                        setQuery("");
                      }}
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
                          검색 결과가 없습니다.
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
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3.5">
              <div className="flex flex-col gap-1.5">
                <label className="gb-label" htmlFor="pin">
                  새 비밀번호 4자리
                </label>
                <input
                  id="pin"
                  className="gb-input tracking-[0.3em]"
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="숫자 4자리"
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value);
                    setPinError(null);
                  }}
                  aria-invalid={pinError !== null}
                  autoComplete="new-password"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="gb-label" htmlFor="pinConfirm">
                  새 비밀번호 확인
                </label>
                <input
                  id="pinConfirm"
                  className="gb-input tracking-[0.3em]"
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="숫자 4자리"
                  value={pinConfirm}
                  onChange={(e) => {
                    setPinConfirm(e.target.value);
                    setPinError(null);
                  }}
                  aria-invalid={pinError !== null}
                  autoComplete="new-password"
                  required
                />
                {pinError && (
                  <div className="gb-field-error">
                    <span className="font-black">✕</span>
                    {pinError}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 px-5 pt-2.5 pb-[18px]">
          <button type="submit" className="gb-cta" disabled={submitting}>
            {step === 1 ? "다음" : "비밀번호 변경하기"}
          </button>
          {step === 2 ? (
            <button
              type="button"
              className="gb-cta-sub"
              onClick={() => {
                setStep(1);
                setPinError(null);
              }}
            >
              이전
            </button>
          ) : (
            <Link
              href="/login"
              className="text-center text-[14px] font-bold text-gb-text-secondary underline underline-offset-[3px] hover:text-gb-text-body"
            >
              로그인으로 돌아가기
            </Link>
          )}
        </div>
      </form>
    </main>
  );
}
