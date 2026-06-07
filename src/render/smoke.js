// smoke.js — 저체력 기체 연기 트레일 (THREE 의존)
//
// 체력이 낮은 기체 꼬리에서 회색 연기 퍼프를 주기적으로 뿜는다. 각 퍼프는
// 떠오르며 커지고 옅어진다. emitSmoke로 생성, stepSmoke로 갱신.
//
// API: createSmokePool(scene, max?) / emitSmoke(pool, x,y,z) / stepSmoke(pool, dt)
import * as THREE from 'three';

const MAX = 120;
const LIFE = 1.3;          // 퍼프 수명(s)
const RISE = 14;           // 떠오르는 속도(m/s)

export function createSmokePool(scene, max = MAX) {
  const items = [];
  for (let i = 0; i < max; i++) {
    const geo = new THREE.SphereGeometry(1, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0x444444, transparent: true, opacity: 0, depthWrite: false, fog: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    items.push({ mesh, age: 0, active: false });
  }
  return { items, cursor: 0 };
}

// 한 퍼프 방출(풀 순환).
export function emitSmoke(pool, x, y, z) {
  const it = pool.items[pool.cursor];
  pool.cursor = (pool.cursor + 1) % pool.items.length;
  it.active = true;
  it.age = 0;
  it.mesh.position.set(x, y, z);
  it.mesh.visible = true;
}

export function stepSmoke(pool, dt) {
  for (const it of pool.items) {
    if (!it.active) continue;
    it.age += dt;
    const t = it.age / LIFE;
    if (t >= 1) { it.active = false; it.mesh.visible = false; it.mesh.material.opacity = 0; continue; }
    const r = 3 + 16 * t;                 // 점점 커짐
    it.mesh.scale.setScalar(r);
    it.mesh.position.y += RISE * dt;       // 떠오름
    it.mesh.material.opacity = 0.5 * (1 - t);
    const g = 0.27 + 0.25 * t;             // 어두운 회색 → 옅은 회색
    it.mesh.material.color.setRGB(g, g, g);
  }
}
