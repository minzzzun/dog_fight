# 설계 — flight.js (M1, 아케이드 비행 모델 · 순수 로직)

> 순수 모듈(Three.js 비의존). `{x,y,z}`·숫자·불변 상태만 입출력해 Vitest로 그대로 테스트한다.
> SSoT는 `mds/spec/seed.md`(전투 수치·ACCEPTANCE). 수치는 출발점이며 실행 단계에서 튜닝 가능(명세 불변 범위).

---

## 1. 좌표/방향 규약 (M0 정합)

M0 스캐폴드(`src/main.js`)에서 플레이스홀더 기체는 **기수가 -Z(전방)**, 추격 카메라는 **+Z(기체 뒤)**에 둔다. 이 규약을 그대로 따른다.

- 월드 좌표: 오른손 좌표계, **+Y 위(고도)**, **수면 y=0**.
- 기체 로컬 기준 프레임(자세에 따라 회전):
  - **forward** = 전진 방향(기수). 기본 자세(yaw=pitch=roll=0)에서 `(0, 0, -1)`.
  - **up** = 천장 방향. 기본 자세에서 `(0, 1, 0)`.
  - **right** = `forward × up`(왼손 외적 아님, `cross(up, forward)` 등 한 가지로 고정). 기본 자세에서 `(1, 0, 0)` 근방 — 헬퍼 정의에 한 방향으로 못박는다.
- 위치 적분: `pos += forward * speed * dt` (speed는 m/s, 항상 전진 +).
- 각도 단위: 라디안. 각속도: rad/s.

> 카메라(M4)는 `pos + (back·dist) + (up·height)` 식으로 forward/up을 받아 배치하면 M0의 고정 오프셋을 자세 추종형으로 자연 확장할 수 있다.

---

## 2. 상태 표현 결정 — yaw/pitch/roll 오일러 (권장안)

세 후보를 검토한다.

| 후보 | 장점 | 단점 |
|---|---|---|
| **오일러 yaw/pitch/roll** | 스칼라 3개 → 테스트가 직관적("롤각이 0으로 복원되는가"를 숫자 1개로 단언). 자동 수평 안정·경계 선회를 각도 보간으로 단순 표현. | 짐벌락(pitch ±90°), 적분 누적 시 표현 모호. |
| forward 단위벡터 + roll각 | 짐벌락 회피, forward를 바로 위치 적분에 사용. | 벡터 정규화·롤 기준축 관리 필요, 테스트가 벡터 비교라 다소 번거로움. |
| 직접 구현 쿼터니언 | 짐벌락 완전 회피, 합성 깔끔. | 라이브러리 없이 직접 구현 → 부호/순서 버그 위험·테스트 가독성 최악. 아케이드엔 과함. |

**결정: 오일러 `yaw/pitch/roll`을 1차 상태로 보유**하고, `forward`/`up`/`right`는 매 스텝 **순수 헬퍼로 파생**한다.

- 짐벌락 회피책(아케이드라 충분):
  - **pitch를 ±PITCH_LIMIT(≈ ±80°, 1.4rad)로 클램프** → 천정/천저 특이점을 애초에 진입 금지. 아케이드 도그파이트는 완전 수직기동이 불필요하므로 자연스럽다.
  - 스톨 없음(seed) → 받음각/실속 모델 없음. pitch는 순수 자세각.
- 회전 합성 순서(자세→방향벡터): **yaw(Y축) → pitch(X축) → roll(Z축)** 고정. 헬퍼에서 이 순서로만 계산한다.

### 상태 객체 (불변)

```js
{
  x, y, z,          // 월드 위치(m). y=고도, 수면 0
  yaw,              // 방위각(rad). 0 → forward=(0,0,-1), yaw↑ → 좌선회(반시계, +Y축 회전)
  pitch,            // 받음각 아닌 자세 피치(rad). +면 기수 위로
  roll,             // 뱅크각(rad). +면 오른쪽으로 기움
  speed,            // 전진 속도(m/s)
  warning,          // bool: 경계 margin 안에 들어와 이탈 경고 중인가
}
```

