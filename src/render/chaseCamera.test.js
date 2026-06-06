// chaseCamera.js 단위 테스트 (M4, 추격 카메라 포즈 · 순수 로직)
//
// TDD RED 단계: 구현(src/render/chaseCamera.js)은 아직 없다. 이 테스트만 먼저 작성한다.
//
// 가정 시그니처 (설계 mds/design/m4-render.md §3 기준):
//   상수: CHASE_DIST = 22, CHASE_HEIGHT = 8, LOOK_AHEAD = 30  (named export)
//   chaseCameraPose(plane) → {
//     position: {x, y, z},   // p − f·CHASE_DIST + u·CHASE_HEIGHT  (기체 뒤·위)
//     lookAt:   {x, y, z},   // p + f·LOOK_AHEAD                    (기체 약간 앞)
//     up:       {x, y, z},   // u (= upOf, 롤 반영)
//   }
//     f = forwardOf(plane) (롤 무관, 길이 1), u = upOf(plane) (롤 반영, 길이 1)
//     THREE 비의존 — 평범한 {x,y,z} 숫자만 입출력.
//
// 좌표 규약(설계 §1): 오른손, +Y 위. 기본 자세 forward=(0,0,-1), up=(0,1,0).
//   기체 뒤 = −forward = +Z. 기본 자세 카메라는 z=+CHASE_DIST, y=plane.y+CHASE_HEIGHT.
// 부동소수 비교는 toBeCloseTo (허용오차 설계 §7: 1e-6, 기본 precision으로 충분).
import { describe, it, expect } from 'vitest';
import { chaseCameraPose, CHASE_DIST, CHASE_HEIGHT, LOOK_AHEAD } from './chaseCamera.js';
import { createPlane, forwardOf, upOf, SPAWN_Y } from '../flight.js';

// 길이(노름)
const len = (v) => Math.hypot(v.x, v.y, v.z);
// 거리
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('chaseCameraPose — 상수', () => {
  it('CHASE_DIST=22, CHASE_HEIGHT=8, LOOK_AHEAD=30', () => {
    expect(CHASE_DIST).toBe(22);
    expect(CHASE_HEIGHT).toBe(8);
    expect(LOOK_AHEAD).toBe(30);
  });
});

describe('chaseCameraPose — 1. 기본 자세 위치', () => {
  // createPlane(): pos 원점(x=0,z=0, y=SPAWN_Y), yaw=pitch=roll=0
  // forward=(0,0,-1), up=(0,1,0)
  //   position = p − f·22 + u·8 = (0,SPAWN_Y,0) − (0,0,-22) + (0,8,0)
  //            = (0, SPAWN_Y + 8, +22)
  const plane = createPlane({ x: 0, y: 0, z: 0 }); // y=0으로 명시(SPAWN_Y 영향 제거)
  const pose = chaseCameraPose(plane);

  it('position = (0, CHASE_HEIGHT, +CHASE_DIST)', () => {
    expect(pose.position.x).toBeCloseTo(0);
    expect(pose.position.y).toBeCloseTo(CHASE_HEIGHT);    // 0 + 8
    expect(pose.position.z).toBeCloseTo(CHASE_DIST);      // 0 − (-22) = +22
  });

  it('position이 기체 뒤(z>0)·위(y>plane.y)', () => {
    expect(pose.position.z).toBeGreaterThan(0);
    expect(pose.position.y).toBeGreaterThan(plane.y);
  });

  it('lookAt = (0, 0, −LOOK_AHEAD)', () => {
    expect(pose.lookAt.x).toBeCloseTo(0);
    expect(pose.lookAt.y).toBeCloseTo(0);
    expect(pose.lookAt.z).toBeCloseTo(-LOOK_AHEAD);       // 0 + (-1)*30
  });

  it('up = (0,1,0)', () => {
    expect(pose.up.x).toBeCloseTo(0);
    expect(pose.up.y).toBeCloseTo(1);
    expect(pose.up.z).toBeCloseTo(0);
  });

  it('기본 SPAWN_Y 스폰이면 position.y = SPAWN_Y + CHASE_HEIGHT', () => {
    const p = createPlane(); // y = SPAWN_Y
    const ps = chaseCameraPose(p);
    expect(ps.position.y).toBeCloseTo(SPAWN_Y + CHASE_HEIGHT);
  });
});

