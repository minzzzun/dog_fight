# M11 — 시작화면(색 선택, 중복불가) + 결과창/재대결 기술설계

> 작업 진입 규약(CLAUDE.md → INDEX.md → 관련 .md) 준수. SSoT는 `mds/spec/seed.md`.
> 이 문서는 **설계만** 담는다(구현 없음). ACCEPTANCE_CRITERIA 중 "색 선택 중복 불가",
> "결과창/재대결" 두 항목과, ONTOLOGY의 `session.state`('select'|'fighting'|'result'),
> `session.winner`를 충족하는 것이 목표.

---

## 0. 배경 — 현재 상태와 문제

`src/main.js`는 **모듈 로드 시점에 즉시** 다음을 생성한다.

- 비행 상태: `plane1`, `plane2` (`createPlane(spawn)`)
- 기체 메시: `meshP1 = buildPlane(0x2266ff)`, `meshP2 = buildPlane(0xff3322)` → `scene.add`
- 무기 상태: `gun1/2`, `launcher1/2`, `disp1/2`, 공용 배열 `bullets/missiles/flares`
- 전투 상태: `combat = createCombat()`, `resultShown`, `prevAlive = [true, true]`
- 마커: `markerP1 = createMarker(scene, 0x2266ff)`, `markerP2 = createMarker(scene, 0xff3322)`

렌더 루프는 `combat.state !== 'over'`를 `fighting` 가드로 쓰고, 종료 시 `showResult(winner)`로
**재대결 불가능한** 정적 오버레이만 띄운다(현재 "새로고침으로 재시작" 안내).

문제 두 가지:
1. **색이 하드코딩**(파랑/빨강)이라 플레이어가 못 고른다.
2. **모든 상태가 모듈 로드 즉시 1회 생성**이라 재대결 시 리셋할 방법이 없다.

→ 핵심 리팩터: **즉시 생성을 `startMatch(colorP1, colorP2)` 함수로 묶고**, 시작화면에서 색을
고른 뒤 호출, 결과창의 재대결 버튼에서 다시 호출한다.

---

## 1. 색 팔레트 (순수 데이터)

새 파일 **`src/colors.js`** — THREE 비의존, 순수 데이터 + 순수 헬퍼. 단위 테스트 대상.

```js
// colors.js — 기체 색 팔레트(6색) + 색 선택 검증(순수, THREE 비의존)
// seed.md 디자인 결정: 6색(빨강·파랑·초록·노랑·주황·흰) 중복 불가.

export const PLANE_COLORS = [
  { id: 'red',    name: '빨강', hex: 0xff3322 },
  { id: 'blue',   name: '파랑', hex: 0x2266ff },
  { id: 'green',  name: '초록', hex: 0x33cc55 },
  { id: 'yellow', name: '노랑', hex: 0xffd633 },
  { id: 'orange', name: '주황', hex: 0xff8a1e },
  { id: 'white',  name: '흰',   hex: 0xf2f2f2 },
];

// id → 색 객체(없으면 undefined)
export function colorById(id) {
  return PLANE_COLORS.find((c) => c.id === id);
}

// 시작 가능 조건: 둘 다 선택 && 서로 다른 색 (중복 불가)
export function canStart(c1, c2) {
  return c1 != null && c2 != null && c1 !== c2;
}
```

설계 의도:
- 기존 하드코딩 값(`0x2266ff` 파랑, `0xff3322` 빨강)을 팔레트에 그대로 포함 → 회귀 최소화.
- `hex`는 숫자(THREE/`buildPlane`/`createMarker`가 받는 형식). `id`/`name`은 UI·검증·디버그용.
- `canStart`가 M11의 "중복 불가" 규칙을 캡슐화 — UI와 테스트가 같은 함수를 공유.
- ONTOLOGY `plane.color`는 string이므로, 세션이 보유하는 선택값은 **id 문자열**로 두고,
  메시/마커에는 `colorById(id).hex`를 넘긴다.

