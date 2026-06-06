// terrain.js 단위 테스트 (M3 — 고정 설계맵 지형, 순수 로직)
//
// 설계 근거: mds/design/m3-terrain.md (§3 순수 지형, §6 테스트 가이드)
//
// === 가정한 시그니처/데이터 (설계 §3.2 ~ §3.6, §4.2) ===
//   export const FEATURES   — 봉우리 배열. 각 원소 { type, cx, cz, radius, height }.
//                             type ∈ {'island','mountain','peak'}.
//   export const BRIDGES    — 다리(능선 띠) 배열. 각 원소 { ax, az, bx, bz, halfWidth, height }.
//   export const CRASH_MARGIN          — 기본 충돌 margin(=3, 설계 §3.5).
//   export const MAX_TERRAIN_HEIGHT    — 가장 큰 peak.height(≈900, 설계 §3.6).
//   export function heightAt(x, z) -> number          — 지형 높이(바다=0, 항상 ≥0).
//   export function terrainCollision(x, y, z, margin?) -> bool
//        — y-margin ≤ 0(수면) 또는 y-margin ≤ heightAt(지형) 이면 true.
//   export function isInsideTerrain(x, y, z, margin?) -> bool
//        — 수면 제외, 지형 표면 아래/내부만 true (y-margin ≤ heightAt).
//   export function heightToColorHex(h) -> int        — 고도색 hex 정수(설계 §4.2).
//
// 합성식(설계 §3.3): 각 봉우리/다리 기여의 max.
//   가우시안 봉우리:  h = height * exp(-d² / (2σ²)),  σ = radius/2
//   다리(능선 띠):    선분까지 최단거리 기반 가우시안,  σ = halfWidth
//
// 봉우리 좌표는 import한 FEATURES/BRIDGES 데이터에서 직접 가져와 단언한다
// (좌표 하드코딩 회피 — 데이터가 SSoT). 일부 케이스는 설계 §3.2 값을 참조해 명시.
//
// 허용오차: 가우시안 비교는 부등식/상대비교 위주, 동치는 toBeCloseTo(1e-6).

import { describe, it, expect } from 'vitest';
import { WORLD_HALF, CEILING, SPAWN_Y } from './flight.js';
import {
  FEATURES,
  BRIDGES,
  CRASH_MARGIN,
  MAX_TERRAIN_HEIGHT,
  heightAt,
  terrainCollision,
  isInsideTerrain,
  heightToColorHex,
} from './terrain.js';

// 설계 §3.3 가우시안 봉우리 기대 높이(검증식 — 구현과 독립적으로 산출)
function expectedFeatureHeight(x, z, f) {
  const sigma = f.radius / 2;
  const dx = x - f.cx, dz = z - f.cz;
  const d2 = dx * dx + dz * dz;
  return f.height * Math.exp(-d2 / (2 * sigma * sigma));
}

// 봉우리에서 충분히 먼 "빈 바다" 좌표 하나 (모든 feature/bridge에서 멀리).
// 경계 근처 한 모서리 — 설계 데이터의 봉우리는 |coord| ≲ 900 영역에 몰려 있다.
const OPEN_SEA = { x: 1900, z: 1900 };

