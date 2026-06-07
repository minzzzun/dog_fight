// lockReticle.js — 록온 사각 표시 (스크린 공간 DOM)
//
// 각 플레이어가 상대를 락온 중/완료일 때, 상대 기체 위에 사각 조준 박스를 띄운다.
// 상대 월드좌표를 그 플레이어 카메라로 투영해 해당 분할 뷰포트(좌/우) 픽셀 위치에 배치.
//   - 락온 진행 중: 노란 점선 박스
//   - 락온 완료(locked): 빨간 실선 박스
// 화면 뒤/밖이면 숨김.
import * as THREE from 'three';

const _v = new THREE.Vector3();

function makeBox() {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;width:70px;height:70px;transform:translate(-50%,-50%);' +
    'box-sizing:border-box;pointer-events:none;z-index:15;display:none';
  document.body.appendChild(el);
  return el;
}

// camera 로 worldPos 투영 → 해당 절반 뷰포트 픽셀. isLeft=true면 좌측 절반.
function project(camera, target, isLeft, w, h) {
  _v.set(target.x, target.y, target.z).project(camera);
  if (_v.z > 1) return null;                 // 카메라 뒤
  if (_v.x < -1 || _v.x > 1 || _v.y < -1 || _v.y > 1) return null;  // 뷰포트 밖
  const halfW = w / 2;
  const localX = (_v.x * 0.5 + 0.5) * halfW; // 절반 내 x
  const sx = (isLeft ? 0 : halfW) + localX;
  const sy = (1 - (_v.y * 0.5 + 0.5)) * h;
  return { sx, sy };
}

export function createLockReticle() {
  const boxL = makeBox();
  const boxR = makeBox();

  function renderOne(box, camera, target, launcher, isLeft, w, h) {
    // 락온 중도 완료도 아니면 숨김
    if (!launcher || (!launcher.locked && (launcher.lockTimer ?? 0) <= 0)) {
      box.style.display = 'none';
      return;
    }
    const p = project(camera, target, isLeft, w, h);
    if (!p) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    box.style.left = `${p.sx}px`;
    box.style.top = `${p.sy}px`;
    if (launcher.locked) {
      box.style.border = '3px solid #ff3030';      // 락온 완료 — 빨강 실선
      box.style.width = '60px'; box.style.height = '60px';
    } else {
      box.style.border = '2px dashed #ffe24a';      // 진행 중 — 노랑 점선
      box.style.width = '80px'; box.style.height = '80px';
    }
  }

  // p1/p2 = { camera, target(상대 위치), launcher }
  function update(p1, p2, w, h) {
    renderOne(boxL, p1.camera, p1.target, p1.launcher, true, w, h);
    renderOne(boxR, p2.camera, p2.target, p2.launcher, false, w, h);
  }

  return { update };
}