---

## 2. 게임 상태기계 (session.state)

ONTOLOGY: `session.state ∈ {'select','fighting','result'}`, `session.winner`(없으면 -1).

| state | 의미 | 진입 조건 | 렌더루프 동작 |
|---|---|---|---|
| `select` | 시작화면(색 선택) | 초기 로드 / "색 다시 고르기" | 비행/물리/무기 step 스킵, 메시 없음(또는 정지). 시작 오버레이 표시 |
| `fighting` | 대결 진행 | 둘 다 색 선택 && 서로 다름 → 시작 클릭 → `startMatch` | 입력·비행·무기·전투 full step |
| `result` | 결과창 | `fighting` 중 한 명 사망(`combat.state==='over'`) | 비행/무기/입력 step 스킵, 렌더만(잔여 폭발 재생). 결과 오버레이 표시 |

전이:
```
        색 둘 다 선택+상이                한 명 사망(combat over)
select ───────────────────▶ fighting ───────────────────────▶ result
   ▲                            ▲                                  │
   │   "색 다시 고르기"          │            "재대결"(같은 색)       │
   └────────────────────────────┴──────────────────────────────────┘
```

**관리 위치**: `main.js` 모듈 스코프 변수 `let sessionState = 'select';` 하나로 관리(별도
세션 객체까지는 불필요 — 단판 로컬 게임). `combat.state`('fighting'|'over')는 **전투 내부**
상태이고, `sessionState`는 **게임 흐름** 상태다. 둘을 혼동하지 않게 분리한다.

- `fighting` 진입 = `startMatch()` 호출 끝에서 `sessionState='fighting'`.
- `result` 진입 = 렌더루프에서 `combat.state==='over'`를 처음 감지할 때
  `sessionState='result'`로 바꾸고 결과 오버레이 1회 표시(기존 `resultShown` 가드를
  `sessionState` 전이로 대체 가능).

> 주의: ONTOLOGY는 `'over'`가 아니라 `'result'`를 세션 상태로 정의한다. `combat.state`는
> 기존대로 `'over'`를 유지하고, **세션 레벨에서만** `'result'`로 매핑한다(combat.js 불변).

### (선택) 순수 상태 전이 헬퍼

상태 전이를 테스트하려면 `colors.js`(또는 작은 `session.js`)에 순수 헬퍼를 둘 수 있다.
필수는 아니며, 최소 구현에서는 `canStart`만으로 충분. 추가한다면:

```js
// nextSessionState — 순수 전이(side-effect 없음). main이 이 결과로 분기.
export function nextSessionState(state, event) {
  if (state === 'select' && event === 'start')   return 'fighting';
  if (state === 'fighting' && event === 'over')  return 'result';
  if (state === 'result' && event === 'rematch') return 'fighting';
  if (state === 'result' && event === 'reselect') return 'select';
  return state; // 그 외엔 무시
}
```

---

## 3. 시작화면 UI (index.html / style.css / main.js)

driving_game 패턴(전체화면 `#overlay`, 클릭 → `startGame`) 차용. 단, 도그파이트는
**좌(P1)/우(P2) 두 패널** + 각 6색 스와치 + **상대가 고른 색 비활성** + "시작" 버튼이 필요.

### 3-1. index.html (오버레이 마크업 추가)

`<body>` 안, `<script>` 앞에 시작 오버레이와 결과 오버레이 컨테이너를 둔다.

```html
<!-- 시작화면: 좌/우 색 선택 + 시작 -->
<div id="start-overlay">
  <h1>✈️ 2P 분할화면 도그파이트</h1>
  <div class="select-row">
    <div class="player-panel" data-player="0">
      <h2>P1 (좌)</h2>
      <div class="swatches" id="swatches-p1"></div>
    </div>
    <div class="player-panel" data-player="1">
      <h2>P2 (우)</h2>
      <div class="swatches" id="swatches-p2"></div>
    </div>
  </div>
  <button id="start-btn" disabled>시작</button>
  <p class="hint">둘 다 색을 고르면(서로 다른 색) 시작할 수 있어요</p>
</div>

<!-- 결과창: 승자 + 재대결 -->
<div id="result-overlay" hidden>
  <div id="result-title"></div>
  <button id="rematch-btn">재대결</button>
  <button id="reselect-btn">색 다시 고르기</button>
</div>
```

