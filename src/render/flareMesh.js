// flareMesh.js (M7) — 플레어 디코이 메시 렌더 (THREE 의존)
//
// 순수 로직 flare.js가 매 프레임 산출하는 flare 배열을 작은 발광 구 메시 풀로 그린다.
//   - InstancedMesh 1개로 모든 flare를 한 번에 렌더(드로콜 1, GC 압력 0).
//   - 밝은 노랑/주황의 발광 디코이 표현(라이트 무관 Basic).
//   - 수명(life)이 줄수록 살짝 작아지게 스케일을 페이드(시각적 소멸 느낌).
//   - 풀 재사용: 활성 flare 수만 보이고 나머지는 count로 잘라낸다.
//
// API:
//   createFlarePool(scene, maxFlares?) → pool  (scene에 InstancedMesh 추가)
//   syncFlares(pool, flares)                   (매 프레임 호출: 위치/색/개수 갱신)
import * as THREE from 'three';
import { FLARE_LIFE } from '../weapons/flare.js';

const DEFAULT_MAX = 32;        // 동시 표시 가능한 최대 flare 수(2P × 3발 + 여유)
const FLARE_RADIUS = 2.5;      // 발광 구 반경(m) — 멀리서도 보이게 약간 크게

// 밝은 발광 색(디코이 불꽃)
const COLOR_HOT  = new THREE.Color(0xffee44);  // 노랑(수명 많이 남음)
const COLOR_COOL = new THREE.Color(0xff7722);  // 주황(수명 거의 없음)
const _c = new THREE.Color();

const _m = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _scl = new THREE.Vector3();

// 플레어 메시 풀 생성 — InstancedMesh 1개를 scene에 추가하고 핸들 반환.
export function createFlarePool(scene, maxFlares = DEFAULT_MAX) {
  const geo = new THREE.SphereGeometry(FLARE_RADIUS, 8, 8);
  // 발광 느낌: 라이트 영향 없는 Basic. fog는 끄지 않아 거리감 유지.
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });

  const mesh = new THREE.InstancedMesh(geo, mat, maxFlares);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;

  const colors = new Float32Array(maxFlares * 3);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);

  scene.add(mesh);
  return { mesh, maxFlares, colors };
}

// 활성 flare 배열을 풀에 동기화 — 위치·수명 페이드 스케일/색 + count 갱신.
export function syncFlares(pool, flares) {
  const { mesh, maxFlares, colors } = pool;
  const n = Math.min(flares.length, maxFlares);

  for (let i = 0; i < n; i++) {
    const fl = flares[i];
    // 수명 비율(0~1): 수명이 줄수록 작아지고 색이 노랑→주황으로.
    const t = Math.max(0, Math.min(1, fl.life / FLARE_LIFE));
    const s = 0.6 + 0.4 * t;          // 0.6~1.0 스케일 페이드

    _pos.set(fl.x, fl.y, fl.z);
    _scl.set(s, s, s);
    _m.compose(_pos, _q, _scl);       // 회전 불필요(구) → identity quaternion
    mesh.setMatrixAt(i, _m);

    _c.copy(COLOR_COOL).lerp(COLOR_HOT, t);
    colors[i * 3] = _c.r;
    colors[i * 3 + 1] = _c.g;
    colors[i * 3 + 2] = _c.b;
  }

  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
}
