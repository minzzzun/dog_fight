# 설계 — M3 고정 설계맵 지형 (terrain.js 순수 + terrainMesh 렌더)

> 상태: 설계 완료(구현 대기) · 작성: 2026-06-06
> 범위: 고정·결정론 설계맵을 만든다. **순수** `src/terrain.js`(`heightAt`/충돌 질의, THREE 비의존, Vitest 대상)와 **렌더** `src/render/terrainMesh.js`(섬·산·다리·해수면 메시)를 분리한다.
> SSoT는 `mds/spec/seed.md`(고정 설계맵: 바다 바닥 + 섬 여러 개 + 산(고산 1~2) + 다리 모양 지형, 지형/수면 충돌 즉사). 좌표/경계는 M1과 정합(`WORLD_HALF=2000`, `FLOOR=0`(수면 y=0), `CEILING=1500`, +Y up).

---

## 1. 목표와 비범위

### 목표 (이번 M3에서 만든다)
- 순수 `terrain.js`:
  - `heightAt(x, z) → number` — 해당 좌표의 지형 높이(수면 위 섬/산/다리 높이, 섬 밖 바다는 0). 월드 밖도 안전(0).
  - `terrainCollision(x, y, z, margin?) → bool` — 점(기체 근사) + margin이 지형 표면 아래(파묻힘) **또는** 수면 아래(y ≤ 0)이면 true. M8 전투가 충돌 즉사 판정에 사용.
  - 맵 데이터(봉우리/산/다리)를 **명시적 상수 배열**로 보유(결정론).
- 렌더 `terrainMesh.js`:
  - `heightAt` 기반 단일 고해상도 지형 메시(`PlaneGeometry` 그리드 정점 y=heightAt, 고도색 vertexColors).
  - 별도 반투명 해수면 평면(y=0).
- `main.js` 결선: M0/M4의 단순 바다 평면 + GridHelper를 `terrainMesh`로 대체/보강. 공유 씬 1개에 add(두 카메라 자동 노출).

### 비범위 (이후/타 마일스톤)
- 충돌 **즉사 처리**(폭발·HP·alive)는 M8 `combat.js`. M3는 충돌 **질의 함수**만 제공.
- 절차적/무한 청크 스트리밍 없음 — 월드가 4km(±2000)로 작으니 **단일 정적 메시 1장**으로 충분(권고).
- 물리 엔진 없음(seed CONSTRAINTS). heightAt은 닫힌형 수식(가우시안/원뿔)만 사용.
- 다리 아래로 비행기가 통과하는 진짜 아치 구조는 비범위(§3.4 단순화 — 다리는 솟은 능선 띠).

---

## 2. 파일 변경 요약

| 파일 | 변경 | 비고 |
|---|---|---|
| `src/terrain.js` | **신규** — 맵 데이터 + `heightAt` + `terrainCollision`/`isInsideTerrain` | THREE 비의존. Vitest 대상 |
| `src/terrain.test.js` | **신규** — 순수 지형/충돌 단위 테스트 | 콜로케이트(기존 `flight.test.js`/`input.test.js`와 동일 위치) |
| `src/render/terrainMesh.js` | **신규** — `buildTerrain()`(지형 메시) + `buildSea()`(해수면) | THREE 의존. 수동 검증 |
| `src/main.js` | **개편** — 바다 평면/GridHelper → `terrainMesh` 결선 | 좌표/카메라/비행은 M4 그대로 |

> 순수 로직(`terrain.js`)은 `import * as THREE` 금지. `{x,y,z}`/숫자/배열만 입출력. 색상 hex 정수만 반환(렌더가 `THREE.Color`로 래핑 — driving_game `heightToColorHex` 패턴).

---

## 3. 순수 지형 — `src/terrain.js`