스와치 6개는 `PLANE_COLORS`를 순회해 **JS로 동적 생성**(하드코딩 회피, AI 티 메모는 게임
로직 한정이라 정적 UI 생성은 무방하나, 색 추가 시 자동 반영되게 데이터 주도로 둔다).
각 스와치: `<button class="swatch" data-color-id="red" style="background:#ff3322">`.

### 3-2. style.css (오버레이 스타일)

기존은 캔버스 풀스크린만 정의. 추가:
- `#start-overlay`, `#result-overlay`: `position:fixed; inset:0; z-index:100; display:flex;
  flex-direction:column; align-items:center; justify-content:center; gap; background:rgba(0,0,0,.7); color:#fff;`
- `.select-row { display:flex; gap:60px; }`
- `.swatches { display:flex; gap:8px; }`
- `.swatch { width:48px; height:48px; border-radius:8px; border:3px solid transparent; cursor:pointer; }`
- `.swatch.selected { border-color:#fff; transform:scale(1.1); }`  ← 내가 고른 색
- `.swatch.disabled { opacity:.3; pointer-events:none; }`          ← 상대가 고른 색(중복불가)
- `#start-btn[disabled] { opacity:.4; cursor:not-allowed; }`
- 숨김 전환은 `hidden` 속성 또는 `display:none` 토글.

### 3-3. main.js — 선택 상태 관리

```js
import { PLANE_COLORS, colorById, canStart } from './colors.js';

// 선택된 색 id (없으면 null). 인덱스 0=P1, 1=P2.
let selectedColor = [null, null];
```

- 스와치 클릭 핸들러: `selectedColor[player] = colorId;` → `renderSwatches()` 재호출.
- `renderSwatches()`: 두 패널의 모든 스와치를 순회하며
  - `selectedColor[player] === id` → `.selected`
  - **`selectedColor[otherPlayer] === id`** → `.disabled` (상대가 고른 색 비활성 = 중복불가 UI)
  - 시작 버튼: `startBtn.disabled = !canStart(selectedColor[0], selectedColor[1])`.
- "시작" 클릭: `audio.resume()` 호출(사용자 제스처) → `start-overlay` 숨김 →
  `startMatch(colorById(selectedColor[0]).hex, colorById(selectedColor[1]).hex)`.

> 중복불가는 **2중 방어**: (a) UI에서 상대 색 스와치 비활성, (b) `canStart`가 false면 시작
> 버튼 자체 비활성. 같은 색을 절대 통과시키지 않는다.

---

## 4. 매치 초기화 함수 `startMatch(colorP1, colorP2)` (핵심 리팩터)

모듈 로드 시 즉시 생성하던 것을 전부 이 함수로 이동. **재실행 가능**해야 하므로 메시는
매번 제거·dispose 후 재생성한다. 인자는 hex 숫자(`colorById(id).hex`).

### 4-1. 한 번만 생성(영속) vs 매치마다 (재)생성 구분

| 구분 | 항목 | 이유 |
|---|---|---|
| **영속(모듈 로드 시 1회)** | `renderer`, `scene`, 조명, `terrain`, 카메라 2개, `bulletPool`/`missilePool`/`flarePool`/`explosionPool`, `markerP1/P2`, `hud`, `lockReticle`, `input`, `audio`, `clock` | 풀·씬·렌더러는 재대결마다 다시 만들 필요 없음. 마커는 색만 바꾸면 됨(아래) |
| **매치마다 (재)생성/리셋** | `plane1/2`, `meshP1/P2`, `gun1/2`, `launcher1/2`, `disp1/2`, `bullets/missiles/flares`(빈 배열로), `combat`, `prevAlive`, `resultShown`(또는 sessionState 가드) | 매 대결 새 상태 |