describe('chaseCameraPose — 2. 위치 평행이동(+X)', () => {
  it('기체를 +X로 옮기면 position/lookAt가 같은 양만큼 평행이동', () => {
    const base = createPlane({ x: 0, y: 0, z: 0 });
    const moved = createPlane({ x: 50, y: 0, z: 0 });
    const pb = chaseCameraPose(base);
    const pm = chaseCameraPose(moved);

    expect(pm.position.x).toBeCloseTo(pb.position.x + 50);
    expect(pm.position.y).toBeCloseTo(pb.position.y);
    expect(pm.position.z).toBeCloseTo(pb.position.z);

    expect(pm.lookAt.x).toBeCloseTo(pb.lookAt.x + 50);
    expect(pm.lookAt.y).toBeCloseTo(pb.lookAt.y);
    expect(pm.lookAt.z).toBeCloseTo(pb.lookAt.z);

    // up은 자세 무관이므로 그대로
    expect(pm.up.x).toBeCloseTo(pb.up.x);
    expect(pm.up.y).toBeCloseTo(pb.up.y);
    expect(pm.up.z).toBeCloseTo(pb.up.z);
  });
});

describe('chaseCameraPose — 3. yaw 회전 추종', () => {
  // yaw=+π/2: forwardOf로 기대값 직접 계산해 성분 비교
  const plane = { x: 10, y: 20, z: -30, yaw: Math.PI / 2, pitch: 0, roll: 0 };
  const f = forwardOf(plane);
  const u = upOf(plane);
  const pose = chaseCameraPose(plane);

  it('position = p − f·DIST + u·HEIGHT (회전된 forward 뒤)', () => {
    expect(pose.position.x).toBeCloseTo(plane.x - f.x * CHASE_DIST + u.x * CHASE_HEIGHT);
    expect(pose.position.y).toBeCloseTo(plane.y - f.y * CHASE_DIST + u.y * CHASE_HEIGHT);
    expect(pose.position.z).toBeCloseTo(plane.z - f.z * CHASE_DIST + u.z * CHASE_HEIGHT);
  });

  it('lookAt = p + f·LOOK_AHEAD (회전된 전방)', () => {
    expect(pose.lookAt.x).toBeCloseTo(plane.x + f.x * LOOK_AHEAD);
    expect(pose.lookAt.y).toBeCloseTo(plane.y + f.y * LOOK_AHEAD);
    expect(pose.lookAt.z).toBeCloseTo(plane.z + f.z * LOOK_AHEAD);
  });
});

describe('chaseCameraPose — 4. pitch 변화', () => {
  // pitch>0(기수 위) → forward.y>0 → lookAt.y > plane.y
  const plane = { x: 0, y: 100, z: 0, yaw: 0, pitch: 0.5, roll: 0 };
  const f = forwardOf(plane);
  const u = upOf(plane);
  const pose = chaseCameraPose(plane);

  it('forward.y>0이면 lookAt.y > plane.y (앞이 위를 향함)', () => {
    expect(f.y).toBeGreaterThan(0);
    expect(pose.lookAt.y).toBeGreaterThan(plane.y);
  });

  it('position이 −f·DIST + u·HEIGHT 성분과 일치', () => {
    expect(pose.position.x).toBeCloseTo(plane.x - f.x * CHASE_DIST + u.x * CHASE_HEIGHT);
    expect(pose.position.y).toBeCloseTo(plane.y - f.y * CHASE_DIST + u.y * CHASE_HEIGHT);
    expect(pose.position.z).toBeCloseTo(plane.z - f.z * CHASE_DIST + u.z * CHASE_HEIGHT);
  });
});

