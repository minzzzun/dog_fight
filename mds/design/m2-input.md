# 설계 — input.js (M2, 2P 키 매핑 · 순수 로직)

> 순수 모듈(Three.js·DOM 비의존). 키 코드 문자열·평범한 객체/불리언/숫자만 입출력해 Vitest로 그대로 테스트한다.
> DOM 이벤트(`keydown`/`keyup`) 부착·`preventDefault` 호출은 **main.js**가 담당. input.js는 상태/매핑/판정만 한다.
> SSoT는 `mds/spec/seed.md`(조작 바인딩·ONTOLOGY `inputs.*`). 키 코드는 `KeyboardEvent.code` 기준(키보드 레이아웃 무관).
> 참고 사례: `/Users/kimminjun/Desktop/CGs/driving_game/src/input.js`(down Set·엣지 소비·readControls 패턴).

---

## 1. 책임 경계 (왜 이렇게 나누는가)

| 레이어 | 책임 |
|---|---|
| **main.js (DOM)** | 캔버스/window에 `keydown`/`keyup` 리스너 부착. 핸들러가 `onKeyDown/onKeyUp(state, e.code)`를 호출하고, 반환값이 `true`면(=매핑된 키) `e.preventDefault()` 호출(화살표 스크롤·`/` 빠른검색 등 차단). 키 반복(`e.repeat`) 무시는 onKeyDown 내부의 "이미 down" 판정이 흡수. |
| **input.js (순수)** | 두 플레이어의 키→정규화 입력 변환. held(연속) 상태는 `down` Set으로, edge(1회) 상태는 `pending` 플래그로 보유. `readInputs(state)`가 프레임마다 호출되어 정규화 입력을 반환하고 **엣지를 소비**(소비 = pending을 false로 리셋). |
| **flight.js (M1)** | `readInputs`가 돌려준 `{pitch, roll, boost, brake}` 부분집합을 그대로 `stepFlight`에 넘긴다. flight는 무기 입력(gun/missile/flare)을 무시. |
| **gun.js (M5)** | `gun`(held bool)을 매 프레임 받아 연사 타이밍(쿨다운/연사속도)·탄창·재장전을 **자체 판정**. input은 "지금 발사키 눌려있나"만 알려준다. |
| **missile.js (M6) / combat.js** | `missile`(edge bool, 누른 순간 1회 true)을 받아 **락온 시작 / 발사 판정을 자체 수행**. input은 "미사일 키가 눌린 엣지"만 제공하고 락온 진행(2초)·락 콘·사거리·수동발사 vs 자동발사 같은 판정은 일절 하지 않는다(seed §미사일 키 동작 권고를 M6이 해석). |
| **flare.js (M7)** | `flare`(edge bool)를 받아 전개·쿨다운·잔량을 자체 판정. input은 엣지만 제공. |

> 핵심 원칙: **input.js는 "키 → 의도(intent)"만 정규화**한다. 무엇이 발사 가능한지, 락이 걸렸는지, 쿨다운이 남았는지 같은 게임 규칙 판정은 무기/전투 모듈의 몫. 이렇게 해야 input 테스트가 키 매핑 자체에만 집중되고 결정론적이다.

---

## 2. KEYMAP — 동작 → KeyboardEvent.code (seed §조작 바인딩 반영)

플레이어별로 KEYMAP을 분리한다. 값은 항상 **배열**(대체 키를 받기 위함, driving_game 관례와 동일).

```js
export const KEYMAP = {
  p1: {
    pitchUp:   ['KeyW'],       // 기수 위 (피치 +)
    pitchDown: ['KeyS'],       // 기수 아래 (피치 -)
    rollLeft:  ['KeyA'],       // 좌 뱅크 (롤 -)
    rollRight: ['KeyD'],       // 우 뱅크 (롤 +)
    boost:     ['ShiftLeft'],  // 부스터
    brake:     ['KeyQ'],       // 감속
    gun:       ['KeyE'],       // 기관총 (홀드 연사)
    missile:   ['KeyR'],       // 미사일 (엣지: 락온/발사)
    flare:     ['KeyF'],       // 플레어 (엣지: 전개)
  },
  p2: {
    pitchUp:   ['ArrowUp'],
    pitchDown: ['ArrowDown'],
    rollLeft:  ['ArrowLeft'],
    rollRight: ['ArrowRight'],
    boost:     ['ShiftRight'],
    brake:     ['Slash'],          // '/'
    gun:       ['Period'],         // '.'
    missile:   ['Comma'],          // ','
    flare:     ['ControlRight', 'KeyM'],  // RightCtrl 또는 M (seed 권고 — 둘 다 허용)
  },
};
```

