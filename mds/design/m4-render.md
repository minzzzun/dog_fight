# 설계 — M4 렌더 결선: 비행 + 입력 + 추격 카메라 (분할 2뷰포트)

> 상태: 설계 완료(구현 대기) · 작성: 2026-06-06
> 범위: M0 스캐폴드(분할 2뷰포트·바다·플레이스홀더) 위에 M1 비행(`stepFlight`)·M2 입력(`readInputs`)을 **결선**한다.
> 2P가 각자 WASD/화살표로 비행기를 조종하고, 각 뷰가 **3인칭 추격 카메라**로 자기 기체를 따라간다.
> SSoT는 `mds/spec/seed.md`. 좌표/방향 규약은 M0·M1과 정합(forward=-Z, up=+Y, 기체 뒤=+Z).

---

## 1. 목표와 비범위

### 목표 (이번 M4에서 만든다)
- `npm run dev`에서 좌(P1) WASD·우(P2) 화살표로 **두 기체를 동시에 조종**한다.
- 각 뷰가 자기 기체를 **자세 추종형 3인칭 추격 카메라**로 따라간다(M0 고정 오프셋 → forward/up 기반으로 교체).
- 기체 메시가 비행 상태(yaw/pitch/roll)대로 **회전**한다(기수가 진행 방향).
- 상대 기체가 **양쪽 화면에 보인다**(공유 씬 1개를 두 카메라가 렌더).
- 추격 카메라 계산을 **순수 함수 `chaseCameraPose(plane)`**로 분리해 Vitest로 검증한다.

### 비범위 (이후 마일스톤)
- 무기/발사/락온(M5~M7), 전투/충돌 즉사(M8), 지형 섬·산·다리 메시(M3), HUD(M9), 사운드(M10), 시작화면 색선택·결과창(M11).
- 카메라 스무딩(lerp 추종)은 **선택**(§4.4). 기본은 즉시 추종(deterministic·단순). 떨림이 거슬리면 옵션으로 추가.

---

## 2. 파일 변경 요약

| 파일 | 변경 | 비고 |
|---|---|---|
| `src/render/chaseCamera.js` | **신규** — 순수 함수 `chaseCameraPose(plane)` | THREE 비의존. Vitest 대상 |
| `src/render/planeMesh.js` | **신규** — `buildPlane(color)` + `applyPlaneTransform(mesh, plane)` | M0 `buildPlane` 이관 + 자세 적용. THREE 의존 |
| `src/main.js` | **개편** — 입력/비행/카메라/메시 결선 | M0 플레이스홀더 회전·고정 카메라 제거 |
| `src/render/viewport.js` | 변경 없음 | `splitViewports` 그대로 재사용 |
| `tests/chaseCamera.test.js` | **신규** | 순수 카메라 포즈 단위 테스트 |

> 순수 로직(`chaseCamera.js`)은 `import * as THREE` 금지. `{x,y,z}` 숫자만 입출력.

---

## 3. 순수 추격 카메라 — `src/render/chaseCamera.js`

### 3.1 역할
비행 상태와 방향 헬퍼(M1 `forwardOf`/`upOf`)만으로 카메라 **포즈(position/lookAt/up)** 를 **숫자로** 계산한다.
THREE를 모르며, `main`이 이 결과를 `camera.position.set(...)` / `camera.lookAt(...)` / `camera.up.set(...)`로 적용한다.

### 3.2 상수 (출발점 — 튜닝 가능)
```js
export const CHASE_DIST   = 22;   // 기체 뒤로 카메라를 띄우는 거리(m). 기체 뒤 = -forward 방향
export const CHASE_HEIGHT = 8;    // 기체 위로 올리는 높이(m). up 방향
export const LOOK_AHEAD   = 30;   // 시선 목표를 기체 전방으로 당기는 거리(m). forward 방향
```
> M0 고정 오프셋 `(0, 8, 20)`(뒤+위)을 자세 추종형으로 일반화한 값. 뒤=22, 위=8은 M0 감각 유지.

