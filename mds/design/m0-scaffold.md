# M0 설계 — 프로젝트 스캐폴드 + 분할 2뷰포트 렌더

> 상태: 설계 완료(구현 대기) · 작성: 2026-06-06
> 범위: **스캐폴드만** (게임 로직 없음). Vite + Three.js + Vitest 환경 구축, 단일 캔버스 좌/우 2뷰포트 분할 렌더, 플레이스홀더 기체 표시, 순수 뷰포트 분할 유틸 + 테스트.
> 참고 본보기: `/Users/kimminjun/Desktop/CGs/driving_game/` (동일 CGs WebGL 스택·관례)

---

## 1. 목표와 비범위

### 목표 (이번 M0에서 만든다)
- `npm run dev`로 한 캔버스가 **좌(P1)/우(P2) 2뷰포트로 분할**되어 각각 별도 카메라로 렌더된다.
- 각 뷰포트에 **플레이스홀더 기체**(간단 메시) + **하늘/바다 배경**이 보인다.
- 뷰포트 사각형 계산을 **순수 함수 `splitViewports(w,h)`**로 분리하고 Vitest로 검증한다.
- `npm test`(스모크 + splitViewports), `npm run build`가 통과한다.
- 리사이즈 시 분할 비율·카메라 aspect가 정상 갱신된다.

### 비범위 (이후 마일스톤)
- 비행 모델(M1), 입력(M2), 지형 heightAt/실제 맵 렌더(M3), 추격 카메라 스무딩 로직(M4), 무기/전투(M5~M8), HUD(M9), 사운드(M10), 시작화면 색 선택·결과창(M11).
- M0의 카메라는 **고정 배치 추격 시점 흉내**만 낸다(기체 뒤·위 고정 오프셋). 기체에 부착·스무딩하는 결선은 M1/M4에서.

---

## 2. 의존성 / package.json

driving_game과 동일 계열로 맞춘다(버전도 동일하게).

```json
{
  "name": "dogfight",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vite": "^8.0.10",
    "vitest": "^3.2.4"
  },
  "dependencies": {
    "three": "^0.184.0"
  }
}
```

- `npm install`로 lock 생성. `node_modules/`, `dist/`는 이미 `.gitignore`에 포함됨.
- **Vitest 환경: node** (driving_game과 동일). 순수 로직만 테스트하므로 jsdom/DOM 불필요. `vite.config.js`/`vitest.config.js` **별도 파일 불필요**(driving_game도 없음, 기본값 사용). 필요해지면(예: jsdom) 그때 추가.

---

## 3. 파일 구조 (M0에서 생성)

```
dogfight/
├─ package.json              # 위 의존성/스크립트
├─ index.html               # 전체화면 캔버스 1개 + main.js 모듈 로드
├─ .gitignore               # 이미 존재 (node_modules/ dist/ .DS_Store)
├─ src/
│  ├─ style.css             # 캔버스 풀스크린·여백 제거·배경
│  ├─ main.js               # Three 초기화 + 분할 2뷰포트 렌더 루프 (결선)
│  └─ render/
│     └─ viewport.js        # 순수 유틸: splitViewports(w,h)  ← 테스트 대상
└─ tests/
   ├─ smoke.test.js         # Vitest 동작 확인 (driving_game과 동일)
   └─ viewport.test.js      # splitViewports 단위 테스트
```

> 이후 마일스톤 파일(`src/flight.js`, `src/input.js`, `src/render/scene.js` 등)은 만들지 않는다. M0는 위 목록만.

---

## 4. index.html

driving_game 관례(한국어 `lang`, `<link>` style, `<script type="module">`)를 따르되, 시작 오버레이는 M11이므로 **최소화**(빈 캔버스 + 모듈 로드만). 분할 렌더는 단일 `WebGLRenderer`가 캔버스 전체를 채우므로 별도 캔버스 요소를 두지 않고 main.js에서 생성해 `body`에 append한다(driving_game 패턴).

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <title>✈️ 2P 분할화면 도그파이트 — WebGL</title>
  <link rel="stylesheet" href="/src/style.css" />
</head>
<body>
  <!-- M0: 시작 오버레이/색 선택은 M11. 지금은 분할 2뷰포트 렌더만 확인 -->
  <script type="module" src="/src/main.js"></script>
