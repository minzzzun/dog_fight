// radar.test.js — 상대 방향 표시기 순수 로직
//
// 가정 시그니처:
//   targetIndicator(viewer, target) -> { angle, distance }
//     viewer: 비행 상태 {x,y,z,yaw,pitch,roll}, target: {x,y,z}
//     angle(rad): 화면 기준 상대 방위. 0=정면(위), +=오른쪽, -=왼쪽, ±π=뒤.
//                 viewer 의 forwardOf/rightOf(수평성분)에 투영해 atan2(right, fwd).
//     distance: viewer↔target 3D 직선거리(m).
import { describe, it, expect } from 'vitest';
import { targetIndicator } from './radar.js';
import { createPlane } from './flight.js';

const near = (a, b, d = 1e-6) => Math.abs(a - b) <= d;

describe('targetIndicator — 거리', () => {
  it('3D 직선거리', () => {
    const v = createPlane({ x: 0, y: 0, z: 0 });
    const r = targetIndicator(v, { x: 30, y: 40, z: 0 });
    expect(r.distance).toBeCloseTo(50, 6);
  });
  it('같은 위치면 거리 0', () => {
    const v = createPlane({ x: 5, y: 5, z: 5 });
    expect(targetIndicator(v, { x: 5, y: 5, z: 5 }).distance).toBeCloseTo(0, 6);
  });
});

describe('targetIndicator — 방위(yaw=0, forward=-Z)', () => {
  const v = createPlane({ x: 0, y: 100, z: 0, yaw: 0 }); // 정면 = -Z

  it('정면(-Z)에 있는 상대 → angle ≈ 0', () => {
    const r = targetIndicator(v, { x: 0, y: 100, z: -500 });
    expect(Math.abs(r.angle)).toBeLessThan(1e-6);
  });
  it('오른쪽(+X)에 있는 상대 → angle ≈ +π/2', () => {
    const r = targetIndicator(v, { x: 500, y: 100, z: 0 });
    expect(r.angle).toBeCloseTo(Math.PI / 2, 5);
  });
  it('왼쪽(-X)에 있는 상대 → angle ≈ -π/2', () => {
    const r = targetIndicator(v, { x: -500, y: 100, z: 0 });
    expect(r.angle).toBeCloseTo(-Math.PI / 2, 5);
  });
  it('뒤(+Z)에 있는 상대 → |angle| ≈ π', () => {
    const r = targetIndicator(v, { x: 0, y: 100, z: 500 });
    expect(Math.abs(r.angle)).toBeCloseTo(Math.PI, 5);
  });
});

describe('targetIndicator — yaw 회전해도 상대 방위 일관', () => {
  it('viewer가 상대를 정면으로 보면 angle≈0 (yaw 임의)', () => {
    // yaw=π → forward=+Z. 상대를 +Z에 두면 정면.
    const v = createPlane({ x: 0, y: 50, z: 0, yaw: Math.PI });
    const r = targetIndicator(v, { x: 0, y: 50, z: 600 });
    expect(Math.abs(r.angle)).toBeLessThan(1e-4);
  });
});

describe('targetIndicator — 순수/불변', () => {
  it('입력 viewer/target 미변형', () => {
    const v = createPlane({ x: 1, y: 2, z: 3, yaw: 0.4 });
    const t = { x: 9, y: 8, z: 7 };
    const vc = { ...v }, tc = { ...t };
    targetIndicator(v, t);
    expect(v).toEqual(vc);
    expect(t).toEqual(tc);
  });
});
