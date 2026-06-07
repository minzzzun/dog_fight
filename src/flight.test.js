// flight.js 단위 테스트 — 쿼터니언 바디축 비행 모델
//
// 자세는 state.q(쿼터니언)로 보유. 검증은 forwardOf/upOf/rightOf 단위벡터로 한다.
// 규약: 기본자세 forward=(0,0,-1), up=(0,1,0), right=(1,0,0).
//   pitch +(W)=기수 위(forward.y↑), roll +(D)=우뱅크(up.x↑, right.y↓) → 우선회(forward.x↑).
//   각도 유지(hold-attitude): 무입력이면 자세 유지(자동 복원 없음).
import { describe, it, expect } from 'vitest';
import {
  createPlane, stepFlight, forwardOf, upOf, rightOf, moveToward, wrapAngle,
  BASE_SPEED, BOOST_SPEED, BRAKE_SPEED, MIN_SPEED, MAX_SPEED, ACCEL, DECEL,
  SPAWN_Y, WORLD_HALF, CEILING, FLOOR,
} from './flight.js';

const input = (o = {}) => ({ pitch: 0, roll: 0, boost: false, brake: false, ...o });
const len = (v) => Math.hypot(v.x, v.y, v.z);
const close = (a, b, p = 5) => expect(a).toBeCloseTo(b, p);

