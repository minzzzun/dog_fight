// terrainMesh.js (M3) — 고정 설계맵 렌더 (THREE 의존)
//
// 순수 terrain.js의 heightAt/heightToColorHex만 호출해 단일 고해상도 지형 메시를
// 만든다(SSoT는 terrain.js 데이터 — 데이터 변경 시 메시 자동 추종).
//   buildTerrain() → 섬·산·다리 능선이 새겨진 PlaneGeometry 메시(vertexColors).
//   buildSea()     → 반투명 해수면 평면(y=0, z-fighting 회피 오프셋).
//
// 설계 근거: mds/design/m3-terrain.md (§4 지형 렌더).
import * as THREE from 'three';
import { heightAt, heightToColorHex } from '../terrain.js';

// 단일 표면 방식: 바다도 지형 메시의 일부(저지대 h<2 = 물색). 별도 해수면 평면이
// 없어 z-fighting 원천 제거. 수평선까지 물이 차도록 월드(±2000)보다 넓게 8000.
export const TERRAIN_SIZE = 8000;   // 한 변(월드 ±2000보다 넓게 — 수평선까지 물)
export const TERRAIN_SEG  = 400;    // 그리드 분할(정점 401² ≈ 16만, ≈20m 간격)

// ── 지형 메시 ────────────────────────────────────────────────────────
//
// 메시 중심=원점 → 메시 로컬좌표(rotateX 후 x,z)가 곧 월드좌표.
// 각 정점 y에 heightAt(wx,wz)를 대입하고 고도색을 vertexColors로 굽는다.
export function buildTerrain() {
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEG, TERRAIN_SEG);
  geo.rotateX(-Math.PI / 2);                  // 수평면으로 눕힘(+Y up)

  const pos = geo.attributes.position.array;
  const colors = new Float32Array(pos.length);
  const _c = new THREE.Color();

  for (let i = 0; i < pos.length; i += 3) {
    const wx = pos[i], wz = pos[i + 2];       // 원점 중심 → 월드좌표=로컬좌표
    const h = heightAt(wx, wz);
    pos[i + 1] = h;
    _c.setHex(heightToColorHex(h));
    colors[i] = _c.r; colors[i + 1] = _c.g; colors[i + 2] = _c.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.attributes.position.needsUpdate = true;
  geo.computeVertexNormals();                 // 산 입체감(음영)

  const mat = new THREE.MeshPhongMaterial({
    vertexColors: true,
    shininess: 6,
    flatShading: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, 0, 0);                  // 원점 중심
  return mesh;
}

// 해수면 별도 평면은 제거(단일 표면 방식). 바다는 buildTerrain 메시의 저지대(h<2)
// 물색으로 표현되어 두 면이 겹치지 않아 z-fighting이 원천적으로 없다.