> 파생값(`forward`, `up`, `right`, 중심까지 거리 등)은 상태에 저장하지 않고 헬퍼로 계산한다(상태 최소화·중복방지).

---

## 3. 상수 (출발점 — 튜닝 가능)

```js
// 속도(m/s) — seed 전투 수치
export const BASE_SPEED  = 120;   // 기본 순항
export const BOOST_SPEED = 180;   // 부스터 목표
export const BRAKE_SPEED = 70;    // 감속 목표
export const MIN_SPEED   = 70;    // 하한(아케이드: 스톨 없음, 이 밑으론 안 떨어짐)
export const MAX_SPEED   = 180;   // 상한
export const ACCEL       = 90;    // 목표속도로의 가속률(m/s²) — 부스터 가속 체감
export const DECEL       = 120;   // 목표속도로의 감속률(m/s²) — 브레이크가 더 빠릿

// 자세 레이트(rad/s) — 아케이드 감각, 속도 무관(또는 약하게 연동)
export const PITCH_RATE  = 1.2;   // 피치 입력 최대 시 각속도
export const ROLL_RATE   = 2.4;   // 롤 입력 최대 시 각속도(롤이 빠릿해야 뱅크턴 경쾌)
export const YAW_FROM_ROLL = 1.0; // 뱅크턴 계수: 롤각 → yaw 선회율(rad/s per rad) ※ §5

// 자동 수평 안정(입력 없을 때 복원)
export const ROLL_LEVEL_RATE  = 2.0; // 롤 0 복원 각속도(rad/s) — 빠릿하게 수평
export const PITCH_LEVEL_RATE = 0.8; // 피치 0 복원 각속도(rad/s) — 완만하게(고도 유지 느낌)

// 자세 한계(짐벌락 회피)
export const PITCH_LIMIT = 1.4;   // ≈ ±80°
export const ROLL_LIMIT  = 1.4;   // 시각적 뱅크 한계(과회전 방지). 선회는 yaw가 담당

// 월드 경계 — seed: ~4km × 4km, 고도 천장~해수면
export const WORLD_HALF   = 2000; // 중심 0 기준 ±2000m (x,z)
export const CEILING      = 1500; // 고도 천장(y 상한)
export const FLOOR        = 0;    // 해수면(y 하한, 충돌은 M8 combat에서 즉사 처리)
export const BOUND_MARGIN = 300;  // 경계에서 이 거리 안이면 warning + 강제선회 개입
export const RETURN_RATE  = 0.6;  // 중심 방향으로 yaw를 당기는 최대 각속도(rad/s)

export const SPAWN_Y = 300;       // 기본 스폰 고도
```

> `MIN/MAX_SPEED`는 `BRAKE_SPEED`/`BOOST_SPEED`와 같게 둔다(아케이드라 목표속도가 곧 한계). 별도 상수로 두어 추후 관성 오버슈트 튜닝 여지를 남긴다.

---

## 4. 입력 모델

M2(`input.js`)가 키→아래 형태로 정규화해 넘긴다. flight.js는 이 객체만 소비한다.

```js
input = {
  pitch: number,   // -1..1 (+ 기수 위로 / - 아래로)
  roll:  number,   // -1..1 (+ 오른쪽 뱅크 / - 왼쪽)
  boost: boolean,  // 부스터(목표=BOOST_SPEED)
  brake: boolean,  // 감속(목표=BRAKE_SPEED)
  // fireGun/missile/flare 등 무기 입력은 flight가 무시(M5~M7이 소비)
}
```

- 아케이드: **yaw 직접 입력 없음**. 선회는 **롤(뱅크) → yaw**의 뱅크턴으로만 발생(§5).
- boost·brake 동시 입력 시 우선순위: **brake 우선**(방어 기동 우선). 둘 다 false면 목표=BASE_SPEED.

---

## 5. 적분 수식 (stepFlight)

