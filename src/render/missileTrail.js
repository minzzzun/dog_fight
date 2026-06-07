// missileTrail.js — 유도미사일 로켓 연기 트레일 (THREE 의존)
//
// 미사일이 날아가는 동안 꼬리에서 회백색 연기 퍼프를 남긴다. 각 퍼프는 제자리에서
// 커지며 옅어진다(저체력 smoke처럼 떠오르지 않음 — 로켓 배기 잔류운 느낌).
// emitMissileTrail로 생성, stepMissileTrail로 갱신.
//
// API: createMissileTrailPool(scene, max?) / emitMissileTrail(pool, x,y,z) / stepMissileTrail(pool, dt)
import * as THREE from 'three';

const MAX = 256;
const LIFE = 0.9;          // 퍼프 수명(s)
const START_R = 1.2;       // 시작 반경
const GROW = 6;            // 수명 동안 늘어나는 반경

export function createMissileTrailPool(scene, max = MAX) {
  const items = [];
  for (let i = 0; i < max; i++) {
    const geo = new THREE.SphereGeometry(1, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0, depthWrite: false, fog: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    items.push({ mesh, age: 0, active: false });
  }
  return { items, cursor: 0 };
}

// 한 퍼프 방출(풀 순환).
export function emitMissileTrail(pool, x, y, z) {
  const it = pool.items[pool.cursor];
  pool.cursor = (pool.cursor + 1) % pool.items.length;
  it.active = true;
  it.age = 0;
  it.mesh.position.set(x, y, z);
  it.mesh.scale.setScalar(START_R);
  it.mesh.visible = true;
}

export function stepMissileTrail(pool, dt) {
  for (const it of pool.items) {
    if (!it.active) continue;
    it.age += dt;
    const t = it.age / LIFE;
    if (t >= 1) { it.active = false; it.mesh.visible = false; it.mesh.material.opacity = 0; continue; }
    it.mesh.scale.setScalar(START_R + GROW * t);   // 점점 커짐
    it.mesh.material.opacity = 0.45 * (1 - t);      // 점점 옅어짐
    const g = 0.8 - 0.25 * t;                       // 밝은 회백 → 살짝 어두워짐
    it.mesh.material.color.setRGB(g, g, g);
  }
}
