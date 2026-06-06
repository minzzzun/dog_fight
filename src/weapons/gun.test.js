// gun.js 단위 테스트 (M5, 기관총 · 순수 로직)
//
// TDD RED 단계: 구현(src/weapons/gun.js)은 아직 없다. 이 테스트만 먼저 작성한다.
//
// 가정 시그니처 (설계 mds/design/m5-gun.md §3·§4·§5·§7 기준):
//   상수: MAG_SIZE(100), RELOAD_TIME(3), FIRE_RATE(12), FIRE_INTERVAL(=1/12≈0.0833),
//         GUN_DAMAGE(1), BULLET_SPEED(600), BULLET_LIFE(2.0),
//         BULLET_RANGE(=BULLET_SPEED*BULLET_LIFE), HIT_RADIUS(12), MUZZLE_OFFSET(8)
//   createGun() → { ammo, reloading, reloadTimer, fireCooldown }
//   stepGun(gun, ctx, dt) → { gun(불변·새 객체), bullets([] 또는 새 탄들) }
//     ctx = { firing: bool, shooter: { x,y,z, yaw,pitch,roll, owner } }
//   stepBullets(bullets, dt, targets, terrain?) → { bullets(생존 탄), hits([{target,owner,damage,position}]) }
//     targets = [{ owner, x, y, z, alive? }]
//     terrain = (x,y,z)=>bool 또는 { collision:(x,y,z)=>bool } (선택). 없으면 지형 무시.
//   탄(bullet) 구조: { x,y,z, vx,vy,vz, life, owner }
//
// 좌표 규약(M1 정합): 오른손, +Y 위, 기본자세 forward=(0,0,-1). 롤은 기수 방향 무관.
// 부동소수 비교는 toBeCloseTo.
import { describe, it, expect } from 'vitest';
import {
  MAG_SIZE, RELOAD_TIME, FIRE_RATE, FIRE_INTERVAL, GUN_DAMAGE,
  BULLET_SPEED, BULLET_LIFE, BULLET_RANGE, HIT_RADIUS, MUZZLE_OFFSET,
  createGun, stepGun, stepBullets,
} from './gun.js';
import { forwardOf } from '../flight.js';

// 발사 위치/방향 산출용 기본 슈터(자세 0, owner 0)
const shooter = (o = {}) => ({ x: 0, y: 300, z: 0, yaw: 0, pitch: 0, roll: 0, owner: 0, ...o });
const ctx = (o = {}) => ({ firing: false, shooter: shooter(), ...o });

// 길이(노름)
const len = (v) => Math.hypot(v.x, v.y, v.z);

