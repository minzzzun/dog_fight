// flight.js 단위 테스트 (M1, 비행 모델 · 순수 로직)
//
// TDD RED 단계: 구현(src/flight.js)은 아직 없다. 이 테스트만 먼저 작성한다.
//
// 가정 시그니처 (설계 mds/design/m1-flight.md §3·§8 기준):
//   상수: BASE_SPEED, BOOST_SPEED, BRAKE_SPEED, MIN_SPEED, MAX_SPEED,
//         ACCEL, DECEL, PITCH_RATE, ROLL_RATE, YAW_FROM_ROLL,
//         ROLL_LEVEL_RATE, PITCH_LEVEL_RATE, PITCH_LIMIT, ROLL_LIMIT,
//         WORLD_HALF, CEILING, FLOOR, BOUND_MARGIN, RETURN_RATE, SPAWN_Y
//   createPlane(spawn = {}) → { x, y, z, yaw, pitch, roll, speed, warning }
//   stepFlight(state, input, dt) → newState (불변, 새 객체)
//     input = { pitch: -1..1, roll: -1..1, boost: bool, brake: bool }
//   forwardOf(state) → {x,y,z}  // 기수 방향, 롤 무관, 길이 1
//   upOf(state)      → {x,y,z}  // 천장 방향(롤 반영), 길이 1
//   rightOf(state)   → {x,y,z}  // 우측 방향, 길이 1
//   moveToward(a, b, maxStep) → number
//   wrapAngle(a) → number  // (-π, π]
//
// 좌표 규약(설계 §1): 오른손, +Y 위, forward 기본자세 (0,0,-1), up (0,1,0).
// 부동소수 비교는 toBeCloseTo.
import { describe, it, expect } from 'vitest';
import {
  BASE_SPEED, BOOST_SPEED, BRAKE_SPEED, MIN_SPEED, MAX_SPEED,
  ACCEL, DECEL, PITCH_RATE, ROLL_RATE,
  ROLL_LEVEL_RATE, PITCH_LEVEL_RATE, PITCH_LIMIT, ROLL_LIMIT,
  WORLD_HALF, CEILING, FLOOR, BOUND_MARGIN, SPAWN_Y,
  createPlane, stepFlight, forwardOf, upOf, rightOf,
  moveToward, wrapAngle,
} from './flight.js';

// 무입력(중립) 헬퍼
const NEUTRAL = { pitch: 0, roll: 0, boost: false, brake: false };
const input = (o = {}) => ({ ...NEUTRAL, ...o });

// 길이(노름)
const len = (v) => Math.hypot(v.x, v.y, v.z);
// 내적(직교성 검사)
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

describe('createPlane — 초기 상태', () => {
  it('기본값: 중앙·SPAWN_Y·정지자세·BASE_SPEED·warning false', () => {
    const p = createPlane();
    expect(p.x).toBe(0);
    expect(p.y).toBe(SPAWN_Y);
    expect(p.z).toBe(0);
    expect(p.yaw).toBe(0);
    expect(p.pitch).toBe(0);
    expect(p.roll).toBe(0);
    expect(p.speed).toBe(BASE_SPEED);
    expect(p.warning).toBe(false);
  });

  it('spawn 인자를 반영한다', () => {
    const p = createPlane({ x: 10, y: 500, z: -20, yaw: 1, speed: 150 });
    expect(p.x).toBe(10);
    expect(p.y).toBe(500);
    expect(p.z).toBe(-20);
    expect(p.yaw).toBe(1);
    expect(p.speed).toBe(150);
    // pitch/roll은 항상 0으로 시작
    expect(p.pitch).toBe(0);
    expect(p.roll).toBe(0);
  });
});

