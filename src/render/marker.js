// marker.js — 기체 위치 마커(컬러 빔) — 상대 찾기 쉽게 (THREE 의존)
//
// 각 기체 위로 솟는 길고 반투명한 색 빔 + 떠 있는 다이아몬드. 멀리서도/지형 너머로도
// 보이게 fog 무관·depthWrite off. 색은 기체 색과 동일해 P1(파랑)/P2(빨강) 구분.
// 공유 씬이라 두 카메라 모두 두 마커를 보고, 색으로 상대를 식별한다.
import * as THREE from 'three';

const BEAM_HEIGHT = 600;   // 빔 길이(m) — 수평선 위로도 보이게 길게
const BEAM_RADIUS = 4;     // 빔 굵기
const DIAMOND = 18;        // 상단 다이아몬드 크기

// 기체 색의 마커 생성 — { group, update(x,y,z) }. scene에 추가.
export function createMarker(scene, colorHex) {
  const group = new THREE.Group();

  // 수직 빔(반투명) — 기체에서 위로
  const beamGeo = new THREE.CylinderGeometry(BEAM_RADIUS, BEAM_RADIUS, BEAM_HEIGHT, 8);
  const beamMat = new THREE.MeshBasicMaterial({
    color: colorHex, transparent: true, opacity: 0.35,
    depthWrite: false, fog: false,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.y = BEAM_HEIGHT / 2 + 30;   // 기체 위로 띄움
  group.add(beam);

  // 상단 다이아몬드(옥타헤드론) — 눈에 띄는 포인트
  const dGeo = new THREE.OctahedronGeometry(DIAMOND);
  const dMat = new THREE.MeshBasicMaterial({ color: colorHex, depthWrite: false, fog: false });
  const diamond = new THREE.Mesh(dGeo, dMat);
  diamond.position.y = BEAM_HEIGHT + 30;
  group.add(diamond);

  group.renderOrder = 999;   // 늦게 그려 잘 보이게
  scene.add(group);

  return {
    group,
    update(x, y, z) {
      group.position.set(x, y, z);
    },
  };
}
