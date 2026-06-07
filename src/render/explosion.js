// explosion.js — 폭발 이펙트 (THREE 의존)
//
// 짧게 커지며 사라지는 발광 구 풀. main이 미사일 명중·기체 사망/추락 위치에서
// spawnExplosion 으로 띄우고, 매 프레임 stepExplosions 로 갱신한다.
//
// API:
//   createExplosionPool(scene, max?) → pool
//   spawnExplosion(pool, x, y, z, big?)   // big=true면 더 크게(기체 폭발)
//   stepExplosions(pool, dt)
import * as THREE from 'three';

const MAX = 24;             // 동시 폭발 수
const LIFE = 0.6;           // 지속(초)
const SMALL_MAX = 28;       // 작은 폭발 최대 반경(미사일/탄)
const BIG_MAX = 70;         // 큰 폭발 최대 반경(기체 격추)

export function createExplosionPool(scene, max = MAX) {
  const items = [];
  for (let i = 0; i < max; i++) {
    const geo = new THREE.SphereGeometry(1, 12, 12);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffcc33, transparent: true, opacity: 0, depthWrite: false, fog: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    items.push({ mesh, age: 0, active: false, maxR: SMALL_MAX });
  }
  return { items };
}

export function spawnExplosion(pool, x, y, z, big = false) {
  const it = pool.items.find((e) => !e.active);
  if (!it) return;             // 풀 가득 — 드롭
  it.active = true;
  it.age = 0;
  it.maxR = big ? BIG_MAX : SMALL_MAX;
  it.mesh.position.set(x, y, z);
  it.mesh.visible = true;
}

export function stepExplosions(pool, dt) {
  for (const it of pool.items) {
    if (!it.active) continue;
    it.age += dt;
    const t = it.age / LIFE;             // 0→1
    if (t >= 1) {
      it.active = false;
      it.mesh.visible = false;
      it.mesh.material.opacity = 0;
      continue;
    }
    const r = it.maxR * (0.2 + 0.8 * t); // 점점 커짐
    it.mesh.scale.setScalar(r);
    it.mesh.material.opacity = 1 - t;    // 점점 투명
    // 노랑→주황으로
    it.mesh.material.color.setRGB(1, 0.8 - 0.5 * t, 0.2 * (1 - t));
  }
}