describe('직진 (무입력·기본 자세)', () => {
  it('forward(-Z)로 전진: z 감소, x·y 거의 불변', () => {
    const p0 = createPlane();
    let p = p0;
    for (let i = 0; i < 10; i++) p = stepFlight(p, input(), 0.05);
    expect(p.z).toBeLessThan(p0.z);          // -Z 전진
    expect(p.x).toBeCloseTo(p0.x, 6);        // 좌우 이동 없음
    expect(p.y).toBeCloseTo(p0.y, 6);        // 고도 유지(피치 0)
  });

  it('한 스텝 이동량 ≈ BASE_SPEED * dt', () => {
    const p0 = createPlane();
    const dt = 0.05;
    const p = stepFlight(p0, input(), dt);
    const dist = Math.hypot(p.x - p0.x, p.y - p0.y, p.z - p0.z);
    expect(dist).toBeCloseTo(BASE_SPEED * dt, 4);
  });

  it('무입력 직진 중 자세(yaw/pitch/roll) 불변', () => {
    let p = createPlane();
    for (let i = 0; i < 10; i++) p = stepFlight(p, input(), 0.05);
    expect(p.yaw).toBeCloseTo(0, 6);
    expect(p.pitch).toBeCloseTo(0, 6);
    expect(p.roll).toBeCloseTo(0, 6);
  });
});

describe('forwardOf / upOf / rightOf — 방향 규약', () => {
  it('기본 자세에서 forward=(0,0,-1)', () => {
    const f = forwardOf({ yaw: 0, pitch: 0, roll: 0 });
    expect(f.x).toBeCloseTo(0, 6);
    expect(f.y).toBeCloseTo(0, 6);
    expect(f.z).toBeCloseTo(-1, 6);
  });

  it('기본 자세에서 up=(0,1,0)', () => {
    const u = upOf({ yaw: 0, pitch: 0, roll: 0 });
    expect(u.x).toBeCloseTo(0, 6);
    expect(u.y).toBeCloseTo(1, 6);
    expect(u.z).toBeCloseTo(0, 6);
  });

  it('forward는 단위벡터(길이 1)', () => {
    const f = forwardOf({ yaw: 0.7, pitch: 0.3, roll: 0.5 });
    expect(len(f)).toBeCloseTo(1, 6);
  });

  it('forward는 롤에 무관(yaw/pitch만 기여)', () => {
    const base = { yaw: 0.4, pitch: 0.2, roll: 0 };
    const rolled = { yaw: 0.4, pitch: 0.2, roll: 1.0 };
    const a = forwardOf(base);
    const b = forwardOf(rolled);
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.y).toBeCloseTo(a.y, 6);
    expect(b.z).toBeCloseTo(a.z, 6);
  });

  it('피치 +면 기수가 위로(forward.y > 0)', () => {
    const f = forwardOf({ yaw: 0, pitch: 0.5, roll: 0 });
    expect(f.y).toBeGreaterThan(0);
  });

  it('up/right도 단위벡터', () => {
    const s = { yaw: 0.6, pitch: 0.3, roll: 0.4 };
    expect(len(upOf(s))).toBeCloseTo(1, 6);
    expect(len(rightOf(s))).toBeCloseTo(1, 6);
  });

  it('forward·up·right 서로 직교', () => {
    const s = { yaw: 0.6, pitch: 0.3, roll: 0.4 };
    const f = forwardOf(s), u = upOf(s), r = rightOf(s);
    expect(dot(f, u)).toBeCloseTo(0, 6);
    expect(dot(f, r)).toBeCloseTo(0, 6);
    expect(dot(u, r)).toBeCloseTo(0, 6);
  });
});

describe('피치 적분', () => {
  it('pitch 입력 +면 pitch각 증가(기수 들림), 이후 상승', () => {
    let p = createPlane();
    for (let i = 0; i < 5; i++) p = stepFlight(p, input({ pitch: 1 }), 0.05);
    expect(p.pitch).toBeGreaterThan(0);
    const yBefore = p.y;
    p = stepFlight(p, input({ pitch: 1 }), 0.05);
    expect(p.y).toBeGreaterThan(yBefore);   // 기수 위 → 상승
  });

  it('pitch 입력 -면 pitch각 감소(기수 숙임), 이후 하강', () => {
    let p = createPlane();
    for (let i = 0; i < 5; i++) p = stepFlight(p, input({ pitch: -1 }), 0.05);
    expect(p.pitch).toBeLessThan(0);
  });
});

