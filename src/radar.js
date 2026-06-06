// radar.js — 상대 방향 표시기 (순수, THREE 비의존)
//
// 각 플레이어 화면에 상대 비행기가 어느 방향(화면 기준)에 있는지 + 거리를 알려주기
// 위한 계산. 화살표 HUD가 이 angle 만큼 회전한다(0=정면/위, +=오른쪽).
import { forwardOf, rightOf } from './flight.js';

// viewer(비행 상태)에서 본 target({x,y,z})의 화면 상대 방위·거리.
//   angle(rad): viewer 의 수평 forward/right 에 투영해 atan2(right, fwd).
//     0=정면, +π/2=오른쪽, -π/2=왼쪽, ±π=뒤. (rightOf 가 화면 우측과 일치하므로 부호 정합)
//   distance: 3D 직선거리.
export function targetIndicator(viewer, target) {
  const dx = target.x - viewer.x;
  const dy = target.y - viewer.y;
  const dz = target.z - viewer.z;
  const distance = Math.hypot(dx, dy, dz);

  const f = forwardOf(viewer); // 수평성분 f.x,f.z 사용
  const r = rightOf(viewer);
  const fwd = dx * f.x + dz * f.z;   // 정면 성분(수평)
  const rgt = dx * r.x + dz * r.z;   // 우측 성분(수평)
  const angle = Math.atan2(rgt, fwd);

  return { angle, distance };
}