> 마커(`createMarker`)는 현재 색을 고정으로 생성한다. 재대결에서 색이 바뀌면 마커 색도
> 바꿔야 한다. 두 가지 안:
> - (A·권장) `marker.js`에 `setColor(hex)` 추가 → 영속 마커 색만 갱신.
> - (B) 매치마다 마커도 제거 후 재생성. → `createMarker`가 `dispose()`/제거 핸들을 반환하도록
>   소폭 확장 필요.
> 최소 변경은 (A). M11 범위에서 marker.js에 `setColor`를 더하는 것을 권장한다.

### 4-2. 함수 골격

```js
// 매치 (재)시작 — 색은 hex 숫자. select/result에서 호출.
function startMatch(colorP1, colorP2) {
  // 1) 이전 기체 메시 정리(재대결 시) — scene에서 제거 + geometry/material dispose
  disposePlaneMesh(meshP1);
  disposePlaneMesh(meshP2);

  // 2) 비행 상태 재스폰(기존 스폰 좌표/yaw 그대로)
  plane1 = createPlane({ x: -100, y: 300, z:  300, yaw: Math.PI });
  plane2 = createPlane({ x:  100, y: 300, z: -300, yaw: 0 });

  // 3) 기체 메시 선택 색으로 재생성
  meshP1 = buildPlane(colorP1);
  meshP2 = buildPlane(colorP2);
  scene.add(meshP1);
  scene.add(meshP2);

  // 4) 마커 색 갱신(영속 마커) — marker.setColor(hex) 사용
  markerP1.setColor(colorP1);
  markerP2.setColor(colorP2);

  // 5) 무기 상태 리셋
  gun1 = createGun();         gun2 = createGun();
  launcher1 = createMissileLauncher(); launcher2 = createMissileLauncher();
  disp1 = createFlareDispenser();      disp2 = createFlareDispenser();

  // 6) 공용 발사체 배열 비우기 + 풀 동기화(다음 sync에서 잔여 메시 숨김)
  bullets = []; missiles = []; flares = [];

  // 7) 전투/표시 상태 리셋
  combat = createCombat();
  prevAlive = [true, true];
  resultShown = false;        // 또는 sessionState 가드로 대체
  abPhase = 0;

  // 8) 결과 오버레이 숨김 + 세션 상태 전환
  resultOverlay.hidden = true;
  sessionState = 'fighting';
}
```

`disposePlaneMesh(mesh)` 헬퍼(planeMesh.js에 추가 권장):
```js
// 기체 메시를 scene에서 제거하고 하위 geometry/material을 dispose(메모리 누수 방지).
export function disposePlaneMesh(mesh) {
  if (!mesh) return;
  if (mesh.parent) mesh.parent.remove(mesh);
  mesh.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
}
```

- **모듈 로드 시**: 마커는 `createMarker(scene, PLANE_COLORS[1].hex /*파랑*/)`처럼 임의 초기색
  으로 한 번 만들어 두고(또는 0색), 실제 색은 첫 `startMatch`에서 `setColor`로 확정.
- **`audio.resume()`**: "시작" 버튼 클릭 핸들러(사용자 제스처)에서 호출. 기존 keydown의
  `audio.resume()`도 유지(첫 키에서 보장) — idempotent.

---

## 5. 결과창 / 재대결

기존 `showResult(winner)`를 **DOM 오버레이 토글**로 교체(매번 새 div 생성 → 누적 버그
방지). `#result-overlay`를 미리 두고 채워서 보인다.

```js
function showResult(winner) {
  let msg;
  if (winner === 0) msg = 'P1 승리';
  else if (winner === 1) msg = 'P2 승리';
  else msg = '무승부';           // 'draw'
  resultTitle.textContent = msg;
  // (선택) 승자 색 반영: colorById로 역추적하거나 selectedColor[winner]로 배경 틴트
  resultOverlay.hidden = false;
}
```

