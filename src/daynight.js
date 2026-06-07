// daynight.js — 낮/밤 시간대 순환 (순수 로직, Three.js 비의존)
//
// 경과 시간(초)을 받아 현재 시간대와 보간된 하늘/조명 파라미터를 돌려준다.
// 순서: 낮 → 저녁 → 밤 → 아침 → (반복). 각 단계 PHASE_DURATION초.
// 네 키프레임 팔레트를 단계 진행도(frac)로 선형 보간해 부드럽게 전환한다.
//
// 색은 모두 0~1 RGB. THREE 변환·라이트 적용은 렌더 레이어(main.js)에서.

// ── 상수 ──────────────────────────────────────────────────────────────
export const PHASE_DURATION = 90;                 // 한 단계 지속(초)
export const PHASES = ['day', 'evening', 'night', 'morning'];
export const CYCLE = PHASE_DURATION * PHASES.length;  // 전체 한 바퀴(초) = 360

// 조명 세기가 이 값 미만이면 "밤"으로 간주 → 항법등 점등.
export const NIGHT_LIGHT_THRESHOLD = 0.5;

// 단계별 키프레임 팔레트(단계 시작 시점의 값). 사이는 선형 보간.
//   sky: 하늘/안개 색, hemiIntensity/dirIntensity: 라이트 세기, dirColor: 태양/달빛 색.
const PALETTES = {
  day:     { sky: { r: 0.53, g: 0.81, b: 0.92 }, hemiIntensity: 1.00, dirIntensity: 1.20, dirColor: { r: 1.00, g: 1.00, b: 1.00 } },
  evening: { sky: { r: 1.00, g: 0.50, b: 0.30 }, hemiIntensity: 0.65, dirIntensity: 0.95, dirColor: { r: 1.00, g: 0.65, b: 0.45 } },
  night:   { sky: { r: 0.010, g: 0.018, b: 0.05 }, hemiIntensity: 0.10, dirIntensity: 0.12, dirColor: { r: 0.45, g: 0.55, b: 0.90 } },
  morning: { sky: { r: 1.00, g: 0.78, b: 0.62 }, hemiIntensity: 0.70, dirIntensity: 1.00, dirColor: { r: 1.00, g: 0.82, b: 0.68 } },
};

// ── 보조 ──────────────────────────────────────────────────────────────
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpRGB(a, b, t) { return { r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) }; }

// ── 현재 시간대 상태 ──────────────────────────────────────────────────
//
// elapsed(초) → { phase, phaseIndex, isNight, sky, hemiIntensity, dirIntensity, dirColor }.
//  - phase: 현재 단계 이름(보간은 다음 단계로 향함).
//  - isNight: 조명 세기 < NIGHT_LIGHT_THRESHOLD (어두워지는 저녁 후반~밤에 true) → 항법등.
export function dayNightState(elapsed) {
  const t = ((elapsed % CYCLE) + CYCLE) % CYCLE;        // 음수/초과도 안전하게 0~CYCLE
  const idx = Math.floor(t / PHASE_DURATION) % PHASES.length;
  const frac = (t - idx * PHASE_DURATION) / PHASE_DURATION;  // 0~1 단계 진행도
  const a = PALETTES[PHASES[idx]];
  const b = PALETTES[PHASES[(idx + 1) % PHASES.length]];

  const hemiIntensity = lerp(a.hemiIntensity, b.hemiIntensity, frac);
  const dirIntensity = lerp(a.dirIntensity, b.dirIntensity, frac);

  return {
    phase: PHASES[idx],
    phaseIndex: idx,
    isNight: dirIntensity < NIGHT_LIGHT_THRESHOLD,
    sky: lerpRGB(a.sky, b.sky, frac),
    hemiIntensity,
    dirIntensity,
    dirColor: lerpRGB(a.dirColor, b.dirColor, frac),
  };
}