describe('롤 적분', () => {
  it('roll 입력 +면 roll각 증가(우뱅크)', () => {
    let p = createPlane();
    for (let i = 0; i < 5; i++) p = stepFlight(p, input({ roll: 1 }), 0.05);
    expect(p.roll).toBeGreaterThan(0);
  });

  it('roll 입력 -면 roll각 감소(좌뱅크)', () => {
    let p = createPlane();
    for (let i = 0; i < 5; i++) p = stepFlight(p, input({ roll: -1 }), 0.05);
    expect(p.roll).toBeLessThan(0);
  });
});

describe('각도 유지 (hold-attitude, 자동 복원 없음)', () => {
  it('roll 만든 뒤 무입력 → roll 유지(복원 안 됨)', () => {
    let p = createPlane();
    for (let i = 0; i < 5; i++) p = stepFlight(p, input({ roll: 1 }), 0.05);
    const held = p.roll;
    expect(held).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) p = stepFlight(p, input(), 0.05);
    expect(p.roll).toBeCloseTo(held, 6);   // 그대로 유지
  });

  it('pitch 만든 뒤 무입력 → pitch 유지', () => {
    let p = createPlane();
    for (let i = 0; i < 5; i++) p = stepFlight(p, input({ pitch: 1 }), 0.05);
    const held = p.pitch;
    expect(held).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) p = stepFlight(p, input(), 0.05);
    expect(p.pitch).toBeCloseTo(held, 6);
  });

  it('롤을 기울인 채 두면 무입력이어도 yaw가 계속 변함(뱅크턴 지속)', () => {
    let p = createPlane();
    for (let i = 0; i < 5; i++) p = stepFlight(p, input({ roll: 1 }), 0.05);
    const yaw0 = p.yaw;
    for (let i = 0; i < 10; i++) p = stepFlight(p, input(), 0.05);  // 손 뗀 채
    expect(p.yaw).not.toBeCloseTo(yaw0, 3);   // 기운 채라 계속 선회
  });
});

describe('뱅크턴 (롤 → yaw 선회)', () => {
  it('우뱅크(roll>0) 유지 → yaw가 우선회 방향으로 단조 변화', () => {
    let p = createPlane();
    // 롤을 양수로 세팅
    for (let i = 0; i < 5; i++) p = stepFlight(p, input({ roll: 1 }), 0.05);
    expect(p.roll).toBeGreaterThan(0);
    // 롤 유지하며 yaw 변화 관찰 — 설계 §5d: 우뱅크는 yaw 감소(우선회)
    const yaw0 = p.yaw;
    for (let i = 0; i < 5; i++) p = stepFlight(p, input({ roll: 1 }), 0.05);
    expect(p.yaw).toBeLessThan(yaw0);
  });

  it('roll=0이면 yaw 불변', () => {
    let p = createPlane();
    const yaw0 = p.yaw;
    for (let i = 0; i < 10; i++) p = stepFlight(p, input(), 0.05);
    expect(p.yaw).toBeCloseTo(yaw0, 6);
  });
});

