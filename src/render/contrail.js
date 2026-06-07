// contrail.js — 고속/부스터 비행운(흰색 가는 트레일) (THREE 의존)
//
// 부스터 시 양 날개끝에서 짧은 흰 퍼프를 남긴다. 연기보다 작고 빨리 옅어짐.
// API: createContrailPool(scene, max?) / emitContrail(pool, x,y,z) / stepContrail(pool, dt)
import * as THREE from 'three';

const MAX = 160;
const LIFE = 0.8;

export function createContrailPool(scene, max = MAX) {
  const items = [];
  for (let i = 0; i < max; i++) {
    const geo = new THREE.SphereGeometry(1, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    items.push({ mesh, age: 0, active: false });
  }
  return { items, cursor: 0 };
}

export function emitContrail(pool, x, y, z) {
  const it = pool.items[pool.cursor];
  pool.cursor = (pool.cursor + 1) % pool.items.length;
  it.active = true; it.age = 0;
  it.mesh.position.set(x, y, z);
  it.mesh.visible = true;
}

export function stepContrail(pool, dt) {
  for (const it of pool.items) {
    if (!it.active) continue;
    it.age += dt;
    const t = it.age / LIFE;
    if (t >= 1) { it.active = false; it.mesh.visible = false; it.mesh.material.opacity = 0; continue; }
    it.mesh.scale.setScalar(1.5 + 4 * t);     // 살짝 퍼짐
    it.mesh.material.opacity = 0.4 * (1 - t);
  }
}
