// flareMesh.js (M7) — 플레어 디코이 메시 렌더 (THREE 의존)
//
// 순수 로직 flare.js가 매 프레임 산출하는 flare 배열을 발광 구 메시 풀로 그린다.
//   - InstancedMesh 1개로 모든 flare 렌더(드로콜 1).
//   - 흰색 단색(라이트 무관 Basic). per-instance 색 대신 머티리얼 단색으로 확실히 흰색.
//   - 수명(life)에 따라 약간 작아지게 스케일 페이드. 크게(멀리서도 잘 보이게).
//
// API:
//   createFlarePool(scene, maxFlares?) → pool
//   syncFlares(pool, flares)
import * as THREE from 'three';
import { FLARE_LIFE } from '../weapons/flare.js';

const DEFAULT_MAX = 32;        // 동시 표시 가능한 최대 flare 수
const FLARE_RADIUS = 6;        // 발광 구 반경(m) — 흰색·크게

const _m = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _scl = new THREE.Vector3();

export function createFlarePool(scene, maxFlares = DEFAULT_MAX) {
  const geo = new THREE.SphereGeometry(FLARE_RADIUS, 10, 10);
  // 흰색 발광 단색(라이트·fog 무관) — 확실히 흰색으로 보이게.
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });

  const mesh = new THREE.InstancedMesh(geo, mat, maxFlares);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;

  scene.add(mesh);
  return { mesh, maxFlares };
}

export function syncFlares(pool, flares) {
  const { mesh, maxFlares } = pool;
  const n = Math.min(flares.length, maxFlares);

  for (let i = 0; i < n; i++) {
    const fl = flares[i];
    const t = Math.max(0, Math.min(1, fl.life / FLARE_LIFE));
    const s = 0.8 + 0.2 * t;          // 0.8~1.0 (크게 유지)
    _pos.set(fl.x, fl.y, fl.z);
    _scl.set(s, s, s);
    _m.compose(_pos, _q, _scl);
    mesh.setMatrixAt(i, _m);
  }

  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
}
