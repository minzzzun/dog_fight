// flight.js — 아케이드 비행 모델 (순수 로직, Three.js 비의존)
//
// 자세를 **쿼터니언(바디축 회전)** 으로 적분한다. 오일러(yaw/pitch/roll) 모델의
// 짐벌락·"하늘 볼 때 좌우 반전" 문제를 제거하고, 어떤 자세에서도 조작이 조종사
// 기준으로 일관되며 수직 초과 코브라/공중제비가 가능하다.
//
// 좌표 규약: 오른손, +Y 위(고도), 수면 y=0. 기본자세 forward=(0,0,-1), up=(0,1,0), right=(1,0,0).
// 입력: { pitch:-1..1, roll:-1..1, boost, brake }.  (각도 유지: 손 떼면 자세 유지)
// stepFlight은 state를 변형하지 않고 새 불변 객체를 반환(결정론).
// 외부(forwardOf/upOf/rightOf)는 state.q(쿼터니언) 우선, 없으면 yaw/pitch/roll로 폴백.

// ── 상수 ──────────────────────────────────────────────────────────────
export const BASE_SPEED  = 120;   // 기본 순항
export const BOOST_SPEED = 210;   // 부스터 목표
export const BRAKE_SPEED = 8;     // 감속 목표(엔진오프처럼 거의 정지 → 코브라)
export const MIN_SPEED   = 8;
export const MAX_SPEED   = 210;
export const ACCEL       = 55;    // 가속률(m/s²)
export const DECEL       = 80;    // 감속률(m/s²)

export const PITCH_RATE  = 1.2;   // 피치 입력 최대 시 각속도(rad/s)
export const ROLL_RATE   = 2.4;   // 롤 입력 최대 시 각속도(rad/s)
export const YAW_FROM_ROLL = 1.0; // 뱅크턴 계수: 뱅크 정도 → 선회율

// 근접 조준 보조(aim assist) — 상대가 가까이·정면 콘 안에 있으면 기수를 상대 쪽으로
//   부드럽게 당겨준다. 가속/감속을 무제한으로 쓰는 근접전에서 서로를 놓치지 않게 보조.
//   플레이어 조작 권한(PITCH_RATE 등)보다 약하게 둬 "자동조준"이 아닌 "보조"가 되게 한다.
export const ASSIST_RANGE = 700;  // 이 거리 이내에서만 작동(m)
export const ASSIST_CONE  = Math.PI / 180 * 80; // 기수 기준 이 반각 안에 상대가 있을 때만(rad)
export const ASSIST_RATE  = 1.0;  // 점근접 시 최대 보정 각속도(rad/s) — 거리에 비례해 약해짐

// 장거리 보조 — 오래 교전이 없을 때(서로 멀리 떨어져 못 찾는 상황) 거리·콘 제한을 풀어
//   기수를 상대 쪽으로 천천히 돌려 재교전을 유도한다(범위 무제한·전방향·약한 강도).
export const ASSIST_LONG_RATE = 0.6;  // 장거리 보조 각속도(rad/s) — 일정·완만

// 강화 보조 — AI 연습 모드에서 사람 플레이어에게 주는 강한 조준 도움(더 멀리·더 넓게·더 빠르게).
export const ASSIST_STRONG_RANGE = 1400;          // 작동 거리(m)
export const ASSIST_STRONG_CONE  = Math.PI / 180 * 110; // 작동 반각(rad) — 측후방까지
export const ASSIST_STRONG_RATE  = 1.8;           // 보정 각속도(rad/s) — 강하게 끌어줌

export const WORLD_HALF   = 2000; // 중심 0 기준 ±2000m (x,z)
export const CEILING      = 1500;
export const FLOOR        = 0;
export const BOUND_MARGIN = 300;
export const RETURN_RATE  = 0.6;  // 경계에서 중심으로 당기는 최대 각속도
export const SPAWN_Y = 300;

// ── 보조(스칼라) ───────────────────────────────────────────────────────
export function moveToward(a, b, maxStep) {
  const diff = b - a;
  if (Math.abs(diff) <= maxStep) return b;
  return a + Math.sign(diff) * maxStep;
}

