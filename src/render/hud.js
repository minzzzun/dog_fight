// render/hud.js (M9) — 분할 화면 HUD (폴리시: 체력바 + 정돈 레이아웃)
//
// 각 절반(좌 P1 / 우 P2)에 DOM 오버레이로 그린다. THREE 씬과 무관.
//   - 하단: 체력바 + 무기 상태(기관총/미사일/플레어 잔량·재장전 남은시간·락온)
//   - 상단: 상대 방향 화살표(+거리), 피락온 경고
//   - 중앙: 조준점, (별도 모듈) 록온 사각
// update(p1, p2, dt): p1/p2 = { gun, launcher, dispenser, hp, target, lockedBy }
import { LOCK_TIME, MISSILE_REGEN, MISSILE_AMMO } from '../weapons/missile.js';
import { FLARE_REGEN, FLARE_AMMO } from '../weapons/flare.js';
import { MAX_HP } from '../combat.js';

// ── 하단 상태 패널(체력바 + 무기) ────────────────────────────────────
function makeStatus(leftPercent) {
  const wrap = document.createElement('div');
  wrap.style.cssText =
    'position:fixed;bottom:16px;left:' + leftPercent + '%;transform:translateX(-50%);' +
    'display:flex;flex-direction:column;align-items:center;gap:6px;' +
    'font-family:system-ui,monospace;pointer-events:none;z-index:10;white-space:nowrap';

  // 체력바(테두리 + 채움 + 숫자)
  const barOuter = document.createElement('div');
  barOuter.style.cssText =
    'width:240px;height:18px;border:2px solid rgba(255,255,255,0.85);border-radius:4px;' +
    'background:rgba(0,0,0,0.45);overflow:hidden;position:relative';
  const barFill = document.createElement('div');
  barFill.style.cssText = 'height:100%;width:100%;background:#3ad13a;transition:width 0.15s linear';
  const barText = document.createElement('div');
  barText.style.cssText =
    'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
    'font-size:12px;font-weight:800;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.9)';
  barOuter.appendChild(barFill);
  barOuter.appendChild(barText);

  // 무기 한 줄
  const weapons = document.createElement('div');
  weapons.style.cssText =
    'font-size:15px;font-weight:700;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.85)';

  wrap.appendChild(barOuter);
  wrap.appendChild(weapons);
  document.body.appendChild(wrap);
  return { barFill, barText, weapons };
}

function hpColor(frac) {
  if (frac > 0.5) return '#3ad13a';   // 초록
  if (frac > 0.25) return '#ffcc33';  // 노랑
  return '#ff3b30';                   // 빨강
}

function fmtGun(gun) {
  if (!gun) return '';
  return gun.reloading ? '🔫 재장전…' : `🔫 ${gun.ammo}/100`;
}

function fmtMissile(launcher) {
  if (!launcher) return '';
  let lock;
  if (launcher.locked) lock = '🔒';
  else if (launcher.lockTimer > 0) lock = `락온 ${Math.min(100, Math.round((launcher.lockTimer / LOCK_TIME) * 100))}%`;
  else lock = '';
  const reload = launcher.ammo < MISSILE_AMMO
    ? `↻${Math.ceil(MISSILE_REGEN - (launcher.regenTimer ?? 0))}s` : '';
  return `🚀 ${launcher.ammo}${reload ? ' ' + reload : ''}${lock ? '  ' + lock : ''}`;
}

function fmtFlare(dispenser) {
  if (!dispenser) return '';
  const reload = dispenser.ammo < FLARE_AMMO
    ? `↻${Math.ceil(FLARE_REGEN - (dispenser.regenTimer ?? 0))}s` : '';
  return `✦ ${dispenser.ammo}${reload ? ' ' + reload : ''}`;
}

// ── 상대 방향 화살표 ─────────────────────────────────────────────────
const ARROW_SHOW_DIST = 300;

function makeArrow(leftPercent) {
  const wrap = document.createElement('div');
  wrap.style.cssText =
    'position:fixed;top:24px;left:' + leftPercent + '%;transform:translateX(-50%);' +
    'text-align:center;color:#ffd24a;font-family:system-ui,monospace;font-weight:700;' +
    'text-shadow:0 1px 3px rgba(0,0,0,0.8);pointer-events:none;z-index:10;white-space:nowrap';
  const arrow = document.createElement('div');
  arrow.textContent = '➤';
  arrow.style.cssText = 'font-size:34px;line-height:1;transition:transform 0.05s linear';
  const label = document.createElement('div');
  label.style.cssText = 'font-size:13px;margin-top:2px';
  wrap.appendChild(arrow);
  wrap.appendChild(label);
  document.body.appendChild(wrap);
  return { wrap, arrow, label };
}

