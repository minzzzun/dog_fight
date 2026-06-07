// flight.js (M1) — 아케이드 비행 모델 (순수 로직, Three.js 비의존)
//
// 좌표 규약(설계 §1): 오른손, +Y 위(고도), 수면 y=0.
//   기본 자세(yaw=pitch=roll=0)에서 forward=(0,0,-1), up=(0,1,0), right=(1,0,0).
//   회전 합성 순서: yaw(Y축) → pitch(X축) → roll(Z축).
//   상태는 오일러 yaw/pitch/roll을 1차로 보유하고 forward/up/right는 헬퍼로 파생.
//
// stepFlight은 인자 state를 변형하지 않고 새 불변 객체를 반환(결정론).

// ── 상수 (설계 §3 — 출발점, 튜닝 가능) ────────────────────────────────

// 속도(m/s)
export const BASE_SPEED  = 120;   // 기본 순항
export const BOOST_SPEED = 210;   // 부스터 목표(가속)
export const BRAKE_SPEED = 8;     // 감속 목표 — 오래 누르면 엔진오프처럼 거의 정지(코브라 가능)
export const MIN_SPEED   = 8;     // 하한(거의 정지까지 허용 → 고받음각 코브라)
export const MAX_SPEED   = 210;   // 상한
export const ACCEL       = 55;    // 가속률(m/s²) — 엔진 스풀업처럼 점진적
export const DECEL       = 80;    // 감속률(m/s²) — 브레이크로 점진 감속

// 자세 레이트(rad/s)
export const PITCH_RATE  = 1.2;   // 피치 입력 최대 시 각속도
export const ROLL_RATE   = 2.4;   // 롤 입력 최대 시 각속도
export const YAW_FROM_ROLL = 1.0; // 뱅크턴 계수: 롤각 → yaw 선회율

// 자동 수평 안정(무입력 복원)
export const ROLL_LEVEL_RATE  = 2.0; // 롤 0 복원 각속도
export const PITCH_LEVEL_RATE = 0.8; // 피치 0 복원 각속도(완만)

// 자세 한계(짐벌락 회피)
export const PITCH_LIMIT = 2.0;   // ≈ ±115° — 수직 넘어 코브라(기수 뒤로 젖힘) 허용
export const ROLL_LIMIT  = 1.4;   // 시각적 뱅크 한계

// 월드 경계
export const WORLD_HALF   = 2000; // 중심 0 기준 ±2000m (x,z)
export const CEILING      = 1500; // 고도 천장
export const FLOOR        = 0;    // 해수면(음수 고도만 방지)
export const BOUND_MARGIN = 300;  // 경계에서 이 거리 안이면 warning + 강제선회
export const RETURN_RATE  = 0.6;  // 중심 방향으로 yaw를 당기는 최대 각속도

export const SPAWN_Y = 300;       // 기본 스폰 고도

// ── 보조 함수 ────────────────────────────────────────────────────────

// a에서 b로 maxStep 이하로 이동(오버슈트 없음)
export function moveToward(a, b, maxStep) {
  const diff = b - a;
  if (Math.abs(diff) <= maxStep) return b;
  return a + Math.sign(diff) * maxStep;
}

// 각도를 (-π, π] 범위로 정규화
export function wrapAngle(a) {
  const twoPi = 2 * Math.PI;
  let r = a % twoPi;          // (-2π, 2π)
  if (r > Math.PI) r -= twoPi;
  else if (r <= -Math.PI) r += twoPi;
  return r;
}

// 값 클램프
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// ── 방향 헬퍼 (자세 → 단위벡터) ──────────────────────────────────────
//
// 회전 순서 yaw(Y) → pitch(X) → roll(Z)를 로컬 기저 (right,up,forward)에
// 적용한 것과 동등. 여기선 직접 합성식을 펼쳐 계산한다.
//   기본 forward = (0,0,-1), up = (0,1,0), right = (1,0,0)
//   1) pitch(X축) 적용 → 2) yaw(Y축) 적용  (roll은 forward에 무기여)
//   roll(Z축, forward 기준)은 up/right만 회전시킨다.

// X축 회전: y' = y·cos - z·sin, z' = y·sin + z·cos
function rotX(v, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
}

// Y축 회전: x' = x·cos + z·sin, z' = -x·sin + z·cos
function rotY(v, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

// 기수(전방) 방향 — 롤 무관, yaw/pitch만 기여
export function forwardOf(state) {
  const { yaw = 0, pitch = 0 } = state;
  // 기본 forward (0,0,-1)에 pitch → yaw 적용
  return rotY(rotX({ x: 0, y: 0, z: -1 }, pitch), yaw);
}

// 천장(위) 방향 — roll 반영
export function upOf(state) {
  const { yaw = 0, pitch = 0, roll = 0 } = state;
  // 기본 up (0,1,0)에 roll(Z축) → pitch(X) → yaw(Y) 적용
  // roll>0(우뱅크)에서 up이 우측(+X)으로 기울어 우선회(yaw 감소)와 시각이 일치하도록 -roll 적용
  const rolled = rotZ({ x: 0, y: 1, z: 0 }, -roll);
  return rotY(rotX(rolled, pitch), yaw);
}

// 우측 방향 — roll 반영
export function rightOf(state) {
  const { yaw = 0, pitch = 0, roll = 0 } = state;
  // 기본 right (1,0,0)에 roll(Z축) → pitch(X) → yaw(Y) 적용 (up과 동일 부호 규약)
  const rolled = rotZ({ x: 1, y: 0, z: 0 }, -roll);
  return rotY(rotX(rolled, pitch), yaw);
}

// Z축 회전(롤): x' = x·cos - y·sin, y' = x·sin + y·cos
function rotZ(v, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c, z: v.z };
}