`stepFlight(state, input, dt)` → 새 상태. 순서: 속도 → 롤 → 피치 → yaw(뱅크턴+경계) → 위치 → warning.

### (a) 속도 — 목표속도로 비율 가감속

```
target = input.brake ? BRAKE_SPEED : input.boost ? BOOST_SPEED : BASE_SPEED
rate   = (target < speed) ? DECEL : ACCEL
speed  = moveToward(speed, target, rate * dt)   // target을 넘어서지 않게 clamp
speed  = clamp(speed, MIN_SPEED, MAX_SPEED)
```
`moveToward(a, b, maxStep)` = `|b-a| <= maxStep ? b : a + sign(b-a)*maxStep` (오버슈트 없음 → 결정론).

### (b) 롤 — 입력 적분 + 자동 수평 복원

```
if (input.roll != 0)
  roll += input.roll * ROLL_RATE * dt
else
  roll  = moveToward(roll, 0, ROLL_LEVEL_RATE * dt)   // 입력 없으면 0으로 복원
roll = clamp(roll, -ROLL_LIMIT, ROLL_LIMIT)
```

### (c) 피치 — 입력 적분 + (약한) 자동 복원

```
if (input.pitch != 0)
  pitch += input.pitch * PITCH_RATE * dt
else
  pitch  = moveToward(pitch, 0, PITCH_LEVEL_RATE * dt) // 완만히 수평으로
pitch = clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT)
```

### (d) yaw — 뱅크턴(롤각에 비례) + 경계 강제선회

뱅크턴: 비행기는 롤(뱅크)을 주면 그 방향으로 선회한다. **롤각이 클수록 빠르게 선회**.
```
yawRate = -roll * YAW_FROM_ROLL          // 오른쪽 뱅크(roll>0) → 우선회(yaw 감소)
```
> 부호: yaw↑가 좌선회(+Y 반시계)이고 오른쪽 뱅크는 우선회여야 하므로 `-roll`. 헬퍼 forward 정의와 한 번에 정합되도록 구현 시 테스트로 못박는다(§7).

경계 강제선회(§6에서 산출한 `assist`)를 yaw에 가산:
```
yaw += (yawRate + boundaryYawAssist(state)) * dt
yaw = wrapAngle(yaw)                       // (-π, π] 정규화
```

### (e) 위치 — forward 따라 전진 + 천장/바닥 클램프

```
f = forwardOf({yaw, pitch, roll})         // §8 헬퍼(롤은 위치에 무관, yaw/pitch만 기여)
x += f.x * speed * dt
y += f.y * speed * dt
z += f.z * speed * dt
y = clamp(y, FLOOR, CEILING)              // 고도 한계(부드럽게 막음, 사망 아님)
```
> 천장에 닿으면 더 못 오르고 미끄러진다(클램프). 바닥(y=0) 클램프는 "닿음"을 만들고 **실제 수면 충돌 즉사는 M8 combat**이 `y<=0` 또는 `terrain.heightAt` 질의로 판정. flight는 음수 고도만 방지.

### (f) warning + 경계는 §6.

---

## 6. 월드 경계 — warning + 강제 선회(보이지 않는 벽)

수평(x,z) 경계만 강제선회로 다룬다(고도는 §5e 클램프). seed: "경계 근처 경고 → 더 나가면 서서히 강제 선회로 복귀, 경계 사망 없음".