// ── 피락온 경고 ──────────────────────────────────────────────────────
function makeWarn(leftPercent) {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;top:78px;left:' + leftPercent + '%;transform:translateX(-50%);' +
    'font-family:system-ui,monospace;font-weight:800;font-size:20px;' +
    'text-shadow:0 1px 4px rgba(0,0,0,0.9);pointer-events:none;z-index:12;display:none';
  document.body.appendChild(el);
  return el;
}

// ── 경계 이탈 경고(각 절반 상단, 경고들 위) ──────────────────────────
function makeBounds(leftPercent) {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;top:108px;left:' + leftPercent + '%;transform:translateX(-50%);' +
    'color:#ff8a3a;font-family:system-ui,monospace;font-weight:800;font-size:18px;' +
    'text-shadow:0 1px 4px rgba(0,0,0,0.9);pointer-events:none;z-index:12;display:none';
  el.textContent = '🧭 경계 이탈 — 복귀 중';
  document.body.appendChild(el);
  return el;
}

// ── 중앙 조준점 ──────────────────────────────────────────────────────
function makeCrosshair(leftPercent) {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;top:50%;left:' + leftPercent + '%;transform:translate(-50%,-50%);' +
    'color:rgba(255,255,255,0.7);font-family:monospace;font-size:30px;line-height:1;' +
    'pointer-events:none;z-index:9;text-shadow:0 0 3px rgba(0,0,0,0.9)';
  el.textContent = '+';
  document.body.appendChild(el);
}

export function createHud() {
  const statusL = makeStatus(25);
  const statusR = makeStatus(75);
  const arrowL = makeArrow(25);
  const arrowR = makeArrow(75);
  const warnL = makeWarn(25);
  const warnR = makeWarn(75);
  const boundsL = makeBounds(25);
  const boundsR = makeBounds(75);
  makeCrosshair(25);
  makeCrosshair(75);
  let blink = 0;

  function renderStatus(s, state) {
    // 체력바
    const hp = typeof state?.hp === 'number' ? state.hp : MAX_HP;
    const frac = Math.max(0, Math.min(1, hp / MAX_HP));
    s.barFill.style.width = `${frac * 100}%`;
    s.barFill.style.background = hpColor(frac);
    s.barText.textContent = `${Math.max(0, Math.round(hp))} / ${MAX_HP}`;
    // 무기 한 줄
    const parts = [fmtGun(state?.gun), fmtMissile(state?.launcher), fmtFlare(state?.dispenser)].filter(Boolean);
    s.weapons.textContent = parts.join('   ');
  }

  function renderArrow(ind, state) {
    const target = state?.target;
    if (!target || target.distance < ARROW_SHOW_DIST) { ind.wrap.style.display = 'none'; return; }
    ind.wrap.style.display = 'block';
    const deg = (target.angle * 180) / Math.PI - 90;
    ind.arrow.style.transform = `rotate(${deg}deg)`;
    ind.label.textContent = `상대 ${Math.round(target.distance)}m`;
  }

  function renderWarn(el, state) {
    const lb = state?.lockedBy;
    if (!lb || (!lb.locked && !lb.locking)) { el.style.display = 'none'; return; }
    if (lb.locked) {
      el.style.display = blink < 0.5 ? 'block' : 'none';
      el.style.color = '#ff3030';
      el.textContent = '🔴 미사일 락!';
    } else {
      el.style.display = 'block';
      el.style.color = '#ffd24a';
      el.textContent = '⚠️ 락온 경고';
    }
  }

  function update(p1, p2, dt = 0) {
    blink = (blink + dt) % 1;
    renderStatus(statusL, p1);
    renderStatus(statusR, p2);
    renderArrow(arrowL, p1);
    renderArrow(arrowR, p2);
    renderWarn(warnL, p1);
    renderWarn(warnR, p2);
    boundsL.style.display = p1 && p1.bounds ? 'block' : 'none';
    boundsR.style.display = p2 && p2.bounds ? 'block' : 'none';
  }

  return { update };
}