// ── 생성 ─────────────────────────────────────────────────────────────

// 기체 초기 상태 생성. 미지정 시 중앙·SPAWN_Y·정지 자세·BASE_SPEED.
export function createPlane(spawn = {}) {
  return {
    x: spawn.x ?? 0,
    y: spawn.y ?? SPAWN_Y,
    z: spawn.z ?? 0,
    yaw: spawn.yaw ?? 0,
    pitch: 0,
    roll: 0,
    speed: spawn.speed ?? BASE_SPEED,
    warning: false,
  };
}

// ── 경계 강제선회 ────────────────────────────────────────────────────
//
// 수평(x,z) 경계 침범 정도(penetration)에 따라 중심(0,0)을 향하도록
// yaw를 당기는 각속도(rad/s)를 반환. 침범이 없으면 0(개입 없음).

function boundaryYawAssist(state) {
  const inner = WORLD_HALF - BOUND_MARGIN;
  const dx = Math.abs(state.x) - inner;
  const dz = Math.abs(state.z) - inner;
  const pen = Math.max(dx, dz);
  if (pen <= 0) return 0;                       // margin 밖(중앙부) → 개입 없음

  // 중심을 바라보는 목표 yaw(수평면). forwardOf 규약(forward.x=-sin yaw,
  // forward.z=-cos yaw)에서 중심 방향 forward=(-x,-z)이므로 yaw=atan2(x,z).
  const centerYaw = Math.atan2(state.x, state.z);

  // 침범이 얕으면 경계를 따라 도는 '접선' 방향, 깊을수록 중심 정면을 향하도록
  // 보간한다. 이렇게 하면 보이지 않는 벽처럼 기체가 경계대(margin)에 갇혀
  // 안쪽으로 빠르게 직진해 빠져나가지 않고 경계를 선회하며 머문다.
  const penN = clamp(pen / BOUND_MARGIN, 0, 1);
  const tangentYaw = wrapAngle(centerYaw + Math.PI / 2); // 벽을 따라 도는 방향
  const toCenter = wrapAngle(centerYaw - tangentYaw);     // 접선→중심 보정량(=+90°)
  const targetYaw = wrapAngle(tangentYaw + toCenter * penN);

  const diff = wrapAngle(targetYaw - state.yaw); // 가까운 회전 방향
  return Math.sign(diff) * RETURN_RATE;
}

// margin 침범 또는 경계 초과 시 경고
function isWarning(x, z) {
  const inner = WORLD_HALF - BOUND_MARGIN;
  return Math.abs(x) > inner || Math.abs(z) > inner;
}

// ── 한 스텝 적분 ─────────────────────────────────────────────────────
//
// 순서: 속도 → 롤 → 피치 → yaw(뱅크턴+경계) → 위치 → warning.

export function stepFlight(state, input, dt) {
  // (a) 속도 — 목표속도로 비율 가감속, brake 우선
  const target = input.brake ? BRAKE_SPEED : input.boost ? BOOST_SPEED : BASE_SPEED;
  const rate = target < state.speed ? DECEL : ACCEL;
  let speed = moveToward(state.speed, target, rate * dt);
  speed = clamp(speed, MIN_SPEED, MAX_SPEED);

  // (b) 롤 — 각도 유지(hold-attitude): 입력 적분, 손 떼면 현재 자세 유지(자동 복원 없음).
  let roll = state.roll + input.roll * ROLL_RATE * dt;
  roll = clamp(roll, -ROLL_LIMIT, ROLL_LIMIT);

  // (c) 피치 — 각도 유지: 입력 적분, 손 떼면 그대로 유지(자동 복원 없음).
  let pitch = state.pitch + input.pitch * PITCH_RATE * dt;
  pitch = clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);

  // (d) yaw — 뱅크턴(우뱅크=우선회=yaw 감소) + 경계 강제선회
  const yawRate = -roll * YAW_FROM_ROLL;
  const assist = boundaryYawAssist(state);
  let yaw = wrapAngle(state.yaw + (yawRate + assist) * dt);

  // (e) 위치 — forward 따라 전진 + 고도 클램프
  const f = forwardOf({ yaw, pitch, roll });
  let x = state.x + f.x * speed * dt;
  let y = state.y + f.y * speed * dt;
  let z = state.z + f.z * speed * dt;
  y = clamp(y, FLOOR, CEILING);

  // (f) 경계 경고
  const warning = isWarning(x, z);

  return { x, y, z, yaw, pitch, roll, speed, warning };
}