버튼 동작:
- **재대결**(`#rematch-btn`): `startMatch(colorById(selectedColor[0]).hex, colorById(selectedColor[1]).hex)`
  → **같은 색으로 즉시 재시작**(단판, seed.md "재대결 버튼(단판)" 충족).
- **색 다시 고르기**(`#reselect-btn`, 선택 제공): `resultOverlay.hidden=true` →
  `startOverlay` 다시 표시 → `sessionState='select'`. (선택값 유지/초기화는 택1, 유지 권장.)

> **권장 흐름**: 재대결 = 같은 색 즉시 시작이 1차(요구사항 핵심). "색 다시 고르기"는
> 편의 옵션으로 추가하면 select↔result 양방향 전이까지 완성된다.

승자 색 반영(선택): `selectedColor[winner]`의 hex로 결과 타이틀 색/테두리를 칠하면
"색 반영"까지 만족. 무승부면 중립색.

---

## 6. 렌더루프 가드 (state !== 'fighting'이면 step 스킵)

현재 가드는 `const fighting = combat.state !== 'over';`. 이를 **세션 상태 기준**으로 바꾼다.

```js
const fighting = sessionState === 'fighting';

if (fighting) {
  // ... readInputs, stepFlight, 무기 step, stepCombat ... (기존 블록 그대로)

  // 전투 종료 감지 → 세션을 result로 전이 + 결과창 1회
  if (combat.state === 'over' && sessionState === 'fighting') {
    sessionState = 'result';
    showResult(combat.winner);
  }
}

stepExplosions(explosionPool, dt);   // 종료/선택 중에도 잔여 폭발 재생(렌더만)
// applyPlaneTransform / sync* / marker / hud / applyChase / renderViews 는 항상 실행
```

설계 포인트:
- **`select`에서도 렌더는 돈다**(빈 씬 + 지형 + 카메라). 시작 오버레이가 그 위를 덮는다.
  기체 메시는 첫 `startMatch` 전엔 없으므로 `applyPlaneTransform`이 `meshP1/2` 존재
  가드를 타거나, `select` 동안엔 sync/transform를 건너뛰는 분기를 둔다(최소: meshP1/2를
  로드 시 `null`로 두고 존재 시에만 transform).
- `result`(=`combat over`)에서는 비행/무기/입력 step 전부 스킵 → 비행 정지(기존 동작 유지).
- 기존 "사망 후 정지" 동작과 동일한 결과(가드만 `combat.state`→`sessionState`로 격상).

> select 상태에서 기체 메시가 없을 때 `markerP1.update`/`applyPlaneTransform`가 터지지
> 않도록 **null 가드** 또는 "기체 미생성 시 sync 스킵"을 둘 것(회귀 위험 포인트).

---

## 7. 단위 테스트 가이드 (Vitest)

순수 부분만 자동 테스트(기존 `src/*.test.js` 관례 따라 `src/colors.test.js`).

`src/colors.test.js`:
- **팔레트 데이터**: `PLANE_COLORS.length === 6`; 모든 `hex`가 number; 모든 `id` 유일;
  기존 하드코딩 색(파랑 `0x2266ff`, 빨강 `0xff3322`)이 팔레트에 포함됨.
- **`colorById`**: 존재 id → 객체, 없는 id → `undefined`.
- **`canStart` (중복 검증)**:
  - `canStart('red','blue') === true`
  - `canStart('red','red') === false`   ← 같은 색 불가(핵심)
  - `canStart(null,'blue') === false`, `canStart('red',null) === false`,
    `canStart(null,null) === false`   ← 한쪽/양쪽 미선택
- **(헬퍼 채택 시) `nextSessionState`**: select+start→fighting, fighting+over→result,
  result+rematch→fighting, result+reselect→select, 그 외 입력은 원상태 유지.