- **이탈 정도**: `dx = |x| - (WORLD_HALF - BOUND_MARGIN)`, z도 동일. margin 안으로 들어오면 양수.
- **warning 플래그**: `warning = (x,z 중 하나라도 margin 침범) || (|x|>WORLD_HALF || |z|>WORLD_HALF)`. HUD(M9)가 이 플래그로 "이탈 경고" 표시.
- **강제선회(boundaryYawAssist)**: 중심(0,0) 쪽으로 기수를 당긴다.
  ```
  toCenter = atan2 기반 '중심을 바라보는 yaw' 목표각 (수평 forward 기준)
  penetration = clamp(max(dx,dz) / BOUND_MARGIN, 0, 1)   // 0(경계밖 margin 진입)~1(경계 도달 이상)
  assist 방향 = wrapAngle(targetYaw - state.yaw) 의 부호
  return assist 방향 * RETURN_RATE * smooth(penetration)  // rad/s
  ```
  - `smooth(p)` = `p*p`(ease-in) 또는 선형 — margin 끝에선 약하게, 경계 도달 시 최대. 부드러운 복귀 곡선.
  - margin 밖(중앙부)에선 penetration=0 → assist 0 → 플레이에 개입 없음.
  - 위치 클램프/반사 없음 → 살짝 넘어가도 기수가 안쪽으로 휘며 자연 복귀.
- 결과: 경계 근처에서 조종은 가능하되 yaw가 중심 쪽으로 지속적으로 보정되어 빠져나가지 못한다.

> `targetYaw`(중심 방향)는 수평면 투영으로 계산: 중심 - 현재위치의 (x,z)에서 forward 규약과 같은 각도 정의를 써 `yaw = atan2(-(0-x_eff)... )` 형태. 구현 시 forwardOf와 동일한 각↔벡터 변환을 재사용해 부호 일치 보장(테스트로 검증).

---

## 7. 불변 갱신 / 결정론

- `stepFlight`은 인자 state를 **변형하지 않고** 새 객체를 반환(spread + 갱신). driving_game `stepDynamics`와 동일 패턴.
- 난수·`Date.now`·전역 상태 미사용 → 같은 (state,input,dt)면 항상 같은 결과(결정론). 테스트·리플레이·동기화에 유리.
- dt는 호출자(main 렌더 루프)가 `Math.min(getDelta, 0.05)`로 클램프해 전달(CGs 관례). flight 내부는 dt를 그대로 신뢰(가변 dt 적분, 1차 오일러).

---

## 8. API 시그니처

```js
// 생성: 스폰 위치/초기 방위. 미지정 시 중앙·SPAWN_Y·정지 자세·BASE_SPEED.
export function createPlane(spawn = {}) → {
  x: spawn.x ?? 0, y: spawn.y ?? SPAWN_Y, z: spawn.z ?? 0,
  yaw: spawn.yaw ?? 0, pitch: 0, roll: 0,
  speed: spawn.speed ?? BASE_SPEED, warning: false,
}

// 한 스텝 적분. 새 불변 상태 반환.
export function stepFlight(state, input, dt) → newState

// 자세 → 방향 단위벡터 (순수 헬퍼). yaw→pitch→roll 순.
export function forwardOf(state) → {x,y,z}   // 기수 방향(롤 무관)
export function upOf(state)      → {x,y,z}   // 천장 방향(롤 반영) — 카메라/메시 정렬용
export function rightOf(state)   → {x,y,z}   // 우측 방향

// 보조(내부+테스트 노출 가능)
export function moveToward(a, b, maxStep) → number
export function wrapAngle(a) → number        // (-π, π]
```

호출 측 사용 예(M2/M4):
```js
plane = stepFlight(plane, input, dt);
const f = forwardOf(plane), u = upOf(plane);
// 카메라: pos - f*CHASE_DIST + u*CHASE_HEIGHT, lookAt = pos + f*LOOK_AHEAD
```

---

## 9. 단위 테스트 가이드 (`tests/flight.test.js`)

순수 mock 입력으로 검증. 무입력 = `{pitch:0,roll:0,boost:false,brake:false}`.

