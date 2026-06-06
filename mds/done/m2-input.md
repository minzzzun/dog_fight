# M2 완료 — 2P 입력 매핑(src/input.js, 순수)

## 구현

- `src/input.js` (신규, THREE/DOM 비의존, named export):
  - `KEYMAP = {p1, p2}` — 동작별 code 배열. P1: pitchUp/Down(W/S)·rollLeft/Right(A/D)·boost(ShiftLeft)·brake(KeyQ)·gun(KeyE)·missile(KeyR)·flare(KeyF). P2: ↑/↓·←/→·ShiftRight·Slash·Period·Comma·flare(ControlRight,KeyM).
  - `createInput()` → {down:Set 공용, pending:{p1:{missile,flare}, p2:{...}}}.
  - `onKeyDown(state,code)→bool`(매핑 여부=preventDefault 신호, missile/flare는 rising-edge만 pending), `onKeyUp(state,code)→bool`.
  - `readInputs(state)` → {p1,p2} 각 {pitch,roll,boost,brake,gun,missile,flare}. held: pitch/roll=(+키)-(-키), boost/brake/gun=bool. edge: missile/flare 1회 소비.
- 부호: W→pitch+1/S→-1, D→roll+1/A→-1, ↑+1/↓-1, →+1/←-1 (flight 규약 일치). gun=홀드 연사, missile/flare=엣지.

## 테스트

- `src/input.test.js`(39) — held/축합성/bool/gun홀드/missile·flare 엣지 1회 소비·키리피트 무시/onKeyUp 해제/P2 매핑·flare 대체키/P1·P2 독립/preventDefault 신호.
- 전체: **122 passed**. build 성공.

## 연결

- main(M4)에서 DOM keydown/up 부착(매핑 시 preventDefault) + 프레임당 readInputs 1회(엣지 소비). flight는 {pitch,roll,boost,brake} 부분집합 사용. gun→M5, missile→M6, flare→M7.

## 설계

- [design/m2-input.md](../design/m2-input.md)
