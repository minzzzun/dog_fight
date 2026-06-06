// missileMesh.js (M6) — 유도미사일 메시 렌더 (THREE 의존)
//
// 순수 로직 missile.js가 매 프레임 산출하는 미사일 배열을 작은 원뿔 메시 풀로 그린다.
//   - InstancedMesh 1개로 모든 미사일을 한 번에 렌더(드로콜 1, GC 압력 0).
//   - 소유자(owner)별 색상: P1(0) 청록, P2(1) 주황. InstancedBufferAttribute로 per-instance 색.
//   - 미사일은 속도 벡터(vx,vy,vz) 방향을 향하도록 회전(원뿔 기본축 +Y → 진행방향 정렬).
//   - 풀 재사용: 활성 미사일 수만 보이고 나머지는 count로 잘라낸다.
//
// API:
//   createMissilePool(scene, maxMissiles?) → pool  (scene에 InstancedMesh 추가)
//   syncMissiles(pool, missiles)                   (매 프레임 호출: 위치/방향/색/개수 갱신)
import * as THREE from 'three';

const DEFAULT_MAX = 16;        // 동시 표시 가능한 최대 미사일 수(2P × 2발 + 여유)
const MISSILE_RADIUS = 1.5;    // 원뿔 밑면 반경(m)
const MISSILE_LENGTH = 8;      // 원뿔 길이(m) — 멀리서도 보이게 약간 크게

// 소유자별 미사일 색(bulletMesh와 동일 컨벤션)
const COLOR_P1 = new THREE.Color(0x33ffff);  // 청록(P1)
const COLOR_P2 = new THREE.Color(0xff9933);  // 주황(P2)

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3(1, 1, 1);
const _dir = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);  // ConeGeometry 기본 축(+Y)

// 미사일 메시 풀 생성 — InstancedMesh 1개를 scene에 추가하고 핸들 반환.
export function createMissilePool(scene, maxMissiles = DEFAULT_MAX) {
  // 원뿔 기본 축은 +Y. 진행방향으로 회전시켜 정렬한다.
  const geo = new THREE.ConeGeometry(MISSILE_RADIUS, MISSILE_LENGTH, 8);
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });

  const mesh = new THREE.InstancedMesh(geo, mat, maxMissiles);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;

  const colors = new Float32Array(maxMissiles * 3);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);

  scene.add(mesh);
  return { mesh, maxMissiles, colors };
}

// 활성 미사일 배열을 풀에 동기화 — 위치·진행방향 회전 + 색 + count 갱신.
export function syncMissiles(pool, missiles) {
  const { mesh, maxMissiles, colors } = pool;
  const n = Math.min(missiles.length, maxMissiles);

  for (let i = 0; i < n; i++) {
    const m = missiles[i];

    // 진행방향(속도 벡터)으로 원뿔(+Y)을 회전. 속도 0이면 회전 없음.
    _dir.set(m.vx, m.vy, m.vz);
    if (_dir.lengthSq() > 1e-9) {
      _dir.normalize();
      _q.setFromUnitVectors(_UP, _dir);
    } else {
      _q.identity();
    }

    _pos.set(m.x, m.y, m.z);
    _m.compose(_pos, _q, _scl);
    mesh.setMatrixAt(i, _m);

    const c = m.owner === 0 ? COLOR_P1 : COLOR_P2;
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
}
