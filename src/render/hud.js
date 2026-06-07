// render/hud.js (M5/M6) — 분할 화면 HUD (현재: 탄약/재장전 + 미사일 잔량/락온; M9에서 체력·플레어 확장)
//
// 좌(P1)/우(P2) 각 절반 하단 중앙에 텍스트 패널을 띄운다. DOM 오버레이라
// THREE 씬과 무관하게 그려진다. update(p1, p2)로 매 프레임 갱신.
//   p1/p2 = { gun, launcher } — gun(M5 총기 상태), launcher(M6 런처 상태).
//   하위호환: update(gun1, gun2)처럼 gun 객체를 직접 넘겨도 동작(launcher만 생략).

import { LOCK_TIME, MISSILE_REGEN, MISSILE_AMMO } from '../weapons/missile.js';
import { FLARE_REGEN, FLARE_AMMO } from '../weapons/flare.js';

function makePanel(leftPercent) {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;bottom:16px;left:' + leftPercent + '%;transform:translateX(-50%);' +
    'color:#fff;font-family:system-ui,monospace;font-size:18px;font-weight:700;' +
    'text-shadow:0 1px 3px rgba(0,0,0,0.8);pointer-events:none;z-index:10;white-space:nowrap;' +
    'text-align:center';
  document.body.appendChild(el);
  return el;
}

function fmtGun(gun) {
  if (!gun) return '';
  if (gun.reloading) return '🔄 재장전…';
  return `🔫 ${gun.ammo} / 100`;
}

// 체력 한 줄(최소 표시; M9에서 체력바로 폴리시). hp 없으면 빈 문자열.
function fmtHp(hp) {
  if (typeof hp !== 'number') return '';
  return `❤️ ${Math.max(0, Math.round(hp))}`;
}

// 런처 잔량 + 락온 상태 + 플레어 잔량 한 줄. launcher 없으면 빈 문자열.
function fmtMissile(launcher, dispenser) {
  if (!launcher) return '';
  let lock;
  if (launcher.locked) {
    lock = '🔒 발사가능';
  } else if (launcher.lockTimer > 0) {
    const pct = Math.min(100, Math.round((launcher.lockTimer / LOCK_TIME) * 100));
    lock = `락온 ${pct}%`;
  } else {
    lock = '—';
  }
  // 재장전 남은 시간(잔량이 최대 미만일 때만). ↻Ns
  const mReload = launcher.ammo < MISSILE_AMMO
    ? ` ↻${Math.ceil(MISSILE_REGEN - (launcher.regenTimer ?? 0))}s` : '';
  let flare = '';
  if (dispenser) {
    const fReload = dispenser.ammo < FLARE_AMMO
      ? ` ↻${Math.ceil(FLARE_REGEN - (dispenser.regenTimer ?? 0))}s` : '';
    flare = `   ✦ ${dispenser.ammo}${fReload}`;
  }
  return `🚀 ${launcher.ammo}${mReload}   ${lock}${flare}`;
}

// 인자 정규화: { gun, launcher, target, dispenser, hp, lockedBy } 또는 gun 직접.
function normalize(state) {
  const empty = { gun: null, launcher: null, target: null, dispenser: null, hp: null, lockedBy: null };
  if (!state) return empty;
  if (state.gun || state.launcher || state.target || state.dispenser || typeof state.hp === 'number' || state.lockedBy) {
    return {
      gun: state.gun || null,
      launcher: state.launcher || null,
      target: state.target || null,
      dispenser: state.dispenser || null,
      hp: typeof state.hp === 'number' ? state.hp : null,
      lockedBy: state.lockedBy || null,
    };
  }
  return { ...empty, gun: state };  // 하위호환: gun 객체 직접
}

// 피락온 경고(각 절반 상단, 화살표 아래). 상대가 나를 락온 중/완료면 표시.
function makeWarn(leftPercent) {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;top:74px;left:' + leftPercent + '%;transform:translateX(-50%);' +
    'font-family:system-ui,monospace;font-weight:800;font-size:20px;' +
    'text-shadow:0 1px 4px rgba(0,0,0,0.9);pointer-events:none;z-index:12;display:none';
  document.body.appendChild(el);
  return el;
}

// 상대 방향 화살표(각 절반 상단 중앙). 멀 때만 표시.
const ARROW_SHOW_DIST = 300;  // 이 거리(m) 이상이면 방향 화살표 표시

