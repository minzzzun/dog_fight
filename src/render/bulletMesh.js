// bulletMesh.js (M5) — 기관총 탄 트레이서 렌더 (THREE 의존)
//
// 순수 로직 gun.js가 매 프레임 산출하는 탄 배열을 작은 발광 구 메시 풀로 그린다.
//   - InstancedMesh 1개로 모든 탄을 한 번에 렌더(드로콜 1, GC 압력 0).
//   - 소유자(owner)별 색상: P1(0) 청록, P2(1) 주황. InstancedBufferAttribute로 per-instance 색.
//   - 풀 재사용: 활성 탄 수만 보이고 나머지는 count로 잘라낸다.
//
// API:
//   createBulletPool(scene, maxBullets?) → pool  (scene에 InstancedMesh 추가)
//   syncBullets(pool, bullets)                   (매 프레임 호출: 위치/색/개수 갱신)
import * as THREE from 'three';

const DEFAULT_MAX = 512;        // 동시 표시 가능한 최대 탄 수
const BULLET_RADIUS = 1.2;      // 탄 트레이서 구 반경(m) — 멀리서도 보이게 약간 크게

// 소유자별 트레이서 색(발광)
const COLOR_P1 = new THREE.Color(0x33ffff);  // 청록(P1)
const COLOR_P2 = new THREE.Color(0xff9933);  // 주황(P2)

const _m = new THREE.Matrix4();

// 탄 트레이서 풀 생성 — InstancedMesh 1개를 scene에 추가하고 핸들 반환.
export function createBulletPool(scene, maxBullets = DEFAULT_MAX) {
  const geo = new THREE.SphereGeometry(BULLET_RADIUS, 6, 6);
  // 발광 느낌: 라이트 영향 없는 Basic. fog는 끄지 않아 거리감은 유지.
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });

  const mesh = new THREE.InstancedMesh(geo, mat, maxBullets);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;  // 인스턴스가 카메라 밖→안으로 빠르게 움직여도 누락 방지
  mesh.count = 0;

  // per-instance 색상 버퍼
  const colors = new Float32Array(maxBullets * 3);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);

  scene.add(mesh);
  return { mesh, maxBullets, colors };
}

// 활성 탄 배열을 풀에 동기화 — 위치 행렬 + 색 + count 갱신.
export function syncBullets(pool, bullets) {
  const { mesh, maxBullets, colors } = pool;
  const n = Math.min(bullets.length, maxBullets);

  for (let i = 0; i < n; i++) {
    const b = bullets[i];
    _m.makeTranslation(b.x, b.y, b.z);
    mesh.setMatrixAt(i, _m);

    const c = b.owner === 0 ? COLOR_P1 : COLOR_P2;
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
}