describe('chaseCameraPose — 5. roll 변화 (up 기울기)', () => {
  it('roll≠0이면 up.x≠0이고 upOf와 정합', () => {
    const plane = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0.6 };
    const u = upOf(plane);
    const pose = chaseCameraPose(plane);

    expect(Math.abs(pose.up.x)).toBeGreaterThan(1e-6); // 카메라 up이 롤만큼 기욺
    expect(pose.up.x).toBeCloseTo(u.x);
    expect(pose.up.y).toBeCloseTo(u.y);
    expect(pose.up.z).toBeCloseTo(u.z);
  });

  it('roll 부호 반대면 up.x 부호도 반대', () => {
    const poseP = chaseCameraPose({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0.6 });
    const poseN = chaseCameraPose({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: -0.6 });
    expect(Math.sign(poseP.up.x)).toBe(-Math.sign(poseN.up.x));
  });
});

describe('chaseCameraPose — 6. position이 기체 뒤·위 (일반 검증)', () => {
  it('임의 자세에서 (position − p) = −f·DIST + u·HEIGHT', () => {
    const plane = { x: 5, y: 60, z: 7, yaw: 0.7, pitch: -0.3, roll: 0.4 };
    const f = forwardOf(plane);
    const u = upOf(plane);
    const pose = chaseCameraPose(plane);
    const d = { x: pose.position.x - plane.x, y: pose.position.y - plane.y, z: pose.position.z - plane.z };
    expect(d.x).toBeCloseTo(-f.x * CHASE_DIST + u.x * CHASE_HEIGHT);
    expect(d.y).toBeCloseTo(-f.y * CHASE_DIST + u.y * CHASE_HEIGHT);
    expect(d.z).toBeCloseTo(-f.z * CHASE_DIST + u.z * CHASE_HEIGHT);
  });
});

describe('chaseCameraPose — 7. 카메라~기체 거리 일관성', () => {
  const expected = Math.sqrt(CHASE_DIST * CHASE_DIST + CHASE_HEIGHT * CHASE_HEIGHT);
  const poses = [
    { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 },
    { x: 10, y: 50, z: -20, yaw: Math.PI / 3, pitch: 0.4, roll: 0 },
    { x: -5, y: 80, z: 15, yaw: -1.2, pitch: -0.6, roll: 0.5 },
  ];
  it('forward⊥up 가정으로 거리 = sqrt(DIST²+HEIGHT²) (자세 무관)', () => {
    for (const plane of poses) {
      const pose = chaseCameraPose(plane);
      expect(dist(pose.position, plane)).toBeCloseTo(expected);
    }
  });
});

describe('chaseCameraPose — 8. 결정론 / 입력 미변형', () => {
  it('같은 plane 2회 호출 → 깊은 동등', () => {
    const plane = { x: 3, y: 40, z: 9, yaw: 0.5, pitch: 0.2, roll: -0.3 };
    expect(chaseCameraPose(plane)).toEqual(chaseCameraPose(plane));
  });

  it('입력 plane을 변형하지 않는다', () => {
    const plane = { x: 3, y: 40, z: 9, yaw: 0.5, pitch: 0.2, roll: -0.3 };
    const snapshot = { ...plane };
    chaseCameraPose(plane);
    expect(plane).toEqual(snapshot);
  });

  it('여러 자세 스윕: 모든 성분 유한, up 길이 ≈ 1', () => {
    for (const yaw of [-1, 0, 1]) {
      for (const pitch of [-0.5, 0, 0.5]) {
        for (const roll of [-0.5, 0, 0.5]) {
          const pose = chaseCameraPose({ x: 0, y: 100, z: 0, yaw, pitch, roll });
          for (const v of [pose.position, pose.lookAt, pose.up]) {
            expect(Number.isFinite(v.x)).toBe(true);
            expect(Number.isFinite(v.y)).toBe(true);
            expect(Number.isFinite(v.z)).toBe(true);
          }
          expect(len(pose.up)).toBeCloseTo(1);
        }
      }
    }
  });
});

describe('chaseCameraPose — 9. 반환 형태', () => {
  it('{position, lookAt, up} 각각 {x,y,z} 숫자', () => {
    const pose = chaseCameraPose(createPlane());
    for (const key of ['position', 'lookAt', 'up']) {
      expect(pose).toHaveProperty(key);
      const v = pose[key];
      expect(typeof v.x).toBe('number');
      expect(typeof v.y).toBe('number');
      expect(typeof v.z).toBe('number');
    }
  });
});