### 3.1 좌표/경계 규약 (M1 정합)
- 월드 수평면: `x, z ∈ [-WORLD_HALF, WORLD_HALF]`(±2000m). 수면 y=0(=`FLOOR`). 천장 `CEILING=1500`.
- `heightAt`는 **월드 밖 좌표도 안전**해야 한다 → 수식이 거리 기반이라 자연히 0으로 수렴(바다). 명시 클램프는 불요하나 NaN 미발생 보장.
- M1 상수를 재선언하지 않고 의미만 정합(테스트에서 `flight.js`의 `WORLD_HALF`를 import해 데이터가 경계 안인지 검증).

### 3.2 맵 데이터 (명시적 상수 — 고정·결정론)
지형을 **봉우리(feature) 객체 배열**로 정의한다. 각 봉우리는 중심(cx, cz) + 반경 + 최대 높이 + 종류. 섬/산은 가우시안 또는 원뿔 봉우리, 다리는 두 지점을 잇는 선형(캡슐) 띠.

```js
// 봉우리 종류
//  'island' — 낮고 넓은 가우시안 둔덕(물가 모래~풀). 엄폐 약, 회피 기준점.
//  'mountain' — 가우시안 산(중간 높이). 엄폐 활용.
//  'peak' — 고산(높이 큰 가우시안, 1~2개). 시각 랜드마크 + 강한 엄폐.
//  'bridge' — 두 점을 잇는 가늘고 긴 능선 띠(선분까지 거리 기반). "다리 모양 지형".

// 가우시안 봉우리: h = height * exp( -d² / (2σ²) ),  σ = radius/2
// 원뿔(대안): h = height * max(0, 1 - d/radius)   — 더 뾰족
export const FEATURES = [
  // ── 섬(낮고 넓음) ──
  { type: 'island',   cx:  -700, cz:  -600, radius: 520, height:  70 },
  { type: 'island',   cx:   650, cz:   700, radius: 600, height:  85 },
  { type: 'island',   cx:   900, cz:  -800, radius: 380, height:  55 },
  { type: 'island',   cx:  -200, cz:   400, radius: 300, height:  45 },
  // ── 산(중간) ──
  { type: 'mountain', cx:  -750, cz:  -550, radius: 280, height: 320 }, // 섬1 위 산
  { type: 'mountain', cx:   700, cz:   650, radius: 320, height: 380 }, // 섬2 위 산
  { type: 'mountain', cx:  -100, cz:  -900, radius: 260, height: 300 },
  // ── 고산(1~2개, 시각 랜드마크) ──
  { type: 'peak',     cx:   620, cz:   720, radius: 360, height: 900 }, // 섬2 정상 고산
  { type: 'peak',     cx:  -780, cz:  -560, radius: 300, height: 720 }, // 섬1 정상 고산
];

// 다리(능선 띠) — 두 섬을 잇는 가는 고지대. 선분(a→b)까지 거리로 가우시안.
export const BRIDGES = [
  // 섬1 ↔ 섬2 를 잇는 대각선 다리
  { ax: -700, az: -600, bx: 650, bz: 700, halfWidth: 60, height: 160 },
  // 섬3 근처 짧은 다리(엄폐용 통로)
  { ax:  900, az: -800, bx: 350, bz: -300, halfWidth: 50, height: 130 },
];
```

> 배치 원칙: 봉우리는 모두 경계(±2000) 안. 산/고산은 같은 섬 중심에 겹쳐 둬 "섬 위에 산이 솟은" 자연 실루엣을 만든다(합성식이 max라 가장 높은 성분이 정상 결정). 다리는 두 섬을 잇는 가는 띠 → 그 위/아래로 비행하며 엄폐·회피. 좌표/높이는 출발점이며 실행 단계 튜닝 가능(명세 불변 — "섬 여러 개·고산 1~2·다리" 충족만 유지).