1. **직진**: 무입력·기본 자세에서 `stepFlight` → x,z 거의 불변, **z 감소(-Z 전진)**, 한 스텝 이동량 ≈ `BASE_SPEED*dt`. y 불변.
2. **forwardOf 규약**: yaw=0 → `(0,0,-1)`. yaw=+π/2 → x≈ +? (정의대로, 부호 못박기). pitch=+π/2(클램프 전) → forward.y>0(기수 위→상승). 정규화(길이 1).
3. **피치 적분 방향**: pitch 입력 +1로 몇 스텝 → state.pitch 증가, 이후 직진 시 y 증가(상승). -1 → 하강.
4. **롤 적분 방향**: roll +1 → state.roll 증가(우뱅크). 위치 y엔 직접 영향 없음(롤은 forward에 무기여).
5. **자동 수평 안정(롤 복원)**: roll을 0이 아닌 값으로 만든 뒤 무입력 여러 스텝 → roll이 0으로 단조 수렴(부호 안 바뀜, 오버슈트 없음).
6. **자동 피치 복원**: pitch≠0에서 무입력 → 0으로 완만 수렴(복원 속도 < 롤 복원).
7. **뱅크턴(롤→선회)**: roll>0 유지 → yaw가 한 방향으로 단조 변화(우선회). roll=0이면 yaw 불변. 부호 일치(우뱅크=우선회) 단언.
8. **부스터**: boost=true 여러 스텝 → speed가 BASE→BOOST로 증가, ACCEL 한도 내, BOOST 초과 안 함(clamp).
9. **감속**: brake=true → speed가 BRAKE로 감소, MIN 밑으로 안 떨어짐. boost+brake 동시 → brake 우선(목표=BRAKE).
10. **속도 한계**: 임의 speed에서도 MIN≤speed≤MAX 유지.
11. **경계 warning 발생**: 기체를 margin 안(예: x=WORLD_HALF-100)으로 스폰 → 첫 스텝 후 `warning===true`. 중앙(x=0)이면 false.
12. **강제선회로 중심 복귀**: 경계 근처에서 기수를 바깥(중심 반대)으로 향하게 두고 여러 스텝 적분 → yaw가 중심 방향으로 보정되고, 충분히 돌리면 |x| 또는 |z|가 다시 감소(안쪽 복귀). 위치가 ±WORLD_HALF를 크게 못 벗어남.
13. **고도 천장/바닥**: pitch 상승 입력으로 오래 적분 → y가 CEILING에서 멈춤(초과 없음). 하강 입력 → y가 FLOOR(0) 밑으로 안 감.
14. **결정론**: 동일 (state,input,dt) 2회 호출 → 깊은 동등(서로 다른 객체지만 값 동일).
15. **불변성**: `stepFlight` 호출 후 원본 state 객체의 필드가 변하지 않음(반환은 새 객체).
16. **wrapAngle/moveToward**: 경계값(±π 래핑, maxStep≥거리면 정확히 b 도달, 오버슈트 없음).

---

## 10. 영향 범위 / 인터페이스

- **M2 input.js**: `stepFlight`의 `input` 형태(pitch/roll/boost/brake)를 출력 계약으로 삼는다. 키 바인딩(seed §조작)은 input.js 책임, flight는 정규화된 값만 소비.
- **M4 render(추격 카메라·기체 메시)**: `forwardOf`/`upOf`/`rightOf`로 기체 자세를 THREE 회전/카메라 배치에 매핑. M0 `CHASE_OFFSET` 고정식을 forward/up 기반 자세추종식으로 교체. 기체 메시는 -Z 전방 규약(M0)과 일치.
- **M8 combat.js**: 위치 `{x,y,z}`로 `terrain.heightAt(x,z)` 질의해 지형/수면 충돌 즉사 판정. flight는 음수 고도만 막고, **충돌 판정은 combat 책임**(역할 분리). 미사일/탄(M5/M6)도 flight 위치·forward(발사 방향)를 참조.
- **M9 HUD**: `warning` 플래그로 이탈 경고 표시, `speed`로 속도계.

## 11. 다음 단계 연결

- M2에서 input.js 작성 → main 렌더 루프에 `plane = stepFlight(plane, input, dt)` 결선(M0 플레이스홀더 회전 대체).
- M4에서 forward/up 헬퍼로 추격 카메라·기체 자세 적용.
- 튜닝 영역(seed §구현 튜닝): 레이트/복원 강도/가감속/경계 복원 곡선은 그린 테스트 유지하며 상수만 조정.