</body>
</html>
```

### src/style.css
```css
/* 캔버스 풀스크린 + 여백 제거 */
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
canvas { display: block; }
```

---

## 5. 분할 2뷰포트 렌더 방식

### 핵심 개념
단일 `WebGLRenderer` + 단일 캔버스로 **좌·우 두 번 그린다**. 각 뷰포트마다 `setViewport`(그릴 화면 영역) + `setScissor`(그 영역 밖은 건드리지 않게 클리핑) + `setScissorTest(true)`를 적용한 뒤 해당 플레이어 카메라로 `render`한다. CLAUDE.md 코딩스타일에 명시된 방식이다.

### 좌표계 주의 (반드시)
- **Three의 `setViewport(x, y, w, h)` / `setScissor(x, y, w, h)`는 좌하단(bottom-left) 원점, +y 위로**.
- 좌/우 분할은 x로만 나누고 y는 0(바닥)부터 전체 높이를 쓰므로 상하 반전 문제는 없다. 단, 순수 유틸에서 좌표 의미를 “Three 뷰포트 규약(좌하단 원점)”으로 못박아 둔다.

### 카메라 2개
- `cameraL`, `cameraR`: 각각 `THREE.PerspectiveCamera(fov, aspect, near, far)`.
- **aspect = (절반 폭) / 높이 = (width/2) / height** — 전체 폭이 아님에 주의(분할로 가로가 절반이 되므로).
- M0 배치: 각 플레이스홀더 기체의 뒤·위 고정 오프셋(예: 기체 기준 `position = plane.pos + (0, +8, +20)`, `lookAt(plane.pos)`). 실제 추격 부착/스무딩은 M4.

### 씬
- M0는 **공유 씬 1개**(`scene`)로 충분(두 기체·배경이 같은 월드). 두 카메라가 같은 씬을 각자 시점으로 그린다.
- 배경: `scene.background = new THREE.Color(하늘색)` 또는 위쪽 하늘 + 아래쪽 큰 평면(바다, `y=0`에 가로 4km급 PlaneGeometry, 파란 `MeshBasicMaterial`/`MeshStandardMaterial`). 조명은 `HemisphereLight` 또는 `AmbientLight + DirectionalLight` 최소 1쌍.
- 플레이스홀더 기체: P1/P2 각각 콘(`ConeGeometry`) 또는 박스(`BoxGeometry`) 메시. 색은 임시(P1 파랑·P2 빨강), 서로 다른 x 위치(예: `(-40,30,0)`, `(40,30,0)`)에 배치해 각 카메라가 자기 기체를 본다.

### 렌더 루프 (driving_game 관례)
```js
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);  // delta clamp(0.05) — CGs 관례
  // M0: dt로 플레이스홀더 살짝 회전(움직임 확인용) 정도만. 게임 로직 없음.
  renderViews();
}
```

### renderViews() 의사코드
```js
function renderViews() {
  const w = canvas.width, h = canvas.height;      // 픽셀 크기(devicePixelRatio 반영 주의)
  const [vpL, vpR] = splitViewports(w, h);        // 순수 유틸 사용
  renderer.setScissorTest(true);

  // 좌(P1)
  renderer.setViewport(vpL.x, vpL.y, vpL.w, vpL.h);
  renderer.setScissor(vpL.x, vpL.y, vpL.w, vpL.h);
  renderer.render(scene, cameraL);

  // 우(P2)
  renderer.setViewport(vpR.x, vpR.y, vpR.w, vpR.h);
  renderer.setScissor(vpR.x, vpR.y, vpR.w, vpR.h);
  renderer.render(scene, cameraR);
}
```

> **픽셀 단위 주의**: `setViewport/setScissor`에 넘기는 값은 렌더러의 drawing buffer 픽셀 기준이다. `renderer.setSize(W,H)` + `setPixelRatio`를 쓰면 내부 버퍼는 `W*ratio × H*ratio`. M0에서는 `setPixelRatio(window.devicePixelRatio)` 후 `splitViewports`에 **CSS 픽셀(window.innerWidth/Height)**을 넘기되, viewport/scissor는 Three가 ratio를 곱해 처리하는 단위에 맞춰야 한다. 단순화 위해 M0 권장: `splitViewports(window.innerWidth, window.innerHeight)`로 계산하고 Three의 `setViewport`에 그대로 전달(Three는 setSize에 넘긴 CSS 크기 좌표계를 사용). 구현 시 좌/우 경계에 한 줄 틈/겹침이 없는지 육안 확인.

---

## 6. 순수 유틸: `src/render/viewport.js`

THREE 비의존 순수 함수. 입력은 숫자, 출력은 평범한 객체 배열.

### 시그니처
```js
/**
 * 단일 캔버스를 좌/우 2뷰포트로 분할한다.
 * 좌표계는 Three 뷰포트 규약(좌하단 원점, +y 위). 좌·우는 x로만 분할.
 * @param {number} width  - 전체 폭(px)
 * @param {number} height - 전체 높이(px)
 * @returns {[{x,y,w,h},{x,y,w,h}]} [좌(P1), 우(P2)] 사각형
 */
