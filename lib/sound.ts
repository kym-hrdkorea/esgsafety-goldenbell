"use client";

// 음향 유틸 (파일럿 추가 기능).
// - 효과음: Web Audio API 합성 — 에셋·라이브러리 불필요(규칙 8).
//   배경음악에 묻히지 않도록 밝은 주파수대(660Hz~)·짧은 엔벨로프·높은 게인을 쓰고,
//   재생 순간 배경음악을 잠시 낮춘다(더킹).
// - 배경음악: /audio/bgm-main.mp3(대기)·/audio/bgm-game.mp3(응시) 루프 재생.
//   파일이 없으면 조용히 무시된다(Suno 생성물 도착 전에도 앱은 정상).
// - 설정은 모듈 상태만 사용 — 브라우저 스토리지 금지(규칙 5).
//   SPA 내비게이션 동안 유지되고 전체 새로고침 시 기본값(켜짐)으로 복귀한다.
//   기본 켜짐(운영자 확정): 브라우저 자동재생 정책상 실제 재생은 첫 터치·키 입력
//   직후 시작된다(제스처 재시도 장치). 원치 않으면 토글로 끈다.

let ctx: AudioContext | null = null;
let enabled = true;
const listeners = new Set<() => void>();

export type BgmKind = "main" | "game";
let bgmEl: HTMLAudioElement | null = null;
let desiredBgm: BgmKind | null = null;
let loadedBgm: BgmKind | null = null;
const BGM_VOLUME = 0.22;
const DUCK_VOLUME = 0.1;

function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

// ── 설정 ──
export function isSoundEnabled(): boolean {
  return enabled;
}

export function subscribeSound(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  if (on) {
    audioCtx(); // 사용자 제스처 안에서 컨텍스트 잠금 해제
    syncBgm();
  } else {
    bgmEl?.pause();
  }
  listeners.forEach((fn) => fn());
}

// ── 배경음악 ──
// 자동재생 차단 시 사용자 제스처마다 재시도하고, 재생에 성공하면 해제한다.
//
// 이벤트 4종을 함께 쓰는 이유: iOS Safari 등 모바일 브라우저는 pointerdown
// (터치 시작)을 오디오 허용 제스처로 인정하지 않는 경우가 많다 — 사용자
// 활성화(user activation)는 touchend·click·keydown에서 부여된다. pointerdown만
// 걸어두면 휴대폰에서는 화면을 아무리 눌러도 재생이 시작되지 않는다.
// 같은 탭 안에서 pointerdown 실패 → touchend/click 성공 순으로 이어지도록
// 성공 전까지 리스너를 유지한다(재시도가 멱등이라 중복 발화 무해).
// capture: 앱 내부 stopPropagation에 가로막히지 않게 한다.
const GESTURE_EVENTS = ["pointerdown", "touchend", "click", "keydown"] as const;
let gestureArmed = false;

function retryOnGesture(): void {
  audioCtx(); // 제스처 안에서 컨텍스트 잠금 해제 (효과음용)
  syncBgm(); // 재생 성공 시 disarmGestureRetry()가 호출된다
}

function armGestureRetry(): void {
  if (gestureArmed || typeof window === "undefined") return;
  gestureArmed = true;
  for (const ev of GESTURE_EVENTS) {
    window.addEventListener(ev, retryOnGesture, {
      capture: true,
      passive: true,
    });
  }
}

function disarmGestureRetry(): void {
  if (!gestureArmed || typeof window === "undefined") return;
  gestureArmed = false;
  for (const ev of GESTURE_EVENTS) {
    window.removeEventListener(ev, retryOnGesture, { capture: true });
  }
}