### 전체 매핑 표 (P1 / P2 × 동작 → code)

| 동작 | 종류 | P1 (좌) code | P2 (우) code |
|---|---|---|---|
| 피치 ↑ (기수 위) | held(축) | `KeyW` | `ArrowUp` |
| 피치 ↓ (기수 아래) | held(축) | `KeyS` | `ArrowDown` |
| 롤 ← (좌 뱅크) | held(축) | `KeyA` | `ArrowLeft` |
| 롤 → (우 뱅크) | held(축) | `KeyD` | `ArrowRight` |
| 부스터 | held(bool) | `ShiftLeft` | `ShiftRight` |
| 감속 | held(bool) | `KeyQ` | `Slash` |
| 기관총 | held(bool) | `KeyE` | `Period` |
| 미사일(락온/발사) | **edge** | `KeyR` | `Comma` |
| 플레어(전개) | **edge** | `KeyF` | `ControlRight` 또는 `KeyM` |

> **키 충돌 검증**: P1은 좌측(WASD + 좌Shift + QEF R), P2는 우측(화살표 + 우Shift + Slash/Period/Comma + RightCtrl/M)으로 완전히 분리되어 한 키보드를 공유해도 겹치는 code가 없다. 유일한 주의점은 P2 `flare`의 대체키 `KeyM` — P1 영역과 겹치지 않으나, 실행 단계(seed §튜닝)에서 RightCtrl/M 중 하나로 최종 택일하면 더 명확하다. 설계상 둘 다 매핑해 둔다.
> **preventDefault 대상**: `ArrowUp/Down/Left/Right`(페이지 스크롤), `Slash`(Firefox 빠른검색), `ShiftLeft/Right`·`ControlRight`(브라우저 단축키 조합 영향) 등 — 매핑된 모든 키에서 preventDefault하면 안전. onKeyDown/onKeyUp이 매핑 여부를 bool로 돌려주므로 main이 그 값으로 일괄 처리.

---

## 3. 상태 객체 (createInput)

플레이어별 down Set + pending 엣지 플래그를 하나의 상태에 담는다.

```js
export function createInput() {
  return {
    down: new Set(),        // 현재 눌린 모든 code (P1/P2 공용 — code가 고유하므로 충돌 없음)
    pending: {
      p1: { missile: false, flare: false },
      p2: { missile: false, flare: false },
    },
  };
}
```

- `down`은 양 플레이어가 공유하는 단일 Set이다. code 문자열이 전역적으로 고유하므로 플레이어를 나눠 저장할 필요가 없다(읽을 때 각자의 KEYMAP으로 조회).
- `pending`만 플레이어별로 분리한다(엣지는 누가 눌렀는지 구분해 소비해야 하므로).

---

## 4. API 시그니처

```js
// 상수: 플레이어별 동작→code 매핑
export const KEYMAP;

// 상태 생성
export function createInput() → state

// keydown 처리. 매핑된 키면 true(=main이 preventDefault), 아니면 false.
//  - 처음 눌린(rising-edge) 미사일/플레어 키는 해당 플레이어 pending을 true로 세팅.
//  - 이미 down인 키(키 리피트)면 엣지를 다시 세우지 않음(중복 트리거 방지).
export function onKeyDown(state, code) → boolean

// keyup 처리. down에서 제거. 매핑된 키면 true 반환(대칭성·preventDefault용).
export function onKeyUp(state, code) → boolean

// 현재 상태 → 양 플레이어 정규화 입력. 엣지(missile/flare)는 읽으며 소비.
export function readInputs(state) → {
  p1: { pitch, roll, boost, brake, gun, missile, flare },
  p2: { pitch, roll, boost, brake, gun, missile, flare },
}
```

### 보조(내부)

```js
function has(state, codes) { return codes.some((c) => state.down.has(c)); }
// 모든 매핑 code의 평탄 집합(매핑 여부 빠른 판정용)
const ALL_MAPPED = new Set([...flatten(KEYMAP.p1), ...flatten(KEYMAP.p2)]);
// code → 어느 플레이어의 어느 엣지 동작인지(onKeyDown에서 pending 세팅용) 역인덱스
```

---