### 3.3 시그니처 / 수식
```js
// 비행 상태 → 카메라 포즈(모두 평범한 {x,y,z}). THREE 비의존.
export function chaseCameraPose(plane) → {
  position: {x, y, z},
  lookAt:   {x, y, z},
  up:       {x, y, z},
}
```
내부 계산(벡터는 모두 단위벡터 가정 — `forwardOf`/`upOf`는 길이 1 반환):
```
f = forwardOf(plane)            // 기수 방향 (롤 무관)
u = upOf(plane)                 // 천장 방향 (롤 반영)
p = { plane.x, plane.y, plane.z }

position = p  − f·CHASE_DIST  + u·CHASE_HEIGHT       // 기체 뒤(−f) · 위(+u)
lookAt   = p  + f·LOOK_AHEAD                          // 기체 약간 앞을 본다
up       = u                                          // 롤 반영 → 카메라가 같이 기운다
```
성분식(구현 참고):
```
position.x = p.x − f.x*CHASE_DIST + u.x*CHASE_HEIGHT
position.y = p.y − f.y*CHASE_DIST + u.y*CHASE_HEIGHT
position.z = p.z − f.z*CHASE_DIST + u.z*CHASE_HEIGHT
lookAt.x   = p.x + f.x*LOOK_AHEAD     (y,z 동형)
up         = { u.x, u.y, u.z }
```

### 3.4 설계 노트
- **기체 뒤** = `−forward`. M0가 `+Z`(고정 오프셋 `z=+20`)에 카메라를 둔 것과 정합: 기본 자세 forward=`(0,0,-1)`이므로 `−f = (0,0,+1)` → 카메라가 `z=+CHASE_DIST`(기체 뒤). ✔
- **up에 `upOf`(롤 반영) 사용**: 롤을 주면 카메라도 같이 기울어 도그파이트 몰입감↑. 단순화를 원하면 월드업 `(0,1,0)` 사용도 가능하나, 본 설계는 `upOf` 채택(테스트로 검증).
- `lookAt`을 기체 자신(`p`)이 아니라 `p + f·LOOK_AHEAD`로 두면 화면에서 기체가 약간 아래에 놓이고 전방 시야가 넓어진다(추격기 표준 구도).
- 순수·결정론: 같은 plane이면 같은 포즈. 난수/시간 미사용.
- **스무딩(선택)**: 즉시 추종 대신 한 프레임 lerp를 원하면 `main`이 직전 카메라 위치를 보관하고 `cam.position.lerp(target, k)` 적용. 순수 함수는 그대로 두고 **적용 측**에서만 처리(테스트 영향 없음).

---

## 4. 기체 메시 자세 적용 — `src/render/planeMesh.js`

### 4.1 `buildPlane(color)` (M0에서 이관)
M0 `src/main.js`의 플레이스홀더 메시 빌더를 그대로 이 모듈로 옮긴다. **기수가 -Z(전방)** 규약 유지(콘을 `rotation.x = -π/2`로 눕혀 기수가 -Z를 향함). M3에서 실제 기체 모델로 교체될 때까지 재사용.
```js
export function buildPlane(color) → THREE.Group   // 동체(콘, 기수 -Z) + 주익(박스)
```

