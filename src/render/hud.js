// render/hud.js (M5/M6) — 분할 화면 HUD (현재: 탄약/재장전 + 미사일 잔량/락온; M9에서 체력·플레어 확장)
//
// 좌(P1)/우(P2) 각 절반 하단 중앙에 텍스트 패널을 띄운다. DOM 오버레이라
// THREE 씬과 무관하게 그려진다. update(p1, p2)로 매 프레임 갱신.
//   p1/p2 = { gun, launcher } — gun(M5 총기 상태), launcher(M6 런처 상태).
//   하위호환: update(gun1, gun2)처럼 gun 객체를 직접 넘겨도 동작(launcher만 생략).

import { LOCK_TIME } from '../weapons/missile.js';

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

// 런처 잔량 + 락온 상태 한 줄. launcher 없으면 빈 문자열.
function fmtMissile(launcher) {
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
  return `🚀 ${launcher.ammo}   ${lock}`;
}

// 인자 정규화: { gun, launcher, target } 또는 gun 객체 직접 전달 모두 수용.
function normalize(state) {
  if (!state) return { gun: null, launcher: null, target: null };
  if (state.gun || state.launcher || state.target) {
    return { gun: state.gun || null, launcher: state.launcher || null, target: state.target || null };
  }
  return { gun: state, launcher: null, target: null };  // 하위호환: gun 객체 직접
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

export function createHud() {
  const left = makePanel(25);   // 좌측 절반 중앙(하단)
  const right = makePanel(75);  // 우측 절반 중앙(하단)
  const arrowL = makeArrow(25); // 좌측 상단 방향 화살표
  const arrowR = makeArrow(75);

  function render(panel, state) {
    const { gun, launcher } = normalize(state);
    const line1 = fmtGun(gun);
    const line2 = fmtMissile(launcher);
    panel.innerHTML = line2 ? `${line1}<br>${line2}` : line1;
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

  function update(p1, p2) {
    render(left, p1);
    render(right, p2);
    renderArrow(arrowL, p1);
    renderArrow(arrowR, p2);
  }

  return { update };
}