function makeArrow(leftPercent) {
  const wrap = document.createElement('div');
  wrap.style.cssText =
    'position:fixed;top:24px;left:' + leftPercent + '%;transform:translateX(-50%);' +
    'text-align:center;color:#ffd24a;font-family:system-ui,monospace;font-weight:700;' +
    'text-shadow:0 1px 3px rgba(0,0,0,0.8);pointer-events:none;z-index:10;white-space:nowrap';
  const arrow = document.createElement('div');
  arrow.textContent = '➤';                       // 기본 오른쪽 향함 → 회전으로 방향 지정
  arrow.style.cssText = 'font-size:34px;line-height:1;transition:transform 0.05s linear';
  const label = document.createElement('div');
  label.style.cssText = 'font-size:13px;margin-top:2px';
  wrap.appendChild(arrow);
  wrap.appendChild(label);
  document.body.appendChild(wrap);
  return { wrap, arrow, label };
}

// 각 절반 화면 중앙 조준점(+) — 기관총 조준 기준. 고정 표시.
function makeCrosshair(leftPercent) {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;top:50%;left:' + leftPercent + '%;transform:translate(-50%,-50%);' +
    'color:rgba(255,255,255,0.7);font-family:monospace;font-size:30px;line-height:1;' +
    'pointer-events:none;z-index:9;text-shadow:0 0 3px rgba(0,0,0,0.9)';
  el.textContent = '+';
  document.body.appendChild(el);
  return el;
}

export function createHud() {
  const left = makePanel(25);   // 좌측 절반 중앙(하단)
  const right = makePanel(75);  // 우측 절반 중앙(하단)
  const arrowL = makeArrow(25); // 좌측 상단 방향 화살표
  const arrowR = makeArrow(75);
  const warnL = makeWarn(25);   // 좌/우 피락온 경고
  const warnR = makeWarn(75);
  makeCrosshair(25);            // 좌/우 조준점(고정)
  makeCrosshair(75);
  let blink = 0;                // 락온 완료 경고 깜빡임 위상

  function render(panel, state) {
    const { gun, launcher, dispenser, hp } = normalize(state);
    const hpLine = fmtHp(hp);
    const line1 = fmtGun(gun);
    const line2 = fmtMissile(launcher, dispenser);
    const lines = [hpLine, line1, line2].filter((s) => s);
    panel.innerHTML = lines.join('<br>');
  }

  // 방향 화살표: target.angle(rad, 0=정면/위, +=오른쪽)만큼 회전. 멀 때만 표시.
  function renderArrow(ind, state) {
    const { target } = normalize(state);
    if (!target || target.distance < ARROW_SHOW_DIST) {
      ind.wrap.style.display = 'none';
      return;
    }
    ind.wrap.style.display = 'block';
    // 기본 글리프 '➤'가 오른쪽(+90°)을 향하므로, 위(0°)=정면 기준으로 -90° 보정.
    const deg = (target.angle * 180) / Math.PI - 90;
    ind.arrow.style.transform = `rotate(${deg}deg)`;
    ind.label.textContent = `상대 ${Math.round(target.distance)}m`;
  }

  // 피락온 경고: lockedBy.locked면 빨강 깜빡 "미사일 락!", locking이면 노랑 "락온 경고".
  function renderWarn(el, state) {
    const { lockedBy } = normalize(state);
    if (!lockedBy || (!lockedBy.locked && !lockedBy.locking)) {
      el.style.display = 'none';
      return;
    }
    if (lockedBy.locked) {
      el.style.display = blink < 0.5 ? 'block' : 'none';  // 깜빡임
      el.style.color = '#ff3030';
      el.textContent = '🔴 미사일 락!';
    } else {
      el.style.display = 'block';
      el.style.color = '#ffd24a';
      el.textContent = '⚠️ 락온 경고';
    }
  }

  function update(p1, p2, dt = 0) {
    blink = (blink + dt) % 1;   // 0~1 깜빡임 위상(0.5s 주기)
    render(left, p1);
    render(right, p2);
    renderArrow(arrowL, p1);
    renderArrow(arrowR, p2);
    renderWarn(warnL, p1);
    renderWarn(warnR, p2);
  }

  return { update };
}