// ─────────────────────────────────────────────────────────────────────
describe('상수 — seed 수치', () => {
  it('탄창/재장전/연사/데미지 상수', () => {
    expect(MAG_SIZE).toBe(100);
    expect(RELOAD_TIME).toBe(3);
    expect(FIRE_RATE).toBe(12);
    expect(FIRE_INTERVAL).toBeCloseTo(1 / 12, 4);
    expect(GUN_DAMAGE).toBe(1);
  });

  it('탄 비행/명중/머즐 상수', () => {
    expect(BULLET_SPEED).toBe(600);
    expect(BULLET_LIFE).toBeCloseTo(2.0, 5);
    expect(BULLET_RANGE).toBeCloseTo(BULLET_SPEED * BULLET_LIFE, 3);
    expect(HIT_RADIUS).toBe(12);
    expect(MUZZLE_OFFSET).toBe(8);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('createGun — 초기 상태', () => {
  it('가득 찬 탄창·비재장전·쿨다운 0', () => {
    const g = createGun();
    expect(g.ammo).toBe(MAG_SIZE);
    expect(g.reloading).toBe(false);
    expect(g.reloadTimer).toBe(0);
    expect(g.fireCooldown).toBe(0);
  });

  it('호출마다 독립된 새 객체를 반환한다', () => {
    const a = createGun();
    const b = createGun();
    expect(a).not.toBe(b);
    a.ammo = 1;
    expect(b.ammo).toBe(MAG_SIZE);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('stepGun — 발사·연사 간격', () => {
  it('firing=true 첫 호출: 1발 발사, ammo--, 쿨다운≈FIRE_INTERVAL', () => {
    const g = createGun();
    const r = stepGun(g, ctx({ firing: true }), 0.016);
    expect(r.bullets.length).toBe(1);
    expect(r.gun.ammo).toBe(MAG_SIZE - 1);
    expect(r.gun.fireCooldown).toBeCloseTo(FIRE_INTERVAL, 5);
    expect(r.gun.reloading).toBe(false);
  });

  it('쿨다운 중(작은 dt)엔 미발사·ammo 불변', () => {
    let g = createGun();
    let r = stepGun(g, ctx({ firing: true }), 0.016); // 1발
    g = r.gun;
    const ammoAfterFirst = g.ammo;
    // FIRE_INTERVAL(≈0.083)보다 작은 dt로 다시 호출 → 쿨다운 미소진
    r = stepGun(g, ctx({ firing: true }), 0.016);
    expect(r.bullets.length).toBe(0);
    expect(r.gun.ammo).toBe(ammoAfterFirst);
    // 쿨다운은 dt만큼 줄었으나 아직 >0
    expect(r.gun.fireCooldown).toBeGreaterThan(0);
    expect(r.gun.fireCooldown).toBeCloseTo(FIRE_INTERVAL - 0.016, 5);
  });

  it('쿨다운 소진 후(>FIRE_INTERVAL dt) 다음 1발 발사', () => {
    let g = createGun();
    let r = stepGun(g, ctx({ firing: true }), 0.016); // 1발
    g = r.gun;
    // FIRE_INTERVAL보다 큰 dt 한 번 → 쿨다운 0 도달 후 다시 발사
    r = stepGun(g, ctx({ firing: true }), 0.1);
    expect(r.bullets.length).toBe(1);
    expect(r.gun.ammo).toBe(MAG_SIZE - 2);
  });

  it('1초 동안 작은 dt 반복 홀드 → 총 발사 ≈ FIRE_RATE(12±1)발', () => {
    let g = createGun();
    let fired = 0;
    const dt = 1 / 60; // 60fps
    for (let i = 0; i < 60; i++) {
      const r = stepGun(g, ctx({ firing: true }), dt);
      fired += r.bullets.length;
      g = r.gun;
    }
    expect(fired).toBeGreaterThanOrEqual(FIRE_RATE - 1);
    expect(fired).toBeLessThanOrEqual(FIRE_RATE + 1);
  });

  it('firing=false면 쿨다운 0이어도 미발사', () => {
    const g = createGun(); // fireCooldown 0
    const r = stepGun(g, ctx({ firing: false }), 0.1);
    expect(r.bullets.length).toBe(0);
    expect(r.gun.ammo).toBe(MAG_SIZE);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('stepGun — 탄창 소진 → 재장전 → 복구', () => {
  it('마지막 1발 발사 시 ammo=0·reloading=true·reloadTimer≈RELOAD_TIME', () => {
    const g = { ...createGun(), ammo: 1, fireCooldown: 0 };
    const r = stepGun(g, ctx({ firing: true }), 0.016);
    expect(r.bullets.length).toBe(1);
    expect(r.gun.ammo).toBe(0);
    expect(r.gun.reloading).toBe(true);
    expect(r.gun.reloadTimer).toBeCloseTo(RELOAD_TIME, 5);
  });

  it('재장전 중엔 firing=true여도 발사 안 되고 타이머만 감소', () => {
    let g = { ...createGun(), ammo: 0, reloading: true, reloadTimer: RELOAD_TIME, fireCooldown: 0 };
    const r = stepGun(g, ctx({ firing: true }), 0.5);
    expect(r.bullets.length).toBe(0);
    expect(r.gun.reloading).toBe(true);
    expect(r.gun.reloadTimer).toBeCloseTo(RELOAD_TIME - 0.5, 5);
    expect(r.gun.ammo).toBe(0);
  });

  it('RELOAD_TIME 누적 경과 → reloading=false·ammo=MAG_SIZE 복구', () => {
    let g = { ...createGun(), ammo: 0, reloading: true, reloadTimer: RELOAD_TIME, fireCooldown: 0 };
    const dt = 0.1;
    // RELOAD_TIME(3s)보다 넉넉히 진행 (firing 무관)
    for (let i = 0; i < 35; i++) {
      g = stepGun(g, ctx({ firing: false }), dt).gun;
    }
    expect(g.reloading).toBe(false);
    expect(g.ammo).toBe(MAG_SIZE);
  });

  it('재장전 완료 직후 발사 재개(1발, ammo=99)', () => {
    // reloadTimer가 이번 dt로 0 이하가 되어 같은/다음 스텝에 복구
    let g = { ...createGun(), ammo: 0, reloading: true, reloadTimer: 0.05, fireCooldown: 0 };
    g = stepGun(g, ctx({ firing: true }), 0.1).gun; // 재장전 완료(이 스텝은 발사 불가)
    expect(g.reloading).toBe(false);
    expect(g.ammo).toBe(MAG_SIZE);
    const r = stepGun(g, ctx({ firing: true }), 0.016); // 복구 후 발사
    expect(r.bullets.length).toBe(1);
    expect(r.gun.ammo).toBe(MAG_SIZE - 1);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('stepGun — 발사 위치/방향 (spawnBullet)', () => {
  it('자세 0: 속도 vz≈-BULLET_SPEED, vx≈vy≈0', () => {
    const r = stepGun(createGun(), ctx({ firing: true }), 0.016);
    const b = r.bullets[0];
    expect(b.vx).toBeCloseTo(0, 4);
    expect(b.vy).toBeCloseTo(0, 4);
    expect(b.vz).toBeCloseTo(-BULLET_SPEED, 3);
  });

  it('자세 0: 위치 = shooter + forward*MUZZLE_OFFSET (z = z - MUZZLE_OFFSET)', () => {
    const sh = shooter({ x: 5, y: 300, z: -10 });
    const r = stepGun(createGun(), ctx({ firing: true, shooter: sh }), 0.016);
    const b = r.bullets[0];
    expect(b.x).toBeCloseTo(5, 4);
    expect(b.y).toBeCloseTo(300, 4);
    expect(b.z).toBeCloseTo(-10 - MUZZLE_OFFSET, 4);
  });

  it('속도 방향이 forwardOf(shooter)와 일치(yaw=90°)', () => {
    const sh = shooter({ yaw: Math.PI / 2 });
    const f = forwardOf(sh);
    const r = stepGun(createGun(), ctx({ firing: true, shooter: sh }), 0.016);
    const b = r.bullets[0];
    expect(b.vx).toBeCloseTo(f.x * BULLET_SPEED, 3);
    expect(b.vy).toBeCloseTo(f.y * BULLET_SPEED, 3);
    expect(b.vz).toBeCloseTo(f.z * BULLET_SPEED, 3);
  });

  it('탄 속도 크기 ≈ BULLET_SPEED', () => {
    const sh = shooter({ yaw: 0.7, pitch: 0.3 });
    const r = stepGun(createGun(), ctx({ firing: true, shooter: sh }), 0.016);
    const b = r.bullets[0];
    expect(len({ x: b.vx, y: b.vy, z: b.vz })).toBeCloseTo(BULLET_SPEED, 2);
  });

  it('롤만 변경해도 탄 방향 불변(롤은 기수에 무영향)', () => {
    const a = stepGun(createGun(), ctx({ firing: true, shooter: shooter({ roll: 0 }) }), 0.016).bullets[0];
    const b = stepGun(createGun(), ctx({ firing: true, shooter: shooter({ roll: 1.2 }) }), 0.016).bullets[0];
    expect(b.vx).toBeCloseTo(a.vx, 4);
    expect(b.vy).toBeCloseTo(a.vy, 4);
    expect(b.vz).toBeCloseTo(a.vz, 4);
  });

  it('생성된 탄에 life=BULLET_LIFE·owner=shooter.owner 부여', () => {
    const r = stepGun(createGun(), ctx({ firing: true, shooter: shooter({ owner: 1 }) }), 0.016);
    const b = r.bullets[0];
    expect(b.life).toBeCloseTo(BULLET_LIFE, 5);
    expect(b.owner).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('stepBullets — 이동·수명/사거리 소멸', () => {
  const bullet = (o = {}) => ({ x: 0, y: 300, z: 0, vx: 0, vy: 0, vz: -BULLET_SPEED, life: BULLET_LIFE, owner: 0, ...o });

  it('위치가 vel*dt만큼 전진, life 감소', () => {
    const dt = 0.01;
    const r = stepBullets([bullet()], dt, []);
    expect(r.bullets.length).toBe(1);
    const b = r.bullets[0];
    expect(b.x).toBeCloseTo(0, 5);
    expect(b.z).toBeCloseTo(-BULLET_SPEED * dt, 4);
    expect(b.life).toBeCloseTo(BULLET_LIFE - dt, 5);
    expect(r.hits.length).toBe(0);
  });

  it('life < dt인 탄은 소멸(hits 없음)', () => {
    const r = stepBullets([bullet({ life: 0.005 })], 0.01, []);
    expect(r.bullets.length).toBe(0);
    expect(r.hits.length).toBe(0);
  });

  it('수명 동안 누적 이동 거리 ≈ BULLET_RANGE(사거리)', () => {
    let bullets = [bullet()];
    const dt = 0.01;
    let traveled = 0;
    let prev = { x: 0, y: 300, z: 0 };
    for (let i = 0; i < 250 && bullets.length; i++) {
      const r = stepBullets(bullets, dt, []);
      if (r.bullets.length) {
        const b = r.bullets[0];
        traveled += Math.hypot(b.x - prev.x, b.y - prev.y, b.z - prev.z);
        prev = { x: b.x, y: b.y, z: b.z };
      }
      bullets = r.bullets;
    }
    // 마지막 1스텝의 소멸 분량(≈ speed*dt = 6m)만큼 오차 허용
    expect(traveled).toBeGreaterThan(BULLET_RANGE - BULLET_SPEED * dt - 1);
    expect(traveled).toBeLessThanOrEqual(BULLET_RANGE + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('stepBullets — 명중 판정 (HIT_RADIUS)', () => {
  // owner 0의 탄이 -z로 진행. 타깃을 진행선상에 둔다.
  const bullet = (o = {}) => ({ x: 0, y: 300, z: 0, vx: 0, vy: 0, vz: -BULLET_SPEED, life: BULLET_LIFE, owner: 0, ...o });

  it('타깃이 HIT_RADIUS 이내 → hit 1건, damage=GUN_DAMAGE, 탄 소멸', () => {
    const dt = 0.01; // 이동량 6m < HIT_RADIUS(12)
    const target = { owner: 1, x: 0, y: 300, z: -BULLET_SPEED * dt }; // 진행 후 위치와 동일
    const r = stepBullets([bullet()], dt, [target]);
    expect(r.hits.length).toBe(1);
    expect(r.hits[0].damage).toBe(GUN_DAMAGE);
    expect(r.hits[0].target).toBe(target);
    expect(r.hits[0].owner).toBe(0);
    expect(r.hits[0].position).toBeDefined();
    expect(r.bullets.length).toBe(0); // 명중 탄 소멸
  });

  it('명중 position이 탄의 이동 후 위치에 근사', () => {
    const dt = 0.01;
    const target = { owner: 1, x: 0, y: 300, z: -BULLET_SPEED * dt };
    const r = stepBullets([bullet()], dt, [target]);
    const p = r.hits[0].position;
    expect(p.x).toBeCloseTo(0, 3);
    expect(p.y).toBeCloseTo(300, 3);
    expect(p.z).toBeCloseTo(-BULLET_SPEED * dt, 3);
  });

  it('타깃이 HIT_RADIUS보다 멀면 hit 없음·탄 생존', () => {
    const dt = 0.01;
    const target = { owner: 1, x: HIT_RADIUS + 5, y: 300, z: -BULLET_SPEED * dt };
    const r = stepBullets([bullet()], dt, [target]);
    expect(r.hits.length).toBe(0);
    expect(r.bullets.length).toBe(1);
  });

  it('자기 자신(owner===target.owner) 제외 → hit 없음', () => {
    const dt = 0.01;
    const target = { owner: 0, x: 0, y: 300, z: -BULLET_SPEED * dt }; // 같은 owner
    const r = stepBullets([bullet({ owner: 0 })], dt, [target]);
    expect(r.hits.length).toBe(0);
    expect(r.bullets.length).toBe(1); // 빗나감 처리·생존
  });

  it('alive===false 기체는 명중 무시', () => {
    const dt = 0.01;
    const target = { owner: 1, x: 0, y: 300, z: -BULLET_SPEED * dt, alive: false };
    const r = stepBullets([bullet()], dt, [target]);
    expect(r.hits.length).toBe(0);
    expect(r.bullets.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('stepBullets — 지형 충돌 소멸', () => {
  const bullet = (o = {}) => ({ x: 0, y: 300, z: 0, vx: 0, vy: 0, vz: -BULLET_SPEED, life: BULLET_LIFE, owner: 0, ...o });

  it('terrain 함수가 항상 true → 모든 탄 소멸(hits 없음)', () => {
    const r = stepBullets([bullet(), bullet({ owner: 1 })], 0.01, [], () => true);
    expect(r.bullets.length).toBe(0);
    expect(r.hits.length).toBe(0);
  });

  it('terrain { collision } 객체 형태도 수용', () => {
    const r = stepBullets([bullet()], 0.01, [], { collision: () => true });
    expect(r.bullets.length).toBe(0);
  });

  it('terrain 미제공(undefined) → 지형 무시, 탄 정상 생존', () => {
    const r = stepBullets([bullet()], 0.01, []);
    expect(r.bullets.length).toBe(1);
  });

  it('실제 terrainCollision 래퍼: 산 내부 좌표 탄은 소멸, 빈 하늘 탄은 생존', async () => {
    const { terrainCollision } = await import('../terrain.js');
    const wrap = (x, y, z) => terrainCollision(x, y, z, 0);
    // 섬2 고산(cx 620, cz 720) 정상 부근, 낮은 고도 → 지형 내부
    const inside = { x: 620, y: 5, z: 720, vx: 0, vy: 0, vz: 0, life: BULLET_LIFE, owner: 0 };
    // 빈 하늘 고고도 → 충돌 없음
    const sky = { x: 0, y: 1200, z: 0, vx: 0, vy: 0, vz: -BULLET_SPEED, life: BULLET_LIFE, owner: 0 };
    const r = stepBullets([inside, sky], 0.001, [], wrap);
    expect(r.bullets.length).toBe(1);
    expect(r.bullets[0].x).toBeCloseTo(0, 1); // 살아남은 건 sky 탄
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('결정론 · 불변', () => {
  it('stepGun: 동일 입력 두 번 → 깊은 동등', () => {
    const g = createGun();
    const c = ctx({ firing: true });
    const a = stepGun(g, c, 0.016);
    const b = stepGun(g, c, 0.016);
    expect(b).toEqual(a);
  });

  it('stepGun: 인자 gun을 변형하지 않는다(불변)', () => {
    const g = createGun();
    const snapshot = { ...g };
    stepGun(g, ctx({ firing: true }), 0.016);
    expect(g).toEqual(snapshot);
  });

  it('stepBullets: 동일 입력 두 번 → 동일 결과', () => {
    const bullets = [{ x: 0, y: 300, z: 0, vx: 0, vy: 0, vz: -BULLET_SPEED, life: BULLET_LIFE, owner: 0 }];
    const targets = [{ owner: 1, x: 999, y: 300, z: 0 }];
    const a = stepBullets(bullets, 0.01, targets);
    const b = stepBullets(bullets, 0.01, targets);
    expect(b).toEqual(a);
  });

  it('stepBullets: 원본 배열·탄 객체를 변형하지 않는다(불변)', () => {
    const orig = { x: 0, y: 300, z: 0, vx: 0, vy: 0, vz: -BULLET_SPEED, life: BULLET_LIFE, owner: 0 };
    const bullets = [orig];
    const snapBullets = [...bullets];
    const snapOrig = { ...orig };
    stepBullets(bullets, 0.01, []);
    expect(bullets).toEqual(snapBullets);
    expect(orig).toEqual(snapOrig);
  });
});