describe('terrain 데이터(FEATURES / BRIDGES)', () => {
  it('FEATURES는 비어있지 않고, 필수 키를 가진다', () => {
    expect(Array.isArray(FEATURES)).toBe(true);
    expect(FEATURES.length).toBeGreaterThan(0);
    for (const f of FEATURES) {
      expect(typeof f.cx).toBe('number');
      expect(typeof f.cz).toBe('number');
      expect(f.radius).toBeGreaterThan(0);
      expect(f.height).toBeGreaterThan(0);
    }
  });

  it('섬 여러 개 + 고산(peak) 1~2개를 포함한다(명세)', () => {
    const islands = FEATURES.filter((f) => f.type === 'island');
    const peaks = FEATURES.filter((f) => f.type === 'peak');
    expect(islands.length).toBeGreaterThanOrEqual(2); // "섬 여러 개"
    expect(peaks.length).toBeGreaterThanOrEqual(1);    // 고산 1~2개
    expect(peaks.length).toBeLessThanOrEqual(2);
  });

  it('BRIDGES는 비어있지 않고, 끝점/폭/높이 키를 가진다(다리 모양 지형)', () => {
    expect(Array.isArray(BRIDGES)).toBe(true);
    expect(BRIDGES.length).toBeGreaterThan(0);
    for (const b of BRIDGES) {
      expect(typeof b.ax).toBe('number');
      expect(typeof b.az).toBe('number');
      expect(typeof b.bx).toBe('number');
      expect(typeof b.bz).toBe('number');
      expect(b.halfWidth).toBeGreaterThan(0);
      expect(b.height).toBeGreaterThan(0);
    }
  });

  it('모든 봉우리 중심·다리 끝점이 월드 경계(±WORLD_HALF) 안에 있다(설계 §6-6)', () => {
    for (const f of FEATURES) {
      expect(Math.abs(f.cx)).toBeLessThanOrEqual(WORLD_HALF);
      expect(Math.abs(f.cz)).toBeLessThanOrEqual(WORLD_HALF);
    }
    for (const b of BRIDGES) {
      expect(Math.abs(b.ax)).toBeLessThanOrEqual(WORLD_HALF);
      expect(Math.abs(b.az)).toBeLessThanOrEqual(WORLD_HALF);
      expect(Math.abs(b.bx)).toBeLessThanOrEqual(WORLD_HALF);
      expect(Math.abs(b.bz)).toBeLessThanOrEqual(WORLD_HALF);
    }
  });
});

