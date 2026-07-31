"use client";

import { useEffect, useMemo, useState } from "react";
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

export default function SignupPage() {
  const router = useRouter();

  const [units, setUnits] = useState<OrgUnit[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [empNo, setEmpNo] = useState("");
  const [unitId, setUnitId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [nickname, setNickname] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [empNoError, setEmpNoError] = useState<string | null>(null);
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  useEffect(() => {
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
  }, [unitId]);

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
    setPinError(null);

    // 클라이언트 검증 (A4·A5) — 문안은 design/copy.md 그대로
    if (!/^\d{4}$/.test(pin)) {
      setPinError("숫자 4자리를 입력해 주세요.");
      return;
    }
    if (pin !== pinConfirm) {
      setPinError("비밀번호가 일치하지 않습니다.");
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
          pin,
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
      } else {
        setPinError(body.message);
      }
    } catch {
      setPinError("문제가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-[640px]">
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
                  HRDK 안전 골든벨 퀴즈 리그
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

            <div className="grid grid-cols-2 gap-2.5">
              <div className="flex flex-col gap-1.5">
                <label className="gb-label" htmlFor="pin">
                  비밀번호 4자리
                </label>
                <input
                  id="pin"
                  className="gb-input tracking-[0.3em]"
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="숫자 4자리"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="gb-label" htmlFor="pinConfirm">
                  비밀번호 확인
                </label>
                <input
                  id="pinConfirm"
                  className="gb-input tracking-[0.3em]"
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="숫자 4자리"
                  value={pinConfirm}
                  onChange={(e) => setPinConfirm(e.target.value)}
                  aria-invalid={pinError !== null}
                  required
                />
              </div>
            </div>
            {pinError && (
              <div className="gb-field-error -mt-2">
                <span className="font-black">✕</span>
                {pinError}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 px-5 pt-2.5 pb-[18px]">
          <div className="flex items-center gap-1.5 text-[13px] text-gb-text-secondary">
            <LockIcon size={14} />
            <span>이름과 이메일은 수집하지 않습니다.</span>
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