**수동 검증**(UI/메시/오버레이 — THREE/DOM 의존):
- 시작화면에서 P1이 빨강 고르면 P2 패널의 빨강 스와치가 비활성(중복불가) 되는지.
- 둘 다 골라야(서로 다른 색) "시작" 버튼 활성화.
- 시작 → 분할 2뷰포트 대결 정상(기존 M4~M10 회귀 없음), 기체 색이 선택대로.
- 한 명 격추 → 결과창 승자 표시 → 재대결 버튼 → 같은 색으로 즉시 재시작, 체력/탄약/
  미사일/플레어 모두 리셋, 잔여 탄/미사일/플레어 메시 사라짐.
- "색 다시 고르기" → 시작화면 복귀.

---

## 8. 영향 범위 / 회귀 위험

**수정 파일**
- `src/colors.js` — **신규**(팔레트 + `canStart` + `colorById` [+ `nextSessionState`]).
- `src/main.js` — **대규모 리팩터**: 즉시 생성 → `startMatch()`로 이동, `sessionState`
  변수 + 렌더루프 가드 격상, 선택 UI 핸들러, `showResult` 토글화, 시작/재대결/재선택 결선.
- `index.html` — 시작 오버레이 + 결과 오버레이 마크업 추가.
- `src/style.css` — 오버레이/스와치/버튼 스타일 추가.
- `src/render/planeMesh.js` — `disposePlaneMesh(mesh)` 헬퍼 추가(메시 정리).
- `src/render/marker.js` — `setColor(hex)` 추가(재대결 색 갱신) — 권장(A안).
- `src/colors.test.js` — **신규**(순수 테스트).

**회귀 위험 & 완화**
- **즉시 생성 → 함수화**: 모듈 로드 직후 메시·상태가 없게 되므로, `select` 동안
  `applyPlaneTransform`/`syncBullets`/`markerP*.update`가 **null/빈 상태에서 안전**해야 함
  → meshP1/2 null 가드, sync는 빈 배열 안전(이미 풀 sync는 잔여 숨김 처리).
- **combat.state vs sessionState 혼동**: combat.js는 손대지 말 것(`'over'` 유지). 세션
  레벨에서만 `'result'`로 매핑. 렌더루프 가드를 `sessionState`로 통일.
- **메모리 누수**: 재대결마다 기체 메시를 dispose하지 않으면 누적 → `disposePlaneMesh` 필수.
- **결과 오버레이 누적**: 기존 `showResult`가 매번 div를 새로 append → 재대결 반복 시
  쌓임. 고정 `#result-overlay` 토글로 교체해 제거.
- **마커 색 미갱신**: setColor 누락 시 재대결에서 색이 어긋남 → 4-1 (A)안 적용.
- **기존 결선 유지**: `fighting` 블록 내부 로직(M4~M10 비행·무기·전투·HUD·사운드)은
  **그대로** 옮기기만 하고 내용 변경 금지 — 단판 대결 동작 회귀 방지.

---

## 9. 구현 순서(권장)

1. `src/colors.js` + `src/colors.test.js`(TDD: 팔레트·`canStart` 그린) → 커밋.
2. `main.js`의 즉시 생성 코드를 `startMatch()`로 묶고, 모듈 끝에서 즉시 호출하던 것을
   제거(아직 시작화면 없으면 기본색으로 1회 호출해 회귀 확인) → 커밋.
3. 렌더루프 가드를 `sessionState` 기준으로 격상 + null 가드 → 커밋.
4. index.html/style.css 시작·결과 오버레이 + 선택 핸들러(중복불가 UI) + 시작 결선 → 커밋.
5. `showResult` 토글화 + 재대결/재선택 버튼 결선 + marker.setColor/disposePlaneMesh → 커밋.
6. 수동 검증(분할 대결→격추→재대결 루프) 후 done 노트 + INDEX 갱신(별도, 본 설계 범위 외).
