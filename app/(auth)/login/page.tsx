"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import BellIcon, { LockIcon } from "@/components/BellIcon";

export default function LoginPage() {
  const router = useRouter();
  const [empNo, setEmpNo] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [lockMessage, setLockMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const locked = lockMessage !== null;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (locked || submitting) return;
    setSubmitting(true);
    setError(false);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empNo, pin }),
      });
      if (res.ok) {
        router.push("/");
        return;
      }
      if (res.status === 423) {
        const body = await res.json();
        setLockMessage(body.message);
        return;
      }
      setError(true);
    } catch {
      setError(true);
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
        <div className="flex flex-1 flex-col gap-7 px-5 pt-12 pb-2">
          <div className="flex flex-col items-center gap-3.5 text-center">
            <div className="relative h-[78px] w-[78px]">
              <span
                className="absolute inset-0 rounded-full border-2 border-gb-gold"
                style={{ animation: "gb-ring-out 1.2s ease-out 0.3s both" }}
              />
              <span
                className="absolute inset-0 rounded-full border-2 border-gb-yellow"
                style={{ animation: "gb-ring-out 1.5s ease-out 0.5s both" }}
              />
              <div className="absolute inset-0 flex items-center justify-center rounded-full border-[3px] border-gb-yellow-light bg-gb-gold">
                <BellIcon size={42} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-[13px] font-extrabold tracking-[0.14em] text-gb-gold">
                HRDK
              </div>
              <h1 className="text-[26px] font-extrabold tracking-[-0.01em] text-white">
                안전 골든벨 퀴즈 리그
              </h1>
              <div className="text-[15px] font-semibold tracking-[0.04em] text-gb-text-strong-sub">
                안전 이룸, 함께 해냄
              </div>
            </div>
          </div>

          {locked && (
            <div className="flex items-center gap-2.5 rounded border-[3px] border-gb-red bg-gb-red-bg px-3.5 py-[13px]">
              <LockIcon size={20} color="#F0A099" />
              <div className="text-[14px] leading-[1.5] font-bold text-gb-red-text">
                {lockMessage}
              </div>
            </div>
          )}

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
                disabled={locked}
                required
              />
            </div>
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
                aria-invalid={error}
                disabled={locked}
                required
              />
              {error && (
                <div className="gb-field-error">
                  <span className="font-black">✕</span>사번 또는 비밀번호가
                  올바르지 않습니다.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 px-5 pt-2.5 pb-[18px]">
          <button type="submit" className="gb-cta" disabled={locked || submitting}>
            로그인
          </button>
          <div className="text-center text-[14px] text-gb-text-secondary">
            아직 가입하지 않으셨나요?{" "}
            <Link
              href="/signup"
              className="font-bold text-gb-yellow underline underline-offset-[3px] hover:text-gb-yellow-light"
            >
              회원가입
            </Link>
          </div>
        </div>
      </form>
    </main>
  );
}
