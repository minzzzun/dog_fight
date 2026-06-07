// planeMesh.js (M4) — 기체 메시 생성 + 비행 상태 자세 적용 (THREE 의존)
//
// buildPlane(color): M0 플레이스홀더 기체(콘 동체 + 박스 주익). 기수 -Z(전방) 규약.
// applyPlaneTransform(mesh, plane): 비행 상태(yaw/pitch/roll)를 메시 위치·회전에 반영.
//   forward/up 기반 lookAt 정렬로 한 번에 적용(오일러 적용 순서 불일치 위험 제거).
import * as THREE from 'three';
import { forwardOf, upOf } from '../flight.js';

// 매 프레임 재사용하는 모듈 스코프 임시(할당 0, GC 압력 없음)
const _pos    = new THREE.Vector3();
const _target = new THREE.Vector3();
const _up     = new THREE.Vector3();
const _m      = new THREE.Matrix4();

// 플레이스홀더 기체: 동체(콘, 기수 -Z) + 주익(박스). M3에서 실제 모델로 교체.
export function buildPlane(color) {
  const group = new THREE.Group();

  // 동체: 콘을 눕혀 기수가 -Z(전방)를 향하게 한다.
  const bodyGeo = new THREE.ConeGeometry(1.2, 6, 16);
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.rotation.x = -Math.PI / 2;  // 콘 축(+Y)을 -Z(전방)로 회전
  group.add(body);

  // 주익: 가로로 긴 얇은 박스.
  const wingGeo = new THREE.BoxGeometry(8, 0.3, 1.6);
  const wingMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2 });
  const wing = new THREE.Mesh(wingGeo, wingMat);
  wing.position.z = 0.5;
  group.add(wing);

  // 애프터버너 불꽃: 꼬리(+Z 뒤)에 붙는 발광 콘. 부스터 시에만 표시(setAfterburner).
  const abGeo = new THREE.ConeGeometry(0.8, 4, 12);
  const abMat = new THREE.MeshBasicMaterial({ color: 0xff8a1e, transparent: true, opacity: 0.9, fog: false });
  const ab = new THREE.Mesh(abGeo, abMat);
  ab.name = 'afterburner';
  ab.rotation.x = Math.PI / 2;   // 콘 꼭지가 +Z(뒤)로 향하게(불꽃이 뒤로 뻗음)
  ab.position.z = 3.2;           // 동체 꼬리 뒤
  ab.visible = false;
  group.add(ab);

  return group;
}

// 부스터 불꽃 on/off + 살짝 깜빡임(시간 위상으로 길이 변동).
export function setAfterburner(mesh, on, phase = 0) {
  const ab = mesh.getObjectByName('afterburner');
  if (!ab) return;
  ab.visible = !!on;
  if (on) {
    const s = 1 + 0.3 * Math.sin(phase * 30);  // 길이 깜빡
    ab.scale.set(1, s, 1);
  }
}

// 비행 상태를 메시 위치·회전에 반영.
//   기수가 -Z 규약 → Matrix4.lookAt(eye, target, up)이 -Z를 target 방향으로 정렬하므로
//   target = pos + forward 로 두면 기수가 정확히 forward를 향한다.
export function applyPlaneTransform(mesh, plane) {
  const f = forwardOf(plane);   // 기수 방향
  const u = upOf(plane);        // 천장(롤 반영)

  _pos.set(plane.x, plane.y, plane.z);
  _target.set(plane.x + f.x, plane.y + f.y, plane.z + f.z); // pos + forward
  _up.set(u.x, u.y, u.z);

  mesh.position.copy(_pos);
  _m.lookAt(_pos, _target, _up);              // eye, target, up → 회전행렬
  mesh.quaternion.setFromRotationMatrix(_m);
}
