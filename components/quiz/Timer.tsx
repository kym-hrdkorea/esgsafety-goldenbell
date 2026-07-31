"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { sfxTick } from "@/lib/sound";

// 표시용 타이머. 판정은 항상 서버(served_at 기준)가 한다 (규칙 3).
// remainingSec은 서버가 계산한 남은 시간 — 새로고침해도 이어서 줄어든다.
// 틱 감산이 아니라 앵커(Date.now()) 기준 재계산이다 — 화면 잠금·앱 전환으로
// 브라우저가 인터벌을 멈춰도 복귀 즉시 올바른 값으로 돌아온다 (ux A-2).
export default function Timer({
  remainingSec,
  timeLimitSec,
  running,
  onExpire,
}: {
  remainingSec: number;
  timeLimitSec: number;
  running: boolean;
  onExpire: () => void;
}) {
  const anchorRef = useRef(Date.now());
  const [secs, setSecs] = useState(remainingSec);
  const expiredRef = useRef(false);

  useEffect(() => {
    anchorRef.current = Date.now();
    setSecs(remainingSec);
    expiredRef.current = false;
  }, [remainingSec]);

  const compute = useCallback(() => {
    setSecs(
      Math.max(
        0,
        remainingSec - Math.floor((Date.now() - anchorRef.current) / 1000)
      )
    );
  }, [remainingSec]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(compute, 500);
    // 복귀 즉시 재계산 — visibilitychange만으로는 iOS bfcache 복귀가 안 잡혀 pageshow 병행
    const onWake = () => {
      if (!document.hidden) compute();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("pageshow", onWake);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("pageshow", onWake);
    };
  }, [running, compute]);

  useEffect(() => {
    if (running && secs === 0 && !expiredRef.current) {
      expiredRef.current = true;
      onExpire();
    }
  }, [secs, running, onExpire]);

  // 임박(10초 이하) 매초 틱음 — 표시용 카운트에만 연동, 판정과 무관
  useEffect(() => {
    if (running && secs <= 10 && secs > 0) sfxTick();
  }, [secs, running]);

  const imminent = secs <= 10;
  const pct = Math.max(0, Math.min(100, (secs / timeLimitSec) * 100));

  return (
    <div className="flex items-center gap-2.5">
      <div
        className="relative h-[18px] flex-1 overflow-hidden rounded-[2px] border-2 bg-gb-bg-screen"
        style={{ borderColor: imminent ? "#FFD400" : "#2f3a5e" }}
      >
        <div
          className="absolute top-0 bottom-0 left-0"
          style={{
            width: `${pct}%`,
            transition: "width 1s linear",
            ...(imminent
              ? {
                  backgroundImage:
                    "repeating-linear-gradient(45deg,#FFD400 0 8px,#0b0f1d 8px 16px)",
                  backgroundSize: "23px 23px",
                  animation: "gb-hz-slide 1s linear infinite",
                }
              : { background: "#FFD400" }),
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, transparent 0 14px, #161d33 14px 17px)",
          }}
        />
      </div>
      <div
        className="flex min-w-[78px] flex-none items-baseline justify-end gap-[3px] rounded-[3px] px-[9px] py-1"
        style={
          imminent
            ? {
                background: "#E23A2E",
                color: "#FFFFFF",
                // 무한 진동은 임박 10초 내내 숫자 판독을 방해한다 — 2회 후 정지.
                // 임박 인지는 빨강 배경·'초 남음' 문안·옐로 테두리로 이미 이중 부호화 (ux A-4)
                animation: "gb-hz-shake 0.5s ease-in-out 2",
              }
            : { background: "#12172b", color: "#FFD400" }
        }
      >
        <span className="font-gb-num text-[26px] leading-none font-bold tabular-nums">
          {secs}
        </span>
        <span className="pb-[2px] text-[12px] font-bold">
          {imminent ? "초 남음" : "초"}
        </span>
      </div>
    </div>
  );
}