### 4.2 `applyPlaneTransform(mesh, plane)`
비행 상태를 메시 위치·회전에 반영한다. **forward/up 기반 lookAt 정렬**로 yaw/pitch/roll을 한 번에 적용(오일러 적용 순서 불일치 위험 제거).
```js
import * as THREE from 'three';
import { forwardOf, upOf } from '../flight.js';

const _pos    = new THREE.Vector3();
const _target = new THREE.Vector3();
const _up     = new THREE.Vector3();
const _m      = new THREE.Matrix4();

export function applyPlaneTransform(mesh, plane) {
  const f = forwardOf(plane);   // 기수 방향
  const u = upOf(plane);        // 천장(롤 반영)
  _pos.set(plane.x, plane.y, plane.z);

  // 기수가 -Z 규약 → 메시가 'f 방향을 바라보게' 하려면
  // lookAt 타깃 = pos + f (THREE lookAt은 -Z가 타깃을 향하도록 정렬하므로 정합)
  _target.copy(_pos).add(_up.copy(f));        // (임시 재사용) target = pos + f
  _up.set(u.x, u.y, u.z);

  mesh.position.copy(_pos);
  _m.lookAt(_pos, _target, _up);              // eye, target, up → 회전행렬
  mesh.quaternion.setFromRotationMatrix(_m);
}
```
> **주의(부호 정합)**: `Matrix4.lookAt(eye, target, up)`은 **-Z가 target을 향하도록** 회전을 만든다. M0 메시는 기수가 -Z이므로 `target = pos + forward`로 두면 기수가 정확히 forward를 향한다. (만약 메시 기수를 +Z로 바꾼다면 `target = pos − forward`로 뒤집어야 함 — 본 설계는 -Z 유지.)
> 위 코드의 `_up` 임시 재사용은 가독성을 위해 구현 시 별도 임시 벡터로 분리해도 됨(`_pos`/`_target`/`_up`/`_m` 모듈 스코프 재사용으로 GC 압력 0).

### 4.3 모듈 스코프 임시 벡터
CGs 관례(`_`접두 임시)대로 `_pos`/`_target`/`_up`/`_m`을 모듈 스코프에 한 번 만들어 매 프레임 재사용(할당 없음).

---

## 5. main.js 결선

### 5.1 제거할 M0 코드
- 플레이스홀더 회전(`planeP1.rotation.y += ...`).
- `CHASE_OFFSET` 고정 오프셋 + `placeChaseCamera`(고정식).
- `buildPlane` 정의 → `planeMesh.js`에서 import.

### 5.2 초기화
```js
import * as THREE from 'three';
import { splitViewports } from './render/viewport.js';
import { buildPlane, applyPlaneTransform } from './render/planeMesh.js';
import { chaseCameraPose } from './render/chaseCamera.js';
import { createPlane, stepFlight } from './flight.js';
import { createInput, onKeyDown, onKeyUp, readInputs } from './input.js';

// 비행 상태 두 개 — 서로 마주보게(약 200m 간격, 같은 고도).
// P1: 왼쪽에서 +Z(상대 쪽)를 바라보게, P2: 오른쪽에서 -Z를 바라보게.
// forward 규약상 yaw=0 → -Z. 서로를 보게 하려면 한쪽 yaw=π(반대 방향).
let plane1 = createPlane({ x: -100, y: 300, z:  300, yaw: Math.PI });  // 기수 +Z(상대 쪽)
let plane2 = createPlane({ x:  100, y: 300, z: -300, yaw: 0 });        // 기수 -Z(상대 쪽)

const meshP1 = buildPlane(0x2266ff);  // P1 파랑
const meshP2 = buildPlane(0xff3322);  // P2 빨강
scene.add(meshP1);
scene.add(meshP2);

const input = createInput();
```
> **스폰 배치 근거**: z를 ±300으로 벌리고 서로 마주보는 yaw를 줘서 **양쪽 화면에 상대가 정면으로 보인다**(첫 결선 확인이 쉬움). x를 ±100으로 살짝 어긋나게 두면 정면충돌 없이 스쳐 지나간다. 값은 튜닝 가능(WORLD_HALF=2000 안).

### 5.3 입력 결선 (DOM ↔ input.js)
```js
window.addEventListener('keydown', (e) => {
  if (onKeyDown(input, e.code)) e.preventDefault();  // 매핑된 키만 기본동작 차단(스크롤 등)
});
window.addEventListener('keyup', (e) => {
  if (onKeyUp(input, e.code)) e.preventDefault();
});
```
- `onKeyDown`/`onKeyUp`은 매핑된 키일 때 true → 그때만 `preventDefault`(화살표 스크롤·Space 등 방지, 비매핑 키는 그대로).
- 키 리피트·엣지(missile/flare)는 input.js가 처리(M4에선 무기 미사용이지만 pending은 그냥 소비됨, 무해).

