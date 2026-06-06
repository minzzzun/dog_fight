// terrain.js (M3) — 고정 설계맵 지형 (순수 로직, Three.js 비의존)
//
// 좌표 규약(M1 정합): x,z ∈ [-WORLD_HALF, WORLD_HALF](±2000m), 수면 y=0, +Y up.
//   heightAt(x,z)는 봉우리/다리 가우시안 기여의 max → 섬 밖 바다는 0, 월드 밖도 ≈0.
//   난수/시간 미사용 → 결정론. 같은 (x,z)면 항상 같은 값.
//
// 설계 근거: mds/design/m3-terrain.md (§3 순수 지형, §4.2 고도색).

// ── 맵 데이터 (명시적 상수 — 고정·결정론) ───────────────────────────────
//
// 봉우리 종류:
//   'island'   — 낮고 넓은 가우시안 둔덕(물가 모래~풀). 회피 기준점.
//   'mountain' — 가우시안 산(중간 높이). 엄폐 활용.
//   'peak'     — 고산(높이 큰 가우시안, 1~2개). 시각 랜드마크 + 강한 엄폐.
// 가우시안 봉우리: h = height * exp(-d² / (2σ²)),  σ = radius/2
//
// 배치 원칙: 모두 경계(±2000) 안. 산/고산은 같은 섬 중심에 겹쳐 둬 "섬 위에
// 산이 솟은" 자연 실루엣을 만든다(합성이 max라 가장 높은 성분이 정상 결정).
// 스폰 근처(원점 부근 ±100·±300)엔 큰 봉우리를 두지 않아 스폰 즉사 방지.

export const FEATURES = [
  // ── 섬(낮고 넓음) ──
  { type: 'island',   cx: -700, cz: -600, radius: 520, height:  70 },
  { type: 'island',   cx:  650, cz:  700, radius: 600, height:  85 },
  { type: 'island',   cx:  900, cz: -800, radius: 380, height:  55 },
  { type: 'island',   cx: -200, cz:  400, radius: 300, height:  45 },
  // ── 산(중간) ──
  { type: 'mountain', cx: -750, cz: -550, radius: 280, height: 320 }, // 섬1 위 산
  { type: 'mountain', cx:  700, cz:  650, radius: 320, height: 380 }, // 섬2 위 산
  { type: 'mountain', cx: -100, cz: -900, radius: 260, height: 300 },
  // ── 고산(1~2개, 시각 랜드마크) ──
  { type: 'peak',     cx:  620, cz:  720, radius: 360, height: 900 }, // 섬2 정상 고산
  { type: 'peak',     cx: -780, cz: -560, radius: 300, height: 720 }, // 섬1 정상 고산
];

// 다리(능선 띠) — 두 섬을 잇는 가는 고지대. 선분(a→b)까지 거리로 가우시안.
//   원점·스폰 구역(±100·±300 부근)을 가로지르지 않도록 바깥 섬들끼리 잇는다
//   (스폰 즉사 방지 + 빈 바다/원점은 heightAt≈0 유지).
export const BRIDGES = [
  // 섬1 ↔ 섬3 (둘 다 -z 영역) — z≈-700 띠, 원점에서 멀다
  { ax: -700, az: -600, bx: 900, bz: -800, halfWidth: 60, height: 160 },
  // 섬2 ↔ 섬3 (+x 가장자리) 짧은 다리(엄폐용 통로)
  { ax:  650, az:  700, bx: 900, bz: -800, halfWidth: 50, height: 130 },
];

// ── 충돌/색 상수 ─────────────────────────────────────────────────────
export const CRASH_MARGIN = 3;   // 기체 반경 근사(m) — 표면에 이만큼 닿아도 충돌

// 색 단계/그리드 y범위·테스트 상한에 활용 (가장 큰 peak.height).
export const MAX_TERRAIN_HEIGHT = 900;

// ── 내부 보조 함수 ───────────────────────────────────────────────────

// 점(cx,cz)에서의 거리²(sqrt 회피, σ² 분모와 직접 비교)
function dist2(x, z, cx, cz) {
  const dx = x - cx, dz = z - cz;
  return dx * dx + dz * dz;
}

// 가우시안 봉우리 높이
function featureHeight(x, z, f) {
  const sigma = f.radius / 2;
  const d2 = dist2(x, z, f.cx, f.cz);
  return f.height * Math.exp(-d2 / (2 * sigma * sigma));
}

// 선분(a→b)까지 최단거리² → 가우시안 띠(다리)
function bridgeHeight(x, z, b) {
  const vx = b.bx - b.ax, vz = b.bz - b.az;
  const wx = x - b.ax,    wz = z - b.az;
  const len2 = vx * vx + vz * vz || 1;
  let t = (wx * vx + wz * vz) / len2;       // 선분 투영 매개변수
  t = t < 0 ? 0 : t > 1 ? 1 : t;            // [0,1] 클램프(끝점 캡)
  const px = b.ax + t * vx, pz = b.az + t * vz;
  const d2 = dist2(x, z, px, pz);
  const sigma = b.halfWidth;                // 띠 폭(가는 능선)
  return b.height * Math.exp(-d2 / (2 * sigma * sigma));
}

// ── heightAt — 지형 높이 합성 (max) ──────────────────────────────────
//
// 각 봉우리/다리 기여의 최댓값을 택한다(합이 아닌 max → 겹친 섬+산이 과대
// 누적되지 않고 가장 높은 지형이 표면을 결정, 물가는 자연히 0으로 떨어짐).

export function heightAt(x, z) {
  let h = 0;                                // 바다(섬 밖) = 0
  for (const f of FEATURES)  h = Math.max(h, featureHeight(x, z, f));
  for (const b of BRIDGES)   h = Math.max(h, bridgeHeight(x, z, b));
  return h;                                 // 항상 ≥ 0, 월드 밖이면 d 큼 → ≈0
}

// ── 충돌 질의 ────────────────────────────────────────────────────────
//
// 기체를 점 + margin(반경)으로 근사. 지형 표면 아래(파묻힘) 또는 수면 아래면 충돌.
// M8 전투가 충돌 즉사 판정에 사용.

// 점(x,y,z)이 지형/수면에 충돌했는가. (수면 y≤0 포함)
export function terrainCollision(x, y, z, margin = CRASH_MARGIN) {
  if (y - margin <= 0) return true;               // 수면 충돌(해수면 포함)
  if (y - margin <= heightAt(x, z)) return true;  // 지형 표면 충돌
  return false;
}

// 수면 제외 버전 — 점이 지형 표면 아래/내부인가.
export function isInsideTerrain(x, y, z, margin = CRASH_MARGIN) {
  return y - margin <= heightAt(x, z);
}

// ── 고도색 (순수, 정수 hex 반환) ─────────────────────────────────────
//
// 물가 모래 → 풀 → 바위 → 설산. 고산 900m까지 → driving_game보다 임계값 확대.

export function heightToColorHex(h) {
  if      (h <   2) return 0x1e6fb0; // 물(바다·저지대 평탄부) — 단일 표면 물색
  else if (h <   6) return 0xd9c48a; // 물가 모래(해안)
  else if (h <  60) return 0x3f9c35; // 풀(섬 평지)
  else if (h < 180) return 0x2f7a2a; // 진한 풀(산기슭)
  else if (h < 380) return 0x7a6b52; // 바위(산)
  else if (h < 650) return 0x8a8378; // 회색 바위(고지)
  else              return 0xfafafa; // 설산(고산 정상)
}