### 3.3 `heightAt(x, z)` 합성식
각 봉우리/다리의 기여 중 **최댓값**(max)을 택한다. (합(sum)이 아니라 max인 이유: 겹친 섬+산이 비현실적으로 누적·과대해지지 않고, 가장 가까운/높은 지형이 표면을 결정해 깔끔한 실루엣. 물가는 자연히 0으로 떨어진다.)

```js
// 점(cx,cz)에서의 거리² (sqrt 회피, σ² 분모와 직접 비교)
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

export function heightAt(x, z) {
  let h = 0;                                // 바다(섬 밖) = 0
  for (const f of FEATURES)  h = Math.max(h, featureHeight(x, z, f));
  for (const b of BRIDGES)   h = Math.max(h, bridgeHeight(x, z, b));
  return h;                                 // 항상 ≥ 0, 월드 밖이면 d 큼 → ≈0
}
```

특성:
- **섬 중심**: 가까우니 큰 가우시안 → 높음. **바다(섬 밖 먼 곳)**: 모든 d² 큼 → exp≈0 → 0.
- **고산 > 일반산**: `peak.height`(720~900) > `mountain.height`(300~380) → 같은 섬에서 peak가 정상 결정.
- **월드 밖**: 거리 폭증 → 0(클램프 불요, NaN 없음).
- **결정론**: 난수/시간 미사용. 같은 (x,z)면 항상 같은 값.

### 3.4 다리 단순화 노트
seed의 "다리 모양 지형"은 **솟은 능선 띠**로 단순화한다(진짜 아치 통로 아님). 즉 다리 표면 위는 지형(충돌), 옆/위 공중은 비행 가능. 엄폐·회피 가치는 "두 섬 사이 가는 고지대를 끼고 도는 기동"에서 나온다. 진짜 통과형 아치는 heightAt(높이장) 모델로 표현 불가하므로 비범위(추후 별도 메시 + AABB 충돌로 확장 가능).

### 3.5 충돌 질의 — `terrainCollision` / `isInsideTerrain`
M8이 쓸 형태. **기체를 점 + margin(반경)으로 근사**한다(seed 권고). 지형 표면 아래로 파묻혔거나(margin 포함) 수면 아래면 충돌.

```js
export const CRASH_MARGIN = 3;   // 기체 반경 근사(m) — 표면에 이만큼 닿아도 충돌

// 점(x,y,z)이 지형/수면에 충돌했는가. 충돌 즉사(M8)에서 사용.
//  - 수면: y ≤ 0(=FLOOR). 비행 모델이 y를 0으로 클램프하므로 '닿음'을 충돌로 본다.
//  - 지형: y - margin ≤ heightAt(x,z)  (표면 아래로 파묻힘)
export function terrainCollision(x, y, z, margin = CRASH_MARGIN) {
  if (y - margin <= 0) return true;               // 수면 충돌(해수면 포함)
  if (y - margin <= heightAt(x, z)) return true;  // 지형 표면 충돌
  return false;
}

// 의미를 분명히 한 별칭(점이 지형 표면 아래/내부인가; 수면 제외 버전이 필요하면 사용).
export function isInsideTerrain(x, y, z, margin = CRASH_MARGIN) {
  return y - margin <= heightAt(x, z);
}
```

판정 규약(M8 인터페이스 명확화):
- **수면 포함**: `terrainCollision`은 수면(y≤0)도 true(seed "수면(y=0) 충돌 즉사"). M8은 이 한 함수만 호출하면 지형·수면 둘 다 처리됨.
- **margin 의미**: 기체 중심 y가 표면+margin 이하면 충돌(메시 표면에 살짝 닿는 순간 폭발). margin 미지정 시 `CRASH_MARGIN`.
- **공중**: 봉우리 위쪽 충분한 고도(y-margin > heightAt)면 false(엄폐 비행 가능).
- **순수·결정론**: heightAt만 호출 → 같은 입력 같은 결과, 원본 미변형.