### 5.4 카메라 적용 헬퍼
```js
const cameraL = makeCamera();  // M0 makeCamera 재사용 (aspect = (innerWidth/2)/innerHeight)
const cameraR = makeCamera();

function applyChase(camera, plane) {
  const pose = chaseCameraPose(plane);
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  camera.up.set(pose.up.x, pose.up.y, pose.up.z);
  camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
}
```
> `camera.up`을 lookAt **전에** 설정해야 lookAt이 그 up으로 회전을 잡는다(롤 반영). 순서 중요.

### 5.5 렌더 루프
```js
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), DELTA_CLAMP);   // M0 관례 클램프

  const { p1, p2 } = readInputs(input);                 // 프레임당 1회 (엣지 소비 1회)
  plane1 = stepFlight(plane1, p1, dt);
  plane2 = stepFlight(plane2, p2, dt);

  applyPlaneTransform(meshP1, plane1);
  applyPlaneTransform(meshP2, plane2);

  applyChase(cameraL, plane1);   // 좌 = P1
  applyChase(cameraR, plane2);   // 우 = P2

  renderViews();                 // M0 분할 2뷰포트 렌더 (scissor + 좌/우 2회)
}
```
- **`readInputs`는 프레임당 정확히 1회** 호출(엣지 입력이 한 번만 소비되도록). p1·p2를 한 객체에서 분해.
- `stepFlight`은 불변 반환 → `plane1 = ...` 재대입(let).
- `renderViews()`는 M0 구현 그대로(좌 cameraL, 우 cameraR).

### 5.6 리사이즈
M0 `onResize` 그대로 유지(두 카메라 aspect = `(innerWidth/2)/innerHeight` 갱신).

---

## 6. 시각 보강 (가벼움)

- **바다(M0) 유지**: y=0 평면, 하늘 배경색, Fog(1500~4500). 그대로 둔다.
- **월드 경계 시각(선택)**: M1 `WORLD_HALF=2000`. 과하지 않게 둘 중 하나:
  1. **그리드** — `THREE.GridHelper(WORLD_HALF*2, 40)`을 y=1(수면 살짝 위)에 깔아 이동감/경계를 보여준다. 가장 가볍고 권장.
  2. 반투명 벽 — 경계 4면에 `MeshBasicMaterial({transparent:true, opacity:0.08, side:DoubleSide})` 박스. 시각은 좋지만 메시 4개 추가. 선택.
  - HUD(M9)가 `warning` 플래그로 텍스트 경고를 담당하므로, M4 시각 경계는 **방향감 보조** 수준이면 충분.
- **하늘/포그**: M0 값 유지(추가 작업 불요). 원하면 `HemisphereLight` 강도만 미세조정.
- **상대 가시성**: 두 메시 모두 공유 `scene`에 add → 두 카메라 어느 쪽에서도 보인다(별도 작업 없음).

> 경계 시각은 **선택**. 우선순위는 카메라·메시·입력 결선이 동작하는 것. 그리드 1줄 추가가 비용 대비 효과 최고.

---

## 7. 단위 테스트 가이드 (`tests/chaseCamera.test.js`)

`chaseCameraPose`만 순수 테스트(메시/카메라 적용은 `npm run dev` 수동 확인). M1 `forwardOf`/`upOf`를 실제 import해 정합 검증.

1. **기본 자세 위치**: `plane = createPlane()`(yaw=pitch=roll=0, forward=(0,0,-1), up=(0,1,0)).
   - `position` ≈ `{ x:0, y: SPAWN_Y + CHASE_HEIGHT, z: +CHASE_DIST }` (기체 뒤=+Z, 위=+Y). z>0(기체 뒤쪽)·y>plane.y 단언.