describe('heightAt — 기본 성질', () => {
  it('바다(봉우리에서 충분히 먼 곳)에서는 ≈0 (< 1)', () => {
    const h = heightAt(OPEN_SEA.x, OPEN_SEA.z);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(1);
  });

  it('어떤 봉우리 중심에서도 높이 > 0 이며 그 봉우리 height 근처', () => {
    // peak 한 개를 골라 중심에서 heightAt이 그 height에 근접(d=0 → ≈height)
    const peak = FEATURES.find((f) => f.type === 'peak');
    const h = heightAt(peak.cx, peak.cz);
    expect(h).toBeGreaterThan(0);
    // 같은 섬에 겹친 더 큰 성분이 없는 한 ≈ peak.height (max 합성이므로 ≥)
    expect(h).toBeGreaterThanOrEqual(peak.height * 0.99);
  });

  it('각 island 중심에서 높이 > 0 (섬이 바다 위로 솟음)', () => {
    for (const f of FEATURES.filter((x) => x.type === 'island')) {
      expect(heightAt(f.cx, f.cz)).toBeGreaterThan(0);
    }
  });

  it('고산(peak) 중심 높이 > 일반 산(mountain) 중심 높이', () => {
    const peak = FEATURES.find((f) => f.type === 'peak');
    // peak와 다른 영역의 mountain을 비교 (서로 겹치지 않는 mountain 선택)
    const mountain = FEATURES.find(
      (f) => f.type === 'mountain' &&
        Math.hypot(f.cx - peak.cx, f.cz - peak.cz) > Math.max(f.radius, peak.radius),
    ) || FEATURES.find((f) => f.type === 'mountain');
    expect(heightAt(peak.cx, peak.cz)).toBeGreaterThan(heightAt(mountain.cx, mountain.cz));
  });

  it('중심에서 멀어지면 단조 감소(가우시안) — 중심 > 중간 > 외곽', () => {
    // 다른 봉우리 간섭이 적은 island #4 (원점 근처, 설계 §3.2 cx:-200 cz:400 r:300) 사용
    const f = FEATURES.find((x) => x.type === 'island' && x.cx === -200 && x.cz === 400)
      || FEATURES.find((x) => x.type === 'island');
    const dirX = 1, dirZ = 0; // +x 방향으로 샘플 (다른 봉우리에서 멀어지는 방향)
    const r = f.radius;
    const hCenter = expectedFeatureHeight(f.cx, f.cz, f);
    const hMid = expectedFeatureHeight(f.cx + dirX * r * 0.5, f.cz + dirZ * r * 0.5, f);
    const hOuter = expectedFeatureHeight(f.cx + dirX * r * 1.5, f.cz + dirZ * r * 1.5, f);
    // 단일 봉우리 기여 자체의 단조성(검증식)
    expect(hCenter).toBeGreaterThan(hMid);
    expect(hMid).toBeGreaterThan(hOuter);
    // heightAt도 중심이 멀리보다 큼
    expect(heightAt(f.cx, f.cz)).toBeGreaterThan(
      heightAt(f.cx + dirX * r * 1.5, f.cz + dirZ * r * 1.5),
    );
  });

  it('월드 밖 좌표도 안전(유한, ≈0, throw 없음)', () => {
    const h1 = heightAt(9999, 9999);
    const h2 = heightAt(-50000, 12345);
    expect(Number.isFinite(h1)).toBe(true);
    expect(Number.isFinite(h2)).toBe(true);
    expect(h1).toBeGreaterThanOrEqual(0);
    expect(h1).toBeLessThan(1);
    expect(h2).toBeLessThan(1);
  });

  it('결정론 — 같은 (x,z) 2회 호출 결과 동일', () => {
    expect(heightAt(123, -456)).toBe(heightAt(123, -456));
    const peak = FEATURES.find((f) => f.type === 'peak');
    expect(heightAt(peak.cx, peak.cz)).toBe(heightAt(peak.cx, peak.cz));
  });

  it('임의 점 스윕 — 모두 유한·≥0', () => {
    for (let x = -WORLD_HALF; x <= WORLD_HALF; x += 311) {
      for (let z = -WORLD_HALF; z <= WORLD_HALF; z += 337) {
        const h = heightAt(x, z);
        expect(Number.isFinite(h)).toBe(true);
        expect(h).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('heightAt — 다리(능선 띠)', () => {
  it('다리 두 끝점 중간점에서 높이 > 0 (다리 height 근처)', () => {
    const b = BRIDGES[0];
    const mx = (b.ax + b.bx) / 2, mz = (b.az + b.bz) / 2;
    expect(heightAt(mx, mz)).toBeGreaterThan(0);
  });

  it('다리 옆(halfWidth*3 만큼 수직 이격)에서 급감', () => {
    const b = BRIDGES[0];
    const mx = (b.ax + b.bx) / 2, mz = (b.az + b.bz) / 2;
    // 선분 방향 단위벡터 → 그 수직 방향으로 이격
    const vx = b.bx - b.ax, vz = b.bz - b.az;
    const len = Math.hypot(vx, vz) || 1;
    const nx = -vz / len, nz = vx / len; // 수직 단위벡터
    const off = b.halfWidth * 3;
    const onBridge = heightAt(mx, mz);
    const besideBridge = heightAt(mx + nx * off, mz + nz * off);
    expect(besideBridge).toBeLessThan(onBridge);
  });
});

describe('terrainCollision — 충돌 질의', () => {
  it('봉우리 위 충분한 고도(peak 중심, y=CEILING)면 false', () => {
    const peak = FEATURES.find((f) => f.type === 'peak');
    expect(terrainCollision(peak.cx, CEILING, peak.cz)).toBe(false);
  });

  it('봉우리 내부(peak 중심, y=0 표면 아래)면 true', () => {
    const peak = FEATURES.find((f) => f.type === 'peak');
    // y=10 (heightAt 수백 m 보다 훨씬 아래) → 파묻힘
    expect(terrainCollision(peak.cx, 10, peak.cz)).toBe(true);
  });

  it('수면 아래/접촉(섬 밖 바다, y ≤ 0)이면 true (수면 충돌 포함)', () => {
    expect(terrainCollision(OPEN_SEA.x, 0, OPEN_SEA.z)).toBe(true);    // y=0 접촉
    expect(terrainCollision(OPEN_SEA.x, -5, OPEN_SEA.z)).toBe(true);   // y<0
    expect(terrainCollision(0, 0, 0)).toBe(true);                       // 원점 수면
  });

  it('높은 공중 바다 위(섬 밖, y=500)면 false', () => {
    expect(terrainCollision(OPEN_SEA.x, 500, OPEN_SEA.z)).toBe(false);
  });

  it('margin 경계 — 표면 높이 H에서 y = H+margin±0.1 의 경계 정확', () => {
    // 봉우리 위가 아닌 바다 위 지점에서 수면 충돌 경계를 검사(H=0).
    const margin = CRASH_MARGIN;
    // 수면(H=0): y - margin ≤ 0 → 충돌. 경계는 y = margin.
    expect(terrainCollision(OPEN_SEA.x, margin + 0.1, OPEN_SEA.z)).toBe(false);
    expect(terrainCollision(OPEN_SEA.x, margin - 0.1, OPEN_SEA.z)).toBe(true);
  });

  it('margin 경계 — 지형 표면 위. 커스텀 margin 동작', () => {
    const peak = FEATURES.find((f) => f.type === 'peak');
    const H = heightAt(peak.cx, peak.cz);
    const m = 5;
    expect(terrainCollision(peak.cx, H + m + 0.1, peak.cz, m)).toBe(false);
    expect(terrainCollision(peak.cx, H + m - 0.1, peak.cz, m)).toBe(true);
  });

  it('기본 margin은 CRASH_MARGIN(미지정 시 동일 결과)', () => {
    const peak = FEATURES.find((f) => f.type === 'peak');
    const H = heightAt(peak.cx, peak.cz);
    const y = H + CRASH_MARGIN + 50;
    expect(terrainCollision(peak.cx, y, peak.cz)).toBe(
      terrainCollision(peak.cx, y, peak.cz, CRASH_MARGIN),
    );
  });

  it('스폰 안전 — flight 스폰 좌표/고도(SPAWN_Y)에서 충돌 false(즉사 없음)', () => {
    // M4 스폰 좌표 후보 (설계 §5.3: x/z = ±100·±300, y=SPAWN_Y)
    const spawns = [
      { x: 100, z: 300 }, { x: -100, z: 300 },
      { x: 100, z: -300 }, { x: -100, z: -300 },
      { x: 300, z: 100 }, { x: -300, z: -100 },
    ];
    for (const s of spawns) {
      // 스폰 고도가 그 지점 지형보다 충분히 높아야 함
      expect(heightAt(s.x, s.z)).toBeLessThan(SPAWN_Y);
      expect(terrainCollision(s.x, SPAWN_Y, s.z)).toBe(false);
    }
  });

  it('순수성 — 동일 입력 동일 출력', () => {
    const peak = FEATURES.find((f) => f.type === 'peak');
    expect(terrainCollision(peak.cx, 200, peak.cz)).toBe(
      terrainCollision(peak.cx, 200, peak.cz),
    );
  });
});

describe('isInsideTerrain — 수면 제외 버전', () => {
  it('지형 표면 아래(peak 중심 저고도)는 true', () => {
    const peak = FEATURES.find((f) => f.type === 'peak');
    expect(isInsideTerrain(peak.cx, 10, peak.cz)).toBe(true);
  });

  it('바다 위 낮은 공중(섬 밖, y=5)은 false (수면은 제외)', () => {
    expect(isInsideTerrain(0, 5, 0)).toBe(false);
    expect(isInsideTerrain(OPEN_SEA.x, 5, OPEN_SEA.z)).toBe(false);
  });

  it('봉우리 위 높은 공중은 false', () => {
    const peak = FEATURES.find((f) => f.type === 'peak');
    expect(isInsideTerrain(peak.cx, CEILING, peak.cz)).toBe(false);
  });
});

describe('heightToColorHex — 고도색 구간', () => {
  it('항상 유효한 정수 hex(0 ~ 0xffffff) 반환', () => {
    for (const h of [-10, 0, 0.5, 30, 100, 200, 400, 700, 900, 5000]) {
      const c = heightToColorHex(h);
      expect(Number.isInteger(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(0xffffff);
    }
  });

  it('임계 양쪽에서 색이 달라진다(구간 구분)', () => {
    // 모래(물가) → 풀 → ... → 설산. 설계 §4.2 임계값 양쪽 비교.
    expect(heightToColorHex(0)).not.toBe(heightToColorHex(30));    // 모래 ≠ 풀
    expect(heightToColorHex(30)).not.toBe(heightToColorHex(500));  // 풀 ≠ 회색바위
    expect(heightToColorHex(500)).not.toBe(heightToColorHex(900)); // 바위 ≠ 설산
  });

  it('물가/저지대 색과 고산 정상 색이 다르다(랜드마크 단계)', () => {
    expect(heightToColorHex(0)).not.toBe(heightToColorHex(900));
  });
});

describe('상수', () => {
  it('CRASH_MARGIN은 양수', () => {
    expect(CRASH_MARGIN).toBeGreaterThan(0);
  });

  it('MAX_TERRAIN_HEIGHT는 가장 큰 봉우리 height 이상', () => {
    const maxH = Math.max(...FEATURES.map((f) => f.height), ...BRIDGES.map((b) => b.height));
    expect(MAX_TERRAIN_HEIGHT).toBeGreaterThanOrEqual(maxH * 0.99);
  });
});
