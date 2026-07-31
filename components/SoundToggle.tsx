"use client";

import { useSyncExternalStore } from "react";
import {
  isSoundEnabled,
  setSoundEnabled,
  subscribeSound,
} from "@/lib/sound";

// 소리 전체 on/off 토글 (파일럿 추가 기능 — 목업에 없는 재량 UI).
// 켜는 탭이 곧 브라우저 오디오 잠금 해제 제스처가 된다.
export default function SoundToggle() {
  const enabled = useSyncExternalStore(
    subscribeSound,
    isSoundEnabled,
    () => false
  );

  return (
    <button
      type="button"
      onClick={() => setSoundEnabled(!enabled)}
      aria-label={enabled ? "소리 끄기" : "소리 켜기"}
      title={enabled ? "소리 끄기" : "소리 켜기"}
      className={`flex h-9 w-9 flex-none cursor-pointer items-center justify-center rounded-[3px] border-2 active:translate-x-px active:translate-y-px ${
        enabled
          ? "border-gb-yellow bg-gb-bg-highlight text-gb-yellow"
          : "border-gb-border-chip bg-gb-bg-screen text-gb-text-dim"
      }`}
    >
      {enabled ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path
            d="M4 9v6h4l5 4V5L8 9H4z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path
            d="M4 9v6h4l5 4V5L8 9H4z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M16.5 9.5l5 5m0-5l-5 5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}