describe('부스터 / 감속', () => {
  it('boost → 속도가 BASE에서 BOOST로 증가(상한 초과 없음)', () => {
    let p = createPlane();
    expect(p.speed).toBe(BASE_SPEED);
    for (let i = 0; i < 200; i++) p = stepFlight(p, input({ boost: true }), 0.05);
    expect(p.speed).toBeGreaterThan(BASE_SPEED);
    expect(p.speed).toBeCloseTo(BOOST_SPEED, 4);
    expect(p.speed).toBeLessThanOrEqual(MAX_SPEED + 1e-9);
  });

  it('brake → 속도가 BRAKE로 감소(하한 미만 없음)', () => {
    let p = createPlane();
    for (let i = 0; i < 200; i++) p = stepFlight(p, input({ brake: true }), 0.05);
    expect(p.speed).toBeLessThan(BASE_SPEED);
    expect(p.speed).toBeCloseTo(BRAKE_SPEED, 4);
    expect(p.speed).toBeGreaterThanOrEqual(MIN_SPEED - 1e-9);
  });

  it('boost+brake 동시 → brake 우선(목표=BRAKE)', () => {
    let p = createPlane();
    for (let i = 0; i < 200; i++) p = stepFlight(p, input({ boost: true, brake: true }), 0.05);
    expect(p.speed).toBeCloseTo(BRAKE_SPEED, 4);
  });

  it('boost 가속이 한 스텝당 ACCEL*dt를 넘지 않는다', () => {
    const dt = 0.05;
    const p0 = createPlane();
    const p = stepFlight(p0, input({ boost: true }), dt);
    expect(p.speed - p0.speed).toBeLessThanOrEqual(ACCEL * dt + 1e-9);
  });

  it('brake 감속이 한 스텝당 DECEL*dt를 넘지 않는다', () => {
    const dt = 0.05;
    const p0 = createPlane();
    const p = stepFlight(p0, input({ brake: true }), dt);
    expect(p0.speed - p.speed).toBeLessThanOrEqual(DECEL * dt + 1e-9);
  });
});

describe('속도 한계 (MIN/MAX 클램프)', () => {
  it('과속 상태로 시작해도 MAX 이하로 클램프', () => {
    const s = { x: 0, y: SPAWN_Y, z: 0, yaw: 0, pitch: 0, roll: 0, speed: 9999, warning: false };
    const p = stepFlight(s, input({ boost: true }), 0.05);
    expect(p.speed).toBeLessThanOrEqual(MAX_SPEED + 1e-9);
  });

  it('저속 상태로 시작해도 MIN 이상으로 클램프', () => {
    const s = { x: 0, y: SPAWN_Y, z: 0, yaw: 0, pitch: 0, roll: 0, speed: 0, warning: false };
    const p = stepFlight(s, input({ brake: true }), 0.05);
    expect(p.speed).toBeGreaterThanOrEqual(MIN_SPEED - 1e-9);
  });
});

describe('월드 경계 — warning + 강제선회', () => {
  it('중앙(x=0)에서는 warning false', () => {
    const p = stepFlight(createPlane(), input(), 0.05);
    expect(p.warning).toBe(false);
  });

  it('margin 안으로 스폰하면 첫 스텝 후 warning true', () => {
    const s = createPlane({ x: WORLD_HALF - 100, y: SPAWN_Y, z: 0 });
    const p = stepFlight(s, input(), 0.05);
    expect(p.warning).toBe(true);
  });

  it('경계 바깥을 향해도 강제선회로 yaw가 중심 방향으로 보정되어 복귀 경향', () => {
    // x를 양의 경계 근처에 두고 기수를 +X(바깥)로 향하게 한다.
    // forward는 yaw로 수평면에서 결정 — 바깥(+X)을 보도록 yaw 설정.
    // 정확한 yaw 부호는 구현 의존이므로, 여러 스텝 적분 후
    // 중심(x=0) 쪽으로 복귀 경향(|x| 증가가 멈추고 결국 감소)을 검증한다.
    let p = createPlane({ x: WORLD_HALF - 50, y: SPAWN_Y, z: 0 });
    // 바깥을 향하는 yaw를 forwardOf로 찾는다: forward.x>0 인 yaw 탐색
    let bestYaw = 0, bestX = -Infinity;
    for (let k = 0; k < 360; k++) {
      const yaw = (k / 360) * 2 * Math.PI - Math.PI;
      const fx = forwardOf({ yaw, pitch: 0, roll: 0 }).x;
      if (fx > bestX) { bestX = fx; bestYaw = yaw; }
    }
    p = { ...p, yaw: bestYaw };
    let maxX = p.x;
    for (let i = 0; i < 400; i++) {
      p = stepFlight(p, input(), 0.05);
      if (p.x > maxX) maxX = p.x;
    }
    // 강제선회가 중심 쪽으로 당겨 결국 안쪽으로 복귀 → 마지막 x가 최고점보다 낮음
    expect(p.x).toBeLessThan(maxX);
    // 위치가 경계를 크게 못 벗어남(보이지 않는 벽)
    expect(p.x).toBeLessThan(WORLD_HALF + BOUND_MARGIN);
    expect(p.warning).toBe(true);
  });
});

