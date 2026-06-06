// chaseCamera.js (M4) — 추격 카메라 포즈 계산 (순수 로직, THREE 비의존)
//
// 비행 상태 + 방향 헬퍼(forwardOf/upOf)만으로 카메라 포즈(position/lookAt/up)를
// 평범한 {x,y,z} 숫자로 계산한다. main이 이 결과를 camera.position.set / up.set /
// lookAt 에 적용한다.
//
// 좌표 규약(설계 §1): 오른손, +Y 위. 기본 자세 forward=(0,0,-1), up=(0,1,0).
//   기체 뒤 = −forward. 기본 자세면 카메라가 z=+CHASE_DIST(기체 뒤)·y=+CHASE_HEIGHT(위).
import { forwardOf, upOf } from '../flight.js';

// ── 상수 (설계 §3.2 — 출발점, 튜닝 가능) ────────────────────────────
export const CHASE_DIST   = 22;   // 기체 뒤로 띄우는 거리(m). 뒤 = -forward 방향
export const CHASE_HEIGHT = 8;    // 기체 위로 올리는 높이(m). up 방향
export const LOOK_AHEAD   = 30;   // 시선 목표를 전방으로 당기는 거리(m). forward 방향

// 비행 상태 → 카메라 포즈. THREE 비의존, 입력 미변형.
//   position = p − f·CHASE_DIST + u·CHASE_HEIGHT   (기체 뒤·위)
//   lookAt   = p + f·LOOK_AHEAD                     (기체 약간 앞)
//   up       = u                                    (롤 반영)
export function chaseCameraPose(plane) {
  const f = forwardOf(plane);   // 기수 방향 (롤 무관, 길이 1)
  const u = upOf(plane);        // 천장 방향 (롤 반영, 길이 1)
  const px = plane.x, py = plane.y, pz = plane.z;

  return {
    position: {
      x: px - f.x * CHASE_DIST + u.x * CHASE_HEIGHT,
      y: py - f.y * CHASE_DIST + u.y * CHASE_HEIGHT,
      z: pz - f.z * CHASE_DIST + u.z * CHASE_HEIGHT,
    },
    lookAt: {
      x: px + f.x * LOOK_AHEAD,
      y: py + f.y * LOOK_AHEAD,
      z: pz + f.z * LOOK_AHEAD,
    },
    up: { x: u.x, y: u.y, z: u.z },
  };
}