### 3.6 보조 export (렌더/테스트 공용)
- `FEATURES`, `BRIDGES` — 렌더가 랜드마크 위치를 알거나, 테스트가 "섬 중심=높음"을 직접 단언할 때 사용.
- `MAX_TERRAIN_HEIGHT`(상수) ≈ 가장 큰 `peak.height`(900) — 색 단계/그리드 y범위·테스트 상한에 활용.
- `heightToColorHex(h)` — driving_game 패턴 차용(고도색, §4.2). 순수(정수 hex 반환)라 terrain.js에 둔다.

---

## 4. 지형 렌더 — `src/render/terrainMesh.js`

### 4.1 단일 고해상도 그리드 (권고)
월드가 4km(±2000)로 작으니 청크 스트리밍 없이 **단일 `PlaneGeometry` 1장**으로 충분.

```js
import * as THREE from 'three';
import { heightAt, heightToColorHex, WORLD_HALF_TERRAIN } from '../terrain.js';

export const TERRAIN_SIZE = 4000;   // 한 변(±2000 = WORLD_HALF*2)
export const TERRAIN_SEG  = 256;    // 그리드 분할(정점 257² ≈ 6.6만, 16m 간격)
```

- 분할 256 → 한 칸 ≈ 15.6m. 섬/산/다리가 충분히 매끈하게 드러난다(다리 halfWidth 50~60m, 1칸보다 큼 → 띠가 끊기지 않음). 무겁다면 192로 낮춤(가벼우면 384).
- 정점 y에 `heightAt(wx, wz)`를 직접 대입(driving_game `createChunk` 패턴, 단 양자화 없이 매끈). `computeVertexNormals()`로 음영.

```js
export function buildTerrain() {
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEG, TERRAIN_SEG);
  geo.rotateX(-Math.PI / 2);                  // 수평면으로 눕힘(+Y up)
  const pos = geo.attributes.position.array;
  const colors = new Float32Array(pos.length);
  const _c = new THREE.Color();
  for (let i = 0; i < pos.length; i += 3) {
    const wx = pos[i], wz = pos[i + 2];       // 메시 중심=원점 → 월드좌표=로컬좌표
    const h = heightAt(wx, wz);
    pos[i + 1] = h;
    _c.setHex(heightToColorHex(h));
    colors[i] = _c.r; colors[i + 1] = _c.g; colors[i + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.attributes.position.needsUpdate = true;
  geo.computeVertexNormals();
  const mat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 6, flatShading: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, 0, 0);                  // 원점 중심
  return mesh;
}
```

### 4.2 고도색 함수 `heightToColorHex(h)` (terrain.js, 순수)
물가 모래 → 풀 → 바위 → 설산. 본 맵은 고산 900m까지 → driving_game보다 임계값 확대.

```js
export function heightToColorHex(h) {
  if      (h <   1) return 0xd9c48a; // 물가 모래(해안)
  else if (h <  60) return 0x3f9c35; // 풀(섬 평지)
  else if (h < 180) return 0x2f7a2a; // 진한 풀(산기슭)
  else if (h < 380) return 0x7a6b52; // 바위(산)
  else if (h < 650) return 0x8a8378; // 회색 바위(고지)
  else              return 0xfafafa; // 설산(고산 정상)
}
```
> 다리(height 130~160)는 "진한 풀~바위" 색대 → 능선이 시각적으로 구분된다. 고산 정상(>650)은 흰색 → 멀리서 랜드마크.

### 4.3 해수면 — `buildSea()` (반투명 평면 y=0)
```js
export const SEA_SIZE = 8000;   // 지형보다 넓게(수평선까지) — M4 값 유지
export function buildSea() {
  const geo = new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1e6fb0, roughness: 0.35, metalness: 0.15,
    transparent: true, opacity: 0.85,   // 약간 비쳐 섬 물가가 자연스럽게 잠김
  });
  const sea = new THREE.Mesh(geo, mat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = 0;
  return sea;
}
```
> 지형 그리드의 바다 영역도 y=0(평탄)이라 해수면과 z-fighting 가능 → 해수면을 `position.y = 0.2`로 살짝 띄우거나, 지형 바다부를 y=-0.5로 약간 낮춰 분리. 권고: 해수면 y=0 유지 + 지형 바다부는 heightAt이 정확히 0이므로 해수면을 **약간 위(0.3)**에 두고 `depthWrite:false` 또는 `polygonOffset`으로 깜빡임 제거.