## 5. readInputs 반환 스펙 (플레이어 1인분)

```js
{
  pitch:   number,   // -1 | 0 | 1  (pitchUp held? +1 : 0) - (pitchDown held? +1 : 0) → 둘 다면 0
  roll:    number,   // -1 | 0 | 1  (rollRight held? +1 : 0) - (rollLeft held? +1 : 0) → 둘 다면 0
  boost:   boolean,  // boost 키 held
  brake:   boolean,  // brake 키 held
  gun:     boolean,  // gun 키 held (홀드 연사 — 연사 타이밍은 M5)
  missile: boolean,  // edge: 이 readInputs 호출에서 1회만 true, 즉시 소비
  flare:   boolean,  // edge: 동일
}
```

### held(연속) — `down` Set 직접 조회

- **pitch 축**: `(has(pitchUp) ? 1 : 0) - (has(pitchDown) ? 1 : 0)`. 양쪽 동시 → `0`. flight 규약(§flight §4: `+`면 기수 위)과 부호 일치 — `pitchUp = +1`.
- **roll 축**: `(has(rollRight) ? 1 : 0) - (has(rollLeft) ? 1 : 0)`. 양쪽 동시 → `0`. flight 규약(`+`면 우 뱅크)과 일치 — `rollRight = +1`.
- **boost / brake / gun**: 해당 codes 중 하나라도 down이면 `true`. (boost+brake 동시 우선순위는 flight가 처리 — input은 둘 다 true로 그대로 전달.)

### edge(1회 소비) — `pending` 플래그 조회 후 리셋

- **missile / flare**: `state.pending[pX].missile` 값을 읽어 반환하고, 곧바로 `false`로 리셋(소비). 누른 순간(rising edge)에 단 1회만 true가 되며, 키를 계속 눌러도(홀드) 추가 엣지는 발생하지 않는다(키를 뗐다 다시 눌러야 다음 엣지).
- 한 프레임에 `readInputs`를 두 번 호출하면 두 번째는 `missile/flare = false`(이미 소비). main 루프는 프레임당 1회만 호출하는 게 정상.

> **held vs edge 요약**: 비행 조종(pitch/roll)과 지속 동작(boost/brake/gun 홀드 연사)은 매 프레임 현재 상태를 그대로 반영하는 held. 미사일/플레어는 "누른 순간 1회 트리거"라는 의미가 핵심이라 edge로 둔다(홀드해도 미사일 연발·플레어 연속 전개가 되지 않게). flight가 쓰는 `{pitch, roll, boost, brake}`는 이 반환 객체의 부분집합이므로 `const { pitch, roll, boost, brake } = inputs.p1;`로 그대로 넘기면 된다.

---

## 6. 동작 흐름 (main 결선 예시 — 참고용, 구현은 M2가 아닌 main)

```js
const input = createInput();
window.addEventListener('keydown', (e) => { if (onKeyDown(input, e.code)) e.preventDefault(); });
window.addEventListener('keyup',   (e) => { if (onKeyUp(input, e.code))   e.preventDefault(); });

// 렌더 루프 안 (프레임당 1회)
const { p1, p2 } = readInputs(input);
plane1 = stepFlight(plane1, p1, dt);   // p1의 pitch/roll/boost/brake 부분집합 사용
plane2 = stepFlight(plane2, p2, dt);
// gun: gunStep(..., p1.gun)  /  missile: if (p1.missile) onMissileKey(...)  /  flare: if (p1.flare) deployFlare(...)
```

---

## 7. 결정론 / 순수성

- 난수·`Date.now`·전역 상태 미사용. 상태는 인자로 받은 `state`만 변경(down Set 추가/삭제, pending 토글). 키 입력 시퀀스가 같으면 readInputs 결과도 항상 같다.
- `readInputs`는 엣지를 소비하므로 **부수효과(pending 리셋)가 있는** 함수다(driving_game `readControls`와 동일). held 조회는 순수 읽기. 이 비대칭은 의도된 설계이며 테스트에서 "두 번째 read는 false"로 못박는다.

---

## 8. 단위 테스트 가이드 (`tests/input.test.js`)

`createInput` → `onKeyDown`/`onKeyUp` → `readInputs` 시퀀스로 검증. import는 `{ createInput, onKeyDown, onKeyUp, readInputs, KEYMAP }`.