export function wrapAngle(a) {
  const twoPi = 2 * Math.PI;
  let r = a % twoPi;
  if (r > Math.PI) r -= twoPi;
  else if (r <= -Math.PI) r += twoPi;
  return r;
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// ── 쿼터니언 수학 ─────────────────────────────────────────────────────
// q = {x,y,z,w}. 단위 쿼터니언 가정(매 스텝 정규화).
function qMul(a, b) {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

// 단위 축(ax,ay,az) 둘레 ang 회전 쿼터니언(오른손).
function qAxisAngle(ax, ay, az, ang) {
  const h = ang / 2, s = Math.sin(h);
  return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(h) };
}

function qNormalize(q) {
  const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

// 벡터 v를 쿼터니언 q로 회전(v' = q v q⁻¹, 최적화식).
function qRotate(q, v) {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

// 오일러(yaw→pitch→roll) → 쿼터니언 (폴백/스폰용). 규약: up/right는 -roll로 기울임.
function quatFromEuler(yaw = 0, pitch = 0, roll = 0) {
  const qy = qAxisAngle(0, 1, 0, yaw);
  const qp = qAxisAngle(1, 0, 0, pitch);
  const qr = qAxisAngle(0, 0, 1, -roll);
  return qNormalize(qMul(qMul(qy, qp), qr));
}

// 상태에서 쿼터니언 얻기(q 우선, 없으면 오일러 변환).
function quatOf(state) {
  if (state && state.q) return state.q;
  return quatFromEuler(state?.yaw ?? 0, state?.pitch ?? 0, state?.roll ?? 0);
}

// ── 방향 헬퍼 (외부 공개) ─────────────────────────────────────────────
export function forwardOf(state) { return qRotate(quatOf(state), { x: 0, y: 0, z: -1 }); }
export function upOf(state)      { return qRotate(quatOf(state), { x: 0, y: 1, z: 0 }); }
export function rightOf(state)   { return qRotate(quatOf(state), { x: 1, y: 0, z: 0 }); }

// ── 생성 ─────────────────────────────────────────────────────────────
export function createPlane(spawn = {}) {
  return {
    x: spawn.x ?? 0,
    y: spawn.y ?? SPAWN_Y,
    z: spawn.z ?? 0,
    q: spawn.q ?? quatFromEuler(spawn.yaw ?? 0, spawn.pitch ?? 0, spawn.roll ?? 0),
    speed: spawn.speed ?? BASE_SPEED,
    warning: false,
  };
}

// ── 경계 강제선회 (수평 heading 기준) ─────────────────────────────────
// 중심에서 멀어 margin을 침범하면 중심 쪽으로 heading을 당기는 각속도 반환.
function boundaryYawAssist(x, z, yaw) {
  const inner = WORLD_HALF - BOUND_MARGIN;
  const pen = Math.max(Math.abs(x) - inner, Math.abs(z) - inner);
  if (pen <= 0) return 0;
  const centerYaw = Math.atan2(x, z);                 // 중심 방향 forward=(-x,-z)
  const penN = clamp(pen / BOUND_MARGIN, 0, 1);
  const tangentYaw = wrapAngle(centerYaw + Math.PI / 2);
  const toCenter = wrapAngle(centerYaw - tangentYaw);
  const targetYaw = wrapAngle(tangentYaw + toCenter * penN);
  const diff = wrapAngle(targetYaw - yaw);
  return Math.sign(diff) * RETURN_RATE;
}

function isWarning(x, z) {
  const inner = WORLD_HALF - BOUND_MARGIN;
  return Math.abs(x) > inner || Math.abs(z) > inner;
}

// ── 조준 보조 ────────────────────────────────────────────────────────
// 현재 자세 q(월드)와 위치 pos에서, 상대 위치 target 쪽으로 기수를 당기는 보정을 적용한
// 새 쿼터니언을 반환.
//   range: 작동 거리 상한(m). Infinity면 거리 무제한(장거리 보조).
//   cone : 기수 기준 작동 반각(rad). Math.PI면 전방향(뒤쪽 상대도 천천히 돌아봄).
//   rate : 최대 보정 각속도(rad/s). 유한 range에선 거리에 비례해 약해지고, Infinity면 일정.
// 한 스텝에 목표각을 넘기지 않음(과회전 방지). 조건 불충족이면 q를 그대로 반환(순수).
export function aimAssist(q, pos, target, dt, range = ASSIST_RANGE, cone = ASSIST_CONE, rate = ASSIST_RATE) {
  if (!target) return q;
  const dx = target.x - pos.x, dy = target.y - pos.y, dz = target.z - pos.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist <= 1e-3 || dist > range) return q;

  const f = qRotate(q, { x: 0, y: 0, z: -1 });      // 현재 기수 방향
  const dxn = dx / dist, dyn = dy / dist, dzn = dz / dist;
  let cos = f.x * dxn + f.y * dyn + f.z * dzn;
  cos = cos < -1 ? -1 : cos > 1 ? 1 : cos;
  const ang = Math.acos(cos);
  if (ang <= 1e-4 || ang > cone) return q;           // 이미 정조준이거나 콘 밖 → 보조 없음

  // 최소 회전축 = forward × desired (월드 공간)
  let ax = f.y * dzn - f.z * dyn;
  let ay = f.z * dxn - f.x * dzn;
  let az = f.x * dyn - f.y * dxn;
  let al = Math.hypot(ax, ay, az);
  if (al < 1e-6) {                       // 정후방(180°) 등 퇴화 → 임의 수직축(월드 up×forward)
    ax = -f.z; ay = 0; az = f.x;         // up(0,1,0) × forward
    al = Math.hypot(ax, ay, az) || 1;
  }
  ax /= al; ay /= al; az /= al;

  const proximity = Number.isFinite(range) ? 1 - dist / range : 1;  // 유한 range만 거리 비례
  const step = Math.min(ang, rate * proximity * dt);  // 과회전 방지
  return qMul(qAxisAngle(ax, ay, az, step), q);       // 월드축 회전 → pre-multiply
}

// ── 한 스텝 적분 ─────────────────────────────────────────────────────
// assistTarget: 상대 위치 {x,y,z} 또는 null. 주면 조준 보조를 적용한다.
// assistOpts: { range, cone, rate } 보조 파라미터 오버라이드(없으면 근접 기본값). 장거리 보조용.
export function stepFlight(state, input, dt, assistTarget = null, assistOpts = null) {
  // (a) 속도 — 목표속도로 가감속(brake 우선)
  const target = input.brake ? BRAKE_SPEED : input.boost ? BOOST_SPEED : BASE_SPEED;
  const rate = target < state.speed ? DECEL : ACCEL;
  let speed = clamp(moveToward(state.speed, target, rate * dt), MIN_SPEED, MAX_SPEED);

  // (b) 바디축 회전 — 피치(로컬 X), 롤(로컬 Z). 각도 유지(post-multiply).
  let q = quatOf(state);
  const dPitch = input.pitch * PITCH_RATE * dt;
  const dRoll  = input.roll * ROLL_RATE * dt;
  q = qMul(q, qAxisAngle(1, 0, 0, dPitch));   // 기수 위/아래
  q = qMul(q, qAxisAngle(0, 0, 1, -dRoll));   // 뱅크(우입력=우뱅크: 천장 +X, 우날개 내려감)

  // (c) 뱅크턴 — 우뱅크(우측 날개 내려감, right.y<0)면 우선회(yaw 감소).
  //     월드 Y 둘레 회전(pre-multiply)로 heading을 돌린다.
  const r = qRotate(q, { x: 1, y: 0, z: 0 });
  const turn = YAW_FROM_ROLL * r.y * dt;       // r.y<0 → turn<0 → 우선회
  q = qMul(qAxisAngle(0, 1, 0, turn), q);

  // (c-2) 조준 보조 — 상대가 가까이·정면이면(또는 장거리 보조 시 전방향) 기수를 상대 쪽으로 당김
  q = aimAssist(q, state, assistTarget, dt,
    assistOpts?.range ?? ASSIST_RANGE, assistOpts?.cone ?? ASSIST_CONE, assistOpts?.rate ?? ASSIST_RATE);

  // (d) 경계 강제선회 — 현재 heading(수평) 기준
  const fwd0 = qRotate(q, { x: 0, y: 0, z: -1 });
  const yaw = Math.atan2(-fwd0.x, -fwd0.z);    // forward=(-sinθ,*,-cosθ) → θ
  const assist = boundaryYawAssist(state.x, state.z, yaw) * dt;
  if (assist !== 0) q = qMul(qAxisAngle(0, 1, 0, assist), q);

  q = qNormalize(q);

  // (e) 위치 — forward 따라 전진 + 고도 클램프
  const f = qRotate(q, { x: 0, y: 0, z: -1 });
  const x = state.x + f.x * speed * dt;
  const y = clamp(state.y + f.y * speed * dt, FLOOR, CEILING);
  const z = state.z + f.z * speed * dt;

  return { x, y, z, q, speed, warning: isWarning(x, z) };
}