2. **lookAt 전방**: 기본 자세에서 `lookAt.z` < `plane.z`(=-Z 전방, `plane.z - LOOK_AHEAD`). `lookAt`이 position보다 **앞(−Z)** 에 있음(`lookAt.z < position.z`).
3. **up 정합**: 기본 자세 `up ≈ (0,1,0)`. (롤 반영을 upOf로 받으므로 무롤이면 월드업.)
4. **yaw 회전 추종**: yaw=+π/2 등에서 `position`이 기체 뒤(−forward 방향)에 위치하는지 — `forwardOf(plane)`를 직접 구해 `position − plane === −f·DIST + u·HEIGHT`를 성분 비교(부동소수 허용오차).
5. **pitch 시 카메라 상하**: pitch>0(기수 위)면 forward.y>0 → `lookAt.y > plane.y`(앞이 위를 향함), position은 기체 뒤·아래쪽으로 따라감(−f.y<0 기여). 부호 단언.
6. **roll 시 up 기울기**: roll≠0이면 `up.x ≠ 0`(카메라 up이 롤만큼 기욺). roll 부호와 up.x 부호 정합 단언.
7. **거리 일관성**: `distance(position, plane) ≈ sqrt(CHASE_DIST² + CHASE_HEIGHT²)`(forward⊥up 가정, 단위벡터). 임의 yaw/pitch에서도 동일(자세 무관 상대거리 유지).
8. **여러 자세 스윕**: yaw·pitch·roll 조합 몇 개에서 `position`·`lookAt`·`up`이 모두 유한(NaN 없음)·`up` 길이≈1.
9. **순수성/결정론**: 같은 plane 2회 호출 → 깊은 동등. 원본 plane 미변형.

> 허용오차 `1e-6`. forward/up이 단위벡터라는 M1 보장에 의존(이미 M1 테스트가 검증).

---

## 8. 영향 범위 / 인터페이스

- **M3 지형**: 섬·산·다리 메시는 공유 씬에 추가만 하면 두 카메라에 자동 노출. 경계 그리드는 M3 실제 맵으로 대체 가능.
- **M5/M6 무기**: 발사 위치·방향은 `forwardOf(plane)`·`plane` 위치를 재사용(본 설계의 메시 정렬과 동일 소스). 총구/노즈 오프셋은 planeMesh의 로컬 위치로 추가.
- **M8 combat**: 위치 `{x,y,z}`로 충돌 즉사 판정. M4는 음수 고도만 막는 flight 클램프에 의존(충돌 사망은 combat).
- **M9 HUD**: 분할 뷰포트(`splitViewports`) 위에 DOM/오버레이로 그림. `warning`·`speed`를 plane 상태에서 읽음. 카메라 포즈와는 독립.
- **M10 사운드**: 엔진음은 `plane.speed`, 발사음은 무기에서. M4 무관.

---

## 9. 완료 기준 (Acceptance)

- `npm test` — `chaseCamera.test.js`(§7) + 기존 테스트 그린.
- `npm run dev` — 좌 화면 WASD로 P1, 우 화면 화살표로 P2를 **동시에** 조종할 수 있다.
  - 롤(A/D, ←/→) → 뱅크턴으로 선회, 카메라가 같이 기운다.
  - 피치(W/S, ↑/↓) → 상승/하강, 카메라가 자세를 따라간다.
  - Shift/Q(좌), ShiftRight/`/`(우) → 부스터/감속 체감.
  - 각 화면에 **자기 기체가 추격 시점**으로, **상대 기체도** 보인다.
  - 화살표/Space 등이 페이지를 스크롤하지 않는다(preventDefault).
- `npm run build` 통과.

---

## 10. 다음 단계 연결

- M3: 경계 그리드를 실제 지형 메시로 교체, `terrain.heightAt`로 수면/지형 시각 정합.
- M5~M7: planeMesh 노즈 오프셋·forward로 발사, 락 콘 시각화.
- M9: 추격 뷰 위에 HUD 오버레이(체력·속도·warning).