1. **held 키다운 반영**: P1 `KeyW` down → `readInputs().p1.pitch === 1`. `KeyS` down → `pitch === -1`. `KeyD` → `roll === 1`, `KeyA` → `roll === -1`.
2. **pitch 축 합성(양키 동시→0)**: `KeyW` + `KeyS` 동시 down → `p1.pitch === 0`. (롤도 `KeyA`+`KeyD` → 0.)
3. **boost / brake / gun bool**: `ShiftLeft` → `p1.boost === true`; `KeyQ` → `brake === true`; `KeyE` → `gun === true`. 누르지 않으면 모두 false.
4. **gun held 유지**: `KeyE` down 후 `readInputs` 여러 번 연속 호출 → 매번 `gun === true`(held는 소비되지 않음).
5. **missile 엣지 1회 소비**: `KeyR` down → 첫 `readInputs().p1.missile === true`, 두 번째 호출은 `false`(연속 read). 키를 계속 누른 채라도 두 번째는 false.
6. **flare 엣지 1회 소비**: `KeyF`(P1) / `ControlRight`(P2) 동일 — 첫 read true, 다음 false.
7. **엣지 재트리거**: missile 키 down→read(true)→up→다시 down→read → 다시 `true`(뗐다 누르면 새 엣지).
8. **키 리피트 무시**: 같은 missile 키로 onKeyDown을 (up 없이) 두 번 호출해도 pending은 1회만 → read는 한 번만 true.
9. **매핑 안 된 키 무시**: `onKeyDown(state, 'KeyZ') === false`, readInputs 결과에 영향 없음(모든 값 기본). 매핑된 키는 `onKeyDown` 반환 `true`.
10. **onKeyUp 해제**: `KeyW` down→up 후 `p1.pitch === 0`. boost/gun 등 held도 up 후 false.
11. **P1/P2 독립**: P1 `KeyW`(pitch+1)와 P2 `ArrowDown`(pitch-1) 동시 → `p1.pitch === 1` && `p2.pitch === -1`. P1 키를 눌러도 P2 출력은 기본값 유지(상호 간섭 없음).
12. **P2 매핑 정확성**: `ArrowUp→p2.pitch=1`, `ArrowLeft→p2.roll=-1`, `ArrowRight→p2.roll=1`, `Slash→p2.brake`, `Period→p2.gun`, `Comma→p2.missile(edge)`, `ShiftRight→p2.boost`.
13. **flare 대체키**: P2 `KeyM` 또는 `ControlRight` 둘 중 무엇으로 down해도 `p2.flare` 엣지 발생.
14. **preventDefault 신호**: 매핑된 화살표/Slash 등에서 `onKeyDown`이 `true` 반환(main이 이 값으로 preventDefault).

---

## 9. 영향 범위 / 인터페이스

- **main.js (M4/M0 결선)**: `keydown`/`keyup` 리스너 → `onKeyDown/onKeyUp` 호출 + 반환 bool로 `preventDefault`. 렌더 루프에서 프레임당 1회 `readInputs` → `{p1, p2}`를 각 모듈에 분배. 시작화면/결과창 상태(`session.state` ≠ 'fighting')에선 readInputs 결과를 무시하거나 호출 안 함(메뉴 입력은 별도 처리 — M11).
- **flight.js (M1)**: `{pitch, roll, boost, brake}` 부분집합을 그대로 `stepFlight(plane, input, dt)`에 전달. 부호 규약(pitch+ = 기수 위, roll+ = 우 뱅크)이 flight §4와 일치.
- **gun.js (M5)**: `p.gun`(held bool)을 매 프레임 전달. 연사 속도·탄창·재장전은 M5 자체 판정.
- **missile.js (M6) / combat.js**: `p.missile`(edge bool)만 전달. 락온 시작(2초)·락 콘(~15°)·사거리(~150~1200m)·수동 vs 자동 발사 택일은 전부 M6 책임(seed §미사일 키 동작 권고 해석).
- **flare.js (M7)**: `p.flare`(edge bool)만 전달. 전개·디코이·쿨다운·잔량은 M7 자체 판정.

## 10. 다음 단계 연결

- M2 구현: `src/input.js` 작성 + `tests/input.test.js` 그린 → 커밋(기능 단위).
- M4/main 결선 시 M0 플레이스홀더 입력을 `readInputs` 기반으로 교체.
- 튜닝 영역(seed §튜닝): P2 flare 키(RightCtrl vs M) 최종 택일은 KEYMAP 배열만 줄이면 됨(테스트 유지).