// ─────────────────────────────────────────────────────────────────────
describe('보조 함수', () => {
  it('moveToward 오버슈트 없음', () => {
    expect(moveToward(0, 10, 3)).toBe(3);
    expect(moveToward(0, 2, 3)).toBe(2);
    expect(moveToward(10, 0, 3)).toBe(7);
  });
  it('wrapAngle (-π,π]', () => {
    close(wrapAngle(0), 0); close(wrapAngle(Math.PI), Math.PI);
    close(wrapAngle(Math.PI * 1.5), -Math.PI / 2);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('createPlane — 기본 상태/자세', () => {
  it('기본값: 중앙·SPAWN_Y·BASE_SPEED·미경고·q 보유', () => {
    const p = createPlane();
    expect(p.x).toBe(0); expect(p.y).toBe(SPAWN_Y); expect(p.z).toBe(0);
    expect(p.speed).toBe(BASE_SPEED);
    expect(p.warning).toBe(false);
    expect(p.q).toBeTruthy();
  });
  it('기본 자세 forward/up/right', () => {
    const p = createPlane();
    const f = forwardOf(p), u = upOf(p), r = rightOf(p);
    close(f.x, 0); close(f.y, 0); close(f.z, -1);
    close(u.x, 0); close(u.y, 1); close(u.z, 0);
    close(r.x, 1); close(r.y, 0); close(r.z, 0);
  });
  it('스폰 yaw=π → 기수 +Z', () => {
    const p = createPlane({ yaw: Math.PI });
    const f = forwardOf(p);
    close(f.x, 0); close(f.z, 1, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('직진 (무입력)', () => {
  it('forward 따라 전진(+자세 불변)', () => {
    let p = createPlane();
    const q0 = { ...p.q };
    p = stepFlight(p, input(), 0.1);
    close(p.z, -BASE_SPEED * 0.1, 3);  // -Z로 전진
    close(p.x, 0); close(p.y, SPAWN_Y);
    const f = forwardOf(p);
    close(f.z, -1); close(f.x, 0); close(f.y, 0);
    expect(Math.abs(p.q.w - q0.w)).toBeLessThan(1e-9);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('속도 — 부스터/감속/한계', () => {
  it('부스터 → BOOST_SPEED 수렴(상한 MAX)', () => {
    let p = createPlane();
    for (let i = 0; i < 200; i++) p = stepFlight(p, input({ boost: true }), 0.05);
    close(p.speed, BOOST_SPEED, 4);
    expect(p.speed).toBeLessThanOrEqual(MAX_SPEED + 1e-9);
  });
  it('감속 → BRAKE_SPEED 수렴(하한 MIN)', () => {
    let p = createPlane();
    for (let i = 0; i < 200; i++) p = stepFlight(p, input({ brake: true }), 0.05);
    close(p.speed, BRAKE_SPEED, 4);
    expect(p.speed).toBeGreaterThanOrEqual(MIN_SPEED - 1e-9);
  });
  it('가/감속 한 스텝 변화량 ≤ ACCEL/DECEL·dt', () => {
    const dt = 0.05;
    let p = createPlane();
    const a = stepFlight(p, input({ boost: true }), dt);
    expect(a.speed - p.speed).toBeLessThanOrEqual(ACCEL * dt + 1e-9);
    const b = stepFlight(p, input({ brake: true }), dt);
    expect(p.speed - b.speed).toBeLessThanOrEqual(DECEL * dt + 1e-9);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('피치 — 기수 위/아래', () => {
  it('pitch +(W) → 기수 위(forward.y > 0)', () => {
    let p = createPlane();
    for (let i = 0; i < 5; i++) p = stepFlight(p, input({ pitch: 1 }), 0.05);
    expect(forwardOf(p).y).toBeGreaterThan(0);
  });
  it('pitch −(S) → 기수 아래(forward.y < 0)', () => {
    let p = createPlane();
    for (let i = 0; i < 5; i++) p = stepFlight(p, input({ pitch: -1 }), 0.05);
    expect(forwardOf(p).y).toBeLessThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('롤 — 뱅크 + 뱅크턴', () => {
  it('roll +(D) → 우뱅크(up.x > 0, right.y < 0)', () => {
    let p = createPlane();
    for (let i = 0; i < 5; i++) p = stepFlight(p, input({ roll: 1 }), 0.05);
    expect(upOf(p).x).toBeGreaterThan(0);
    expect(rightOf(p).y).toBeLessThan(0);
  });
  it('우뱅크 유지 → 우선회(forward.x 증가, +X 쪽)', () => {
    let p = createPlane();
    for (let i = 0; i < 5; i++) p = stepFlight(p, input({ roll: 1 }), 0.05);  // 뱅크 만들기
    const fx0 = forwardOf(p).x;
    for (let i = 0; i < 20; i++) p = stepFlight(p, input(), 0.05);            // 손 떼도 뱅크 유지→선회
    expect(forwardOf(p).x).toBeGreaterThan(fx0);
  });
  it('좌뱅크(roll −, A) → 좌선회(forward.x 감소)', () => {
    let p = createPlane();
    for (let i = 0; i < 5; i++) p = stepFlight(p, input({ roll: -1 }), 0.05);
    expect(upOf(p).x).toBeLessThan(0);
    const fx0 = forwardOf(p).x;
    for (let i = 0; i < 20; i++) p = stepFlight(p, input(), 0.05);
    expect(forwardOf(p).x).toBeLessThan(fx0);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('각도 유지 (hold-attitude)', () => {
  it('피치 만든 뒤 무입력 → forward.y 유지', () => {
    let p = createPlane();
    for (let i = 0; i < 5; i++) p = stepFlight(p, input({ pitch: 1 }), 0.05);
    const fy = forwardOf(p).y;
    for (let i = 0; i < 50; i++) p = stepFlight(p, input(), 0.05);
    close(forwardOf(p).y, fy, 5);   // 복원 없음(유지)
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('자세 무결성 — 짐벌락/반전 없음', () => {
  it('지속 피치업으로 수직 초과(공중제비) — 단위벡터 유지·수직 넘어감', () => {
    let p = createPlane();
    let wentOverTop = false;
    for (let i = 0; i < 60; i++) {
      p = stepFlight(p, input({ pitch: 1 }), 0.05);
      const f = forwardOf(p);
      close(len(f), 1, 6);                 // 항상 단위
      close(len(upOf(p)), 1, 6);
      if (f.z > 0.3) wentOverTop = true;   // 기수가 뒤로(수직 넘어 루프) → 86° 제한 없음
    }
    expect(wentOverTop).toBe(true);
  });
  it('q는 항상 정규화(노름≈1)', () => {
    let p = createPlane();
    for (let i = 0; i < 30; i++) p = stepFlight(p, input({ pitch: 0.7, roll: 0.5 }), 0.05);
    close(Math.hypot(p.q.x, p.q.y, p.q.z, p.q.w), 1, 6);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('월드 경계 — 경고 + 강제선회', () => {
  it('경계 근처면 warning, 바깥 향해도 안쪽으로 선회(달아나지 않음)', () => {
    // +x 경계 근처, 기수 +x(바깥). yaw=-π/2 → forward≈(1,0,0)
    let p = createPlane({ x: WORLD_HALF - 100, z: 0, yaw: -Math.PI / 2 });
    expect(forwardOf(p).x).toBeGreaterThan(0.5);
    let warned = false, maxX = p.x;
    for (let i = 0; i < 200; i++) {
      p = stepFlight(p, input(), 0.05);
      if (p.warning) warned = true;
      maxX = Math.max(maxX, p.x);
    }
    expect(warned).toBe(true);
    expect(maxX).toBeLessThan(WORLD_HALF + 200);   // 벽처럼 막혀 무한히 못 나감
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('고도 클램프', () => {
  it('바닥 아래로 안 내려감(y ≥ FLOOR)', () => {
    let p = createPlane({ y: 30 });
    for (let i = 0; i < 50; i++) p = stepFlight(p, input({ pitch: -1 }), 0.05);
    expect(p.y).toBeGreaterThanOrEqual(FLOOR);
  });
  it('천장 위로 안 올라감(y ≤ CEILING)', () => {
    let p = createPlane({ y: CEILING - 30 });
    for (let i = 0; i < 50; i++) p = stepFlight(p, input({ pitch: 1 }), 0.05);
    expect(p.y).toBeLessThanOrEqual(CEILING);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('불변성/결정론', () => {
  it('입력 state를 변형하지 않음', () => {
    const p = createPlane();
    const x0 = p.x, qw0 = p.q.w;
    stepFlight(p, input({ pitch: 1, roll: 1 }), 0.05);
    expect(p.x).toBe(x0); expect(p.q.w).toBe(qw0);
  });
  it('같은 입력 → 같은 출력', () => {
    const p = createPlane({ x: 10, z: -20, yaw: 0.3 });
    const a = stepFlight(p, input({ pitch: 0.5, roll: -0.3, boost: true }), 0.05);
    const b = stepFlight(p, input({ pitch: 0.5, roll: -0.3, boost: true }), 0.05);
    expect(a).toEqual(b);
  });
});
