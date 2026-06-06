# M1 완료 — 비행 모델(아케이드, 순수)

## 구현

- `src/flight.js` (신규, THREE 비의존, named export):
  - 상태 `{pos{x,y,z}, yaw, pitch, roll, speed, warning}`. forward/up/right는 헬퍼로 파생.
  - 방향 규약: forward 기본 (0,0,-1), up (0,1,0). 회전순서 yaw→pitch→roll. 피치+ → 상승.
  - `createPlane(spawn)`, `stepFlight(state,input,dt)`(불변): 속도(boost/brake moveToward, brake 우선, MIN/MAX 클램프) → 롤(입력 적분/자동복원·ROLL_LIMIT) → 피치(입력/완만복원·PITCH_LIMIT) → yaw(뱅크턴 -roll·YAW_FROM_ROLL + 경계 보정) → 위치(forward·speed·dt, y FLOOR~CEILING).
  - 경계: margin(±300, WORLD_HALF 2000) 침범 시 warning + 접선↔중심 보간 강제선회(RETURN_RATE). 위치 클램프/사망 없음(충돌즉사는 M8).
  - 상수: BASE 120/BOOST 180/BRAKE 70, 레이트·복원·한계 설계값. `forwardOf/upOf/rightOf`, `moveToward`, `wrapAngle`.
  - input = {pitch(-1..1), roll(-1..1), boost, brake} (yaw 직접입력 없음 — 뱅크턴).

## 테스트

- `src/flight.test.js`(42) — 직진/forward 규약/피치·롤 적분/자동수평/뱅크턴/부스터·감속/속도한계/경계 warning·강제선회/고도 클램프/결정론·불변/moveToward·wrapAngle.
- 전체: **83 passed**. build 성공.

## 비고

- 경계 강제선회: 설계 "중심 정면" 식의 허점(안쪽 정렬 시 강제력 0→직진 이탈)을 접선↔중심 보간으로 보강.
- 순수 로직이라 브라우저 검증은 M2(입력)+M4(추격 카메라) 결선 후. 테스트 그린으로 검증.

## 연결

- M2 input → {pitch,roll,boost,brake} 공급. M4 추격 카메라(forwardOf/upOf). M8 충돌(pos→terrain). M9 HUD(warning/speed).

## 설계

- [design/m1-flight.md](../design/m1-flight.md)
