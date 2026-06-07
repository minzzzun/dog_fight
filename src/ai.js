// ai.js — AI 연습 모드 봇 컨트롤러 (순수 로직, Three.js 비의존)
//
// 봇 기체(self)와 상대(target) 상태를 받아 사람 입력과 동일한 스키마의 입력 객체
// { pitch, roll, boost, brake, gun, missile, flare } 를 산출한다. main.js가 이를 P2
// 입력 자리에 끼워 넣으면 봇이 조종된다. 결정론(난수 없음)·THREE 비의존 → Vitest 대상.
//
// 전략(아케이드): 상대를 정면에 두도록 뱅크/피치로 추격 → 정면·근거리면 기관총,
//   락 완료면 미사일, 미사일 추적 받으면 플레어. 뒤를 잡히면 강하게 선회해 되돌린다.
import { forwardOf, upOf, rightOf } from './flight.js';

// ── 튜닝 상수 (약하게 조정 — 연습용 봇) ──────────────────────────────
export const AI_GUN_RANGE  = 280;               // 기관총 발사 최대 거리(m) — 짧게(접근해야 사격)
export const AI_GUN_CONE   = Math.PI / 180 * 4; // 기관총 발사 정렬 콘 반각(rad) — 좁게(정밀 정렬해야 사격)
export const AI_BOOST_DIST = 950;               // 이보다 멀 때만 부스터 — 덜 적극적으로 추격
export const AI_BRAKE_DIST = 120;               // 이보다 가깝고 정면이면 감속(오버슈트 방지)
export const AI_STEER_GAIN = 1.3;               // 조향 민감도 — 낮춰 둔하게(조준 따라붙기 느림)

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// 봇 입력 산출. opts = { incoming: 내게 미사일 추적 중?, locked: 내 미사일 락 완료? }.
export function computeAIInput(self, target, opts = {}) {
  const idle = { pitch: 0, roll: 0, boost: false, brake: false, gun: false, missile: false, flare: false };
  if (!self || !target || target.alive === false) return idle;

  const dx = target.x - self.x, dy = target.y - self.y, dz = target.z - self.z;
  const dist = Math.hypot(dx, dy, dz) || 1;
  const dir = { x: dx / dist, y: dy / dist, z: dz / dist };

  const f = forwardOf(self), u = upOf(self), r = rightOf(self);
  const fwdDot   = f.x * dir.x + f.y * dir.y + f.z * dir.z;  // +1 정면, -1 정후방
  const upDot    = u.x * dir.x + u.y * dir.y + u.z * dir.z;  // + 상대가 위쪽
  const rightDot = r.x * dir.x + r.y * dir.y + r.z * dir.z;  // + 상대가 우측

  let pitch, roll;
  if (fwdDot < 0) {
    // 상대가 뒤 → 강하게 선회(풀뱅크 + 피치업으로 끌어옴)
    roll = rightDot >= 0 ? 1 : -1;
    pitch = 1;
  } else {
    // 상대가 앞쪽 반구 → 좌우는 뱅크로, 상하는 피치로 정렬
    roll = clamp(rightDot * AI_STEER_GAIN, -1, 1);
    pitch = clamp(upDot * AI_STEER_GAIN, -1, 1);
  }

  const boost = dist > AI_BOOST_DIST;
  const brake = dist < AI_BRAKE_DIST && fwdDot > 0.8;

  const gun = fwdDot > Math.cos(AI_GUN_CONE) && dist < AI_GUN_RANGE;
  const missile = !!opts.locked;     // 락 완료 시 발사(락 누적은 envelope 유지 중 자동)
  const flare = !!opts.incoming;     // 미사일 추적 받는 중이면 플레어 전개

  return { pitch, roll, boost, brake, gun, missile, flare };
}
