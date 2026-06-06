// render/hud.js (M5) — 분할 화면 HUD (현재: 탄약/재장전만; M9에서 체력·미사일·플레어 확장)
//
// 좌(P1)/우(P2) 각 절반 하단 중앙에 텍스트 패널을 띄운다. DOM 오버레이라
// THREE 씬과 무관하게 그려진다. update(gun1, gun2)로 매 프레임 갱신.

function makePanel(leftPercent) {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;bottom:16px;left:' + leftPercent + '%;transform:translateX(-50%);' +
    'color:#fff;font-family:system-ui,monospace;font-size:18px;font-weight:700;' +
    'text-shadow:0 1px 3px rgba(0,0,0,0.8);pointer-events:none;z-index:10;white-space:nowrap';
  document.body.appendChild(el);
  return el;
}

function fmtGun(gun) {
  if (!gun) return '';
  if (gun.reloading) return '🔄 재장전…';
  return `🔫 ${gun.ammo} / 100`;
}

export function createHud() {
  const left = makePanel(25);   // 좌측 절반 중앙
  const right = makePanel(75);  // 우측 절반 중앙

  function update(gun1, gun2) {
    left.textContent = fmtGun(gun1);
    right.textContent = fmtGun(gun2);
  }

  return { update };
}