### 4.4 성능/대안
- 단일 메시 257² 정점은 정적(매 프레임 재계산 없음) → 충분히 가볍다. 한 번 빌드 후 add.
- 필요 시 산/고산만 별도 고해상 패치 + 바다부 저해상으로 나눌 수 있으나 **이번 범위 단일 메시로 충분**(과설계 회피).

---

## 5. main.js 결선

### 5.1 제거/대체
- M4의 단순 바다(`seaGeo`/`seaMat`/`sea`) → `buildSea()`로 교체(반투명).
- M4 방향감 `GridHelper` → 제거(지형 메시가 방향감 제공). 원하면 경계 표시용으로만 얇게 유지(선택).

### 5.2 추가
```js
import { buildTerrain, buildSea } from './render/terrainMesh.js';
// ...
const terrain = buildTerrain();
scene.add(terrain);
const sea = buildSea();
scene.add(sea);
```
- 공유 `scene`에 add → 두 카메라(P1/P2) 모두 자동 노출(M4 §6 "상대 가시성"과 동일 원리).
- 조명(M4 Hemisphere+Directional)은 그대로 → vertexColors + 음영이 산 입체감을 살림.
- Fog(1500~4500)도 유지 → 먼 섬이 자연스럽게 흐려짐.

### 5.3 스폰 안전
M4 스폰(`y=300`, x/z=±100·±300)은 모든 섬/산 정상(최고 900)보다 낮을 수 있으나 스폰 좌표 근처(원점 부근)는 봉우리가 없어 heightAt≈0 → 안전. 데이터상 원점(0,0) 반경 ~250m엔 큰 봉우리를 두지 않는다(island #4가 cz=400, 반경 300이라 원점 기여 작음). 테스트로 `heightAt(±100, ±300) < SPAWN_Y` 확인 권장(즉사 스폰 방지).

---

## 6. 단위 테스트 가이드 (`src/terrain.test.js`)

`heightAt`·`terrainCollision`만 순수 테스트(메시는 `npm run dev` 수동). `flight.js`의 `WORLD_HALF` import해 경계 정합 검증.

### heightAt
1. **바다 = 0**: 봉우리에서 충분히 먼 점(예 원점에서 봉우리 없는 방향, 또는 `(0,0)` 인근) → `heightAt ≈ 0`(허용오차로 `< 1`).
2. **섬 중심 = 높음**: 각 island/mountain의 `(cx,cz)`에서 `heightAt > 0`이고 그 섬 근처(반경 안)에서 바다보다 큼.
3. **고산 > 일반산**: peak 중심 `heightAt` > 같은 영역 일반 mountain 중심 `heightAt`. 그리고 가장 높은 점 ≥ peak height의 상당 비율(중심에서 d=0이면 ≈height).
4. **다리 띠**: 두 끝점 사이 중간점에서 `heightAt > 0`(다리 높이 근처), 띠 옆(halfWidth*3 떨어진 곳)에선 급감(가우시안). 끝점 캡(t 클램프) 동작: 선분 밖 연장선 방향 점은 끝점 거리로 계산돼 낮아짐.
5. **단조 감쇠**: 봉우리 중심에서 멀어질수록 height 감소(중심 > 중간 > 외곽).
6. **경계 안 데이터**: 모든 `FEATURES`/`BRIDGES` 중심·끝점이 `|coord| ≤ WORLD_HALF`(flight import).
7. **월드 밖 안전**: `heightAt(9999, 9999)` ≈ 0, 유한(NaN/Infinity 아님).
8. **결정론**: 같은 (x,z) 2회 호출 결과 동일. 임의 점 스윕 모두 유한·≥0.

### terrainCollision / isInsideTerrain
9. **공중 = false**: 봉우리 위 충분한 고도(예 peak 중심 위 `y = peakHeight + 200`) → false.
10. **봉우리 내부 = true**: peak 중심 `(cx, cy=10, cz)`처럼 표면 아래 점 → true. (`y < heightAt` 명백히)
11. **수면 아래/접촉 = true**: `terrainCollision(0, 0, 0)` true(y≤0), `(0, -5, 0)` true. `isInsideTerrain(0, 5, 0)`은 false(수면 제외 버전, 바다 위 5m 공중).
12. **margin 경계**: 표면 높이 H인 점에서 `y = H + margin + 0.1` → false, `y = H + margin - 0.1` → true(경계 정확). 기본 margin과 커스텀 margin 둘 다.
13. **스폰 안전**: M4 스폰 좌표 4점에서 `terrainCollision(x, SPAWN_Y, z) === false`(시작하자마자 즉사 방지).
14. **순수성**: 원본 인자 미변형, 동일 입력 동일 출력.

### heightToColorHex
15. **단계 경계**: 0→모래, 30→풀, 500→회색바위, 900→설산 등 임계 양쪽 색이 달라짐. 항상 유효한 정수 hex(0~0xffffff) 반환.

> 허용오차 `1e-6`(가우시안 비교는 상대비교/부등식 위주). 렌더(메시 정점/색/해수면)는 `npm run dev` 수동 확인.

---

## 7. 영향 범위 / 인터페이스

- **M8 combat(충돌 즉사)**: `terrainCollision(plane.x, plane.y, plane.z)` 한 함수로 지형·수면 충돌 판정 → true면 폭발·즉사. M8은 terrain의 충돌 시그니처(§3.5)에만 의존. 기체별 반경이 다르면 `margin` 인자로 조절.
- **M4 렌더**: 단순 바다 평면을 `buildSea`(반투명)로 대체, GridHelper 제거. 카메라/비행/메시 자세 결선은 불변.
- **M1 flight**: `heightAt`은 비행 모델과 독립(flight는 y를 FLOOR=0으로만 클램프). 지형에 닿는 사망은 M8 담당 — M3는 질의만 제공해 책임 분리 유지.
- **M5~M7 무기**: 탄/미사일도 지형 충돌로 소멸시키려면 동일 `terrainCollision`(margin=0 등) 재사용 가능(선택, 해당 마일스톤 결정).
- **렌더↔순수 분리**: 메시는 `heightAt`/`heightToColorHex`(순수)만 호출 → 지형 데이터 변경 시 메시가 자동 추종(SSoT는 terrain.js 데이터).

---

## 8. 완료 기준 (Acceptance)

- `npm test` — `src/terrain.test.js`(§6) + 기존 테스트(flight/input/chaseCamera/viewport/smoke) 전부 그린.
- `npm run dev` — 공유 씬에 **섬 여러 개·산·고산(설산 정상)·다리(능선 띠)·반투명 해수면**이 보이고, 두 분할 뷰 모두에서 지형을 확인할 수 있다. 비행 중 섬/산/다리를 **엄폐·회피 기준**으로 끼고 돌 수 있다(시각 활용).
- `npm run build` 통과.
- 스폰 직후 즉사 없음(스폰 좌표 `terrainCollision` false).

---

## 9. 다음 단계 연결

- M8: `terrainCollision`을 combat 루프에 연결(매 프레임 두 기체 질의 → true면 explode+death).
- 튜닝: 실행 단계에서 섬/산/다리 좌표·높이·반경, 그리드 분할(192~384), 해수면 opacity·z-fighting 오프셋, `CRASH_MARGIN`을 플레이 감각에 맞춰 조정(명세 불변 범위).