function syncBgm(): void {
  if (!enabled || desiredBgm === null || typeof window === "undefined") return;
  if (!bgmEl) {
    bgmEl = new Audio();
    bgmEl.loop = true;
    // 제스처가 오기 전에 파일을 받아 두면 첫 탭에서 지연 없이 시작된다
    bgmEl.preload = "auto";
  }
  if (loadedBgm !== desiredBgm) {
    bgmEl.src = `/audio/bgm-${desiredBgm}.mp3`;
    loadedBgm = desiredBgm;
  }
  bgmEl.volume = BGM_VOLUME;
  // 자동재생 차단이면 다음 제스처에서 재시도. 파일 부재(404)는 조용히 무시.
  bgmEl.play().then(disarmGestureRetry).catch(armGestureRetry);
}

// 화면이 원하는 배경음악을 선언한다. 소리가 켜져 있으면 즉시 전환을 시도한다.
export function requestBgm(kind: BgmKind | null): void {
  desiredBgm = kind;
  if (kind === null) {
    bgmEl?.pause();
    return;
  }
  syncBgm();
}

function duckBgm(ms: number): void {
  if (!bgmEl || bgmEl.paused) return;
  bgmEl.volume = DUCK_VOLUME;
  setTimeout(() => {
    if (bgmEl && !bgmEl.paused) bgmEl.volume = BGM_VOLUME;
  }, ms);
}

// ── 효과음 합성 ──
type Note = {
  freq: number;
  at: number; // 시작(초, 상대)
  dur: number;
  gain: number;
  type: OscillatorType;
  slideTo?: number; // 재생 중 주파수 이동
};

function playNotes(notes: Note[], duckMs = 450): void {
  if (!enabled) return;
  const ac = audioCtx();
  if (!ac) return;
  duckBgm(duckMs);
  const t0 = ac.currentTime;
  for (const n of notes) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = n.type;
    osc.frequency.setValueAtTime(n.freq, t0 + n.at);
    if (n.slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(
        n.slideTo,
        t0 + n.at + n.dur
      );
    }
    g.gain.setValueAtTime(0, t0 + n.at);
    g.gain.linearRampToValueAtTime(n.gain, t0 + n.at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur);
    osc.connect(g).connect(ac.destination);
    osc.start(t0 + n.at);
    osc.stop(t0 + n.at + n.dur + 0.03);
  }
}

// 정답: 밝은 2음 상행 차임
export function sfxCorrect(): void {
  playNotes([
    { freq: 659, at: 0, dur: 0.16, gain: 0.4, type: "triangle" },
    { freq: 988, at: 0.11, dur: 0.3, gain: 0.5, type: "triangle" },
    { freq: 1976, at: 0.11, dur: 0.22, gain: 0.12, type: "sine" },
  ]);
}

// 오답: 낮고 부드러운 하행 2음 — 주제 특성상 우스꽝스러운 실패음은 쓰지 않는다(디자인 브리프)
export function sfxWrong(): void {
  playNotes([
    { freq: 330, at: 0, dur: 0.18, gain: 0.32, type: "sine" },
    { freq: 262, at: 0.14, dur: 0.3, gain: 0.32, type: "sine" },
  ]);
}

// 시간초과: 완만한 하강 스윕
export function sfxTimeout(): void {
  playNotes([
    { freq: 523, at: 0, dur: 0.5, gain: 0.32, type: "sine", slideTo: 196 },
  ]);
}

// 임박 틱(10초 이하 매초): 짧고 또렷하게, 배경음 위에서도 들리는 고역
export function sfxTick(): void {
  playNotes(
    [{ freq: 1568, at: 0, dur: 0.05, gain: 0.22, type: "square" }],
    120
  );
}

// 만점 골든벨: 배음을 겹친 벨 타격
export function sfxBell(): void {
  playNotes(
    [
      { freq: 880, at: 0, dur: 1.3, gain: 0.45, type: "sine" },
      { freq: 1760, at: 0, dur: 0.9, gain: 0.22, type: "sine" },
      { freq: 2637, at: 0, dur: 0.5, gain: 0.1, type: "sine" },
      { freq: 880, at: 0.45, dur: 1.1, gain: 0.3, type: "sine" },
      { freq: 1760, at: 0.45, dur: 0.7, gain: 0.15, type: "sine" },
    ],
    1600
  );
}