describe('고도 천장/바닥 클램프', () => {
  it('상승 입력을 오래 줘도 y가 CEILING을 넘지 않음', () => {
    let p = createPlane({ y: CEILING - 50 });
    for (let i = 0; i < 500; i++) p = stepFlight(p, input({ pitch: 1 }), 0.05);
    expect(p.y).toBeLessThanOrEqual(CEILING + 1e-6);
  });

  it('하강 입력을 오래 줘도 y가 FLOOR 밑으로 안 감', () => {
    let p = createPlane({ y: FLOOR + 50 });
    for (let i = 0; i < 500; i++) p = stepFlight(p, input({ pitch: -1 }), 0.05);
    expect(p.y).toBeGreaterThanOrEqual(FLOOR - 1e-6);
  });
});

describe('결정론 / 불변성', () => {
  it('같은 (state,input,dt) → 깊은 동등(서로 다른 객체, 값 동일)', () => {
    const s = createPlane({ x: 5, y: 400, z: -3, yaw: 0.2 });
    const a = stepFlight(s, input({ pitch: 0.5, roll: 0.3, boost: true }), 0.05);
    const b = stepFlight(s, input({ pitch: 0.5, roll: 0.3, boost: true }), 0.05);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('stepFlight가 입력 state를 변형하지 않음(새 객체 반환)', () => {
    const s = createPlane({ x: 1, y: 300, z: -2, yaw: 0.1 });
    const snapshot = { ...s };
    const out = stepFlight(s, input({ pitch: 1, roll: 1, boost: true }), 0.05);
    // 원본 불변
    expect(s).toEqual(snapshot);
    // 새 객체
    expect(out).not.toBe(s);
  });
});

describe('moveToward — 보조', () => {
  it('maxStep이 거리 이상이면 정확히 b 도달(오버슈트 없음)', () => {
    expect(moveToward(0, 10, 100)).toBe(10);
    expect(moveToward(10, 0, 100)).toBe(0);
  });

  it('maxStep만큼만 이동(목표 방향)', () => {
    expect(moveToward(0, 10, 3)).toBeCloseTo(3, 6);
    expect(moveToward(10, 0, 3)).toBeCloseTo(7, 6);
  });

  it('이미 목표면 그대로', () => {
    expect(moveToward(5, 5, 2)).toBe(5);
  });
});

describe('wrapAngle — 보조 (-π, π] 정규화', () => {
  it('범위 안 값은 그대로', () => {
    expect(wrapAngle(0)).toBeCloseTo(0, 6);
    expect(wrapAngle(1)).toBeCloseTo(1, 6);
    expect(wrapAngle(-1)).toBeCloseTo(-1, 6);
  });

  it('π 초과는 음수 측으로 래핑', () => {
    expect(wrapAngle(Math.PI + 0.5)).toBeCloseTo(-Math.PI + 0.5, 6);
  });

  it('2π 더해도 동일 각', () => {
    expect(wrapAngle(0.3 + 2 * Math.PI)).toBeCloseTo(0.3, 6);
    expect(wrapAngle(0.3 - 2 * Math.PI)).toBeCloseTo(0.3, 6);
  });

  it('결과가 (-π, π] 범위 안', () => {
    for (let k = -10; k <= 10; k++) {
      const w = wrapAngle(k * 1.3);
      expect(w).toBeGreaterThan(-Math.PI - 1e-9);
      expect(w).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
  });
});