export function splitViewports(width, height) { ... }
```

### 반환 규약
- 좌(P1): `{ x: 0,                y: 0, w: floor(width/2),          h: height }`
- 우(P2): `{ x: floor(width/2),  y: 0, w: width - floor(width/2),  h: height }`
- **`floor`로 좌측 폭을 정하고 우측은 나머지(width − 좌폭)**로 잡아 **두 폭의 합 = width**(홀수 폭에서도 1px 틈/겹침 없음)를 보장한다.
- 높이는 둘 다 전체 `height`, y는 둘 다 0.

> 향후 4분할/세로 분할 확장 여지가 있으나 M0는 좌/우 2분할 고정. 시그니처는 단순 유지.

---

## 7. 단위 테스트 가이드

### tests/viewport.test.js — `splitViewports`
다음 케이스를 검증한다.
- **짝수 폭**: `splitViewports(800, 600)` → 좌 `{0,0,400,600}`, 우 `{400,0,400,600}`.
- **합 = 전체**: 반환된 좌.w + 우.w === width (임의 폭, 특히 홀수).
- **홀수 폭 경계**: `splitViewports(801, 600)` → 좌.w=400, 우.w=401, 우.x=400 (틈/겹침 0: 우.x === 좌.w, 좌.x+좌.w === 우.x).
- **y/h 규약**: 두 사각형 모두 `y===0`, `h===height`.
- **좌측 원점**: 좌.x === 0.
- (선택) 0/음수 등 비정상 입력은 M0 범위 밖 — 정상 양수 입력만 다룬다.

### tests/smoke.test.js — Vitest 동작 확인
driving_game과 동일하게 `1+1===2` 수준 + (선택) `import { splitViewports } from '../src/render/viewport.js'`가 함수인지 확인해 모듈 import 경로가 살아있는지 본다.

```js
import { describe, it, expect } from 'vitest';
import { splitViewports } from '../src/render/viewport.js';
describe('M0 스모크', () => {
  it('Vitest 동작', () => { expect(1 + 1).toBe(2); });
  it('viewport 모듈 import', () => { expect(typeof splitViewports).toBe('function'); });
});
```

> `main.js`/`render/*`의 THREE 의존 코드는 단위 테스트 대상이 아니다(노드 환경 비의존 원칙). 검증은 `npm run dev` 수동 확인 + `npm run build` 통과로 갈음.

---

## 8. M0 완료 기준 (Acceptance)

- [ ] `npm install` 후 `npm run dev` → localhost:5173 접속 시 한 화면이 **좌/우로 분할**되고 각 뷰포트에 **플레이스홀더 기체 + 하늘/바다 배경**이 보인다.
- [ ] 좌·우 경계에 **틈/겹침이 없다**(전체 폭을 빈틈없이 채움).
- [ ] 창 크기를 바꾸면 분할 비율·각 카메라 aspect가 깨지지 않고 갱신된다.
- [ ] `npm test` → 스모크 + `splitViewports` 테스트 전부 그린.
- [ ] `npm run build` → `dist/` 번들 에러 없이 생성.
- [ ] 코딩스타일 준수: ES 모듈, camelCase/UPPER_SNAKE, 2-space, 한국어 주석, delta clamp(0.05), 순수 로직(viewport.js) THREE 비의존.

---

## 9. 영향 범위 / 다음 마일스톤 연결

- **신규 파일만 추가**(기존 코드 없음). 기존 동작 회귀 위험 없음.
- 결선 지점(이후 마일스톤이 main.js에 붙는 자리):
  - **M1 (flight.js)**: `step(dt, input)` 결과로 각 기체의 `position/orientation`을 갱신 → 렌더 루프의 “플레이스홀더 회전” 자리에 결선, 카메라가 그 기체를 추격하도록 오프셋 적용.
  - **M2 (input.js)**: 키 이벤트 → 정규화 입력 → 위 `step`의 `input` 인자로 공급.
  - **M3/M4 (terrain/render)**: 임시 바다 평면·플레이스홀더 메시를 실제 지형 메시·기체 메시로 교체. `scene` 구성은 `render/scene.js`로 이관.
- `splitViewports`는 M9 HUD(각 분할 뷰 영역에 HUD 배치)에서도 재사용된다.
- 본 문서는 작업 후 `mds/INDEX.md`의 설계(design) 항목과 마일스톤 표(M0 상태)에 등록한다. (단, INDEX 갱신은 이 설계 작업 범위 밖 — 구현/완료 시 처리)
