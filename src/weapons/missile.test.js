// missile.js 단위 테스트 (M6, 유도미사일 · 순수 로직)
//
// TDD RED 단계: 구현(src/weapons/missile.js)은 아직 없다. 이 테스트만 먼저 작성한다.
//
// 가정 시그니처 (설계 mds/design/m6-missile.md §3·§4·§5·§7 기준):
//   상수: MISSILE_AMMO(2), LOCK_TIME(2), LOCK_CONE(≈0.262, 15°),
//         MIN_RANGE(150), MAX_RANGE(1200), MISSILE_DAMAGE(50),
//         MAX_TURN_RATE(2.2), MISSILE_LIFE(8.0),
//         MISSILE_RANGE(=MISSILE_MAX_SPEED*MISSILE_LIFE), HIT_RADIUS(18),
//         MUZZLE_OFFSET(10), FLARE_DECOY_RADIUS(80)
//
//   ── 보강: 미사일 가속 모델 ────────────────────────────────────────────
//   기존 MISSILE_SPEED(고정 250)을 제거하고 가속 모델로 교체:
//     MISSILE_INIT_SPEED(150) — 발사 직후 초기 속력(비행기 base 120보다 약간 빠름)
//     MISSILE_MAX_SPEED(420)  — 상한 속력
//     MISSILE_ACCEL(130)      — 가속도(m/s²)
//   미사일 객체에 speed 필드 추가. 발사 시 speed=MISSILE_INIT_SPEED, 속도벡터 크기=speed.
//   stepMissiles 매 스텝: speed = min(MISSILE_MAX_SPEED, speed + MISSILE_ACCEL*dt),
//     속도벡터 = 유도방향(turnToward) * speed. 방향 유도(선회율 제한)는 그대로,
//     속력만 점점 증가(상한 MAX에서 고정).
//   canLock(shooter, target) → bool
//     shooter = { x,y,z, yaw,pitch,roll, owner }, target = { owner, x,y,z, alive? }
//   createMissileLauncher() → { ammo, lockTarget, lockTimer, locked }
//   stepLock(launcher, ctx, dt) → { launcher(불변·새 객체), fired(미사일 또는 null) }
//     ctx = { tryLock: bool, shooter: {...}, target: {...} }
//   stepMissiles(missiles, dt, targets, flares, terrain?) → { missiles(생존), hits([{target,owner,damage,position}]) }
//     targets = [{ owner, x, y, z, alive? }]
//     flares  = [{ x, y, z, radius?, life }]
//     terrain = (x,y,z)=>bool 또는 { collision:(x,y,z)=>bool } (선택). 없으면 지형 무시.
//   미사일(missile) 구조: { x,y,z, vx,vy,vz, target, life, owner, decoyed }
//   turnToward(from, to, maxAngle) → 단위벡터 {x,y,z} (선회율 제한 1스텝 slerp). 있으면 단위 검증.
//
// 좌표 규약(M1 정합): 오른손, +Y 위, 기본자세 forward=(0,0,-1). 롤은 기수 방향 무관.
// 부동소수 비교는 toBeCloseTo.
import { describe, it, expect } from 'vitest';
import {
  MISSILE_AMMO, LOCK_TIME, LOCK_CONE, MIN_RANGE, MAX_RANGE, MISSILE_DAMAGE,
  MISSILE_INIT_SPEED, MISSILE_MAX_SPEED, MISSILE_ACCEL,
  MAX_TURN_RATE, MISSILE_LIFE, MISSILE_RANGE, HIT_RADIUS,
  MUZZLE_OFFSET, FLARE_DECOY_RADIUS,
  createMissileLauncher, canLock, stepLock, stepMissiles,
} from './missile.js';
import * as missileMod from './missile.js';
import { forwardOf } from '../flight.js';

// 자세 0, owner 0 슈터 (forward = (0,0,-1) = -z 정면)
const shooter = (o = {}) => ({ x: 0, y: 300, z: 0, yaw: 0, pitch: 0, roll: 0, owner: 0, ...o });
const ctx = (o = {}) => ({ tryLock: false, shooter: shooter(), target: target(), ...o });
// 정면(-z) 600m 앞 적기(owner 1) — 콘 안 + 적정거리 기본값
const target = (o = {}) => ({ owner: 1, x: 0, y: 300, z: -600, ...o });

// 길이(노름)
const len = (v) => Math.hypot(v.x, v.y, v.z);
// 두 벡터 사이 각(rad)
const angleBetween = (a, b) => {
  const la = len(a) || 1, lb = len(b) || 1;
  let c = (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb);
  c = c < -1 ? -1 : c > 1 ? 1 : c;
  return Math.acos(c);
};

// ─────────────────────────────────────────────────────────────────────
describe('상수 — seed 수치', () => {
  it('보유/락온/사거리/데미지 상수', () => {
    expect(MISSILE_AMMO).toBe(2);
    expect(LOCK_TIME).toBe(2);
    expect(LOCK_CONE).toBeCloseTo(Math.PI / 180 * 15, 3); // ≈15°
    expect(MIN_RANGE).toBe(150);
    expect(MAX_RANGE).toBe(1200);
    expect(MISSILE_DAMAGE).toBe(50);
  });

  it('비행/명중/머즐/디코이 상수', () => {
    // 보강: 가속 모델 — 고정 MISSILE_SPEED 제거, INIT/MAX/ACCEL로 교체
    expect(MISSILE_INIT_SPEED).toBe(150); // 발사 직후 초기 속력(비행기 base 120보다 약간 빠름)
    expect(MISSILE_MAX_SPEED).toBe(420);  // 상한 속력
    expect(MISSILE_ACCEL).toBe(130);      // 가속도(m/s²)
    expect(MISSILE_INIT_SPEED).toBeLessThan(MISSILE_MAX_SPEED); // 초기 < 상한
    expect(MAX_TURN_RATE).toBeCloseTo(2.2, 5);
    expect(MISSILE_LIFE).toBeCloseTo(8.0, 5);
    // 파생 사거리 참고값은 상한 속력 기준
    expect(MISSILE_RANGE).toBeCloseTo(MISSILE_MAX_SPEED * MISSILE_LIFE, 3);
    expect(HIT_RADIUS).toBe(18);
    expect(MUZZLE_OFFSET).toBe(10);
    expect(FLARE_DECOY_RADIUS).toBe(80);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('createMissileLauncher — 초기 상태', () => {
  it('탄 2발·미락온·타이머 0·타깃 null', () => {
    const l = createMissileLauncher();
    expect(l.ammo).toBe(MISSILE_AMMO);
    expect(l.locked).toBe(false);
    expect(l.lockTimer).toBe(0);
    expect(l.lockTarget).toBe(null);
  });

  it('호출마다 독립된 새 객체를 반환한다', () => {
    const a = createMissileLauncher();
    const b = createMissileLauncher();
    expect(a).not.toBe(b);
    a.ammo = 0;
    expect(b.ammo).toBe(MISSILE_AMMO);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('canLock — 콘/사거리 판정', () => {
  it('콘 안 + 적정거리(정면 600m) → true', () => {
    expect(canLock(shooter(), target({ z: -600 }))).toBe(true);
  });

  it('콘 밖(측면 90°) → false', () => {
    // forward=(0,0,-1)인데 타깃을 +x 방향 600m에 두면 90° → 콘 밖
    expect(canLock(shooter(), target({ x: 600, z: 0 }))).toBe(false);
  });

  it('콘 밖(정후방) → false', () => {
    // 타깃을 +z(기수 반대) 600m에 두면 180° → 콘 밖
    expect(canLock(shooter(), target({ x: 0, z: 600 }))).toBe(false);
  });

  it('근거리(<MIN_RANGE, 정면 100m) → false', () => {
    expect(canLock(shooter(), target({ z: -100 }))).toBe(false);
  });

  it('원거리(>MAX_RANGE, 정면 1500m) → false', () => {
    expect(canLock(shooter(), target({ z: -1500 }))).toBe(false);
  });

  it('사거리 경계 안쪽(MIN+1, MAX-1)은 콘 안이면 true', () => {
    expect(canLock(shooter(), target({ z: -(MIN_RANGE + 1) }))).toBe(true);
    expect(canLock(shooter(), target({ z: -(MAX_RANGE - 1) }))).toBe(true);
  });

  it('콘 경계: 정면 기준 ±15° 직전은 true, 직후는 false', () => {
    const d = 600;
    // forward=(0,0,-1) 기준 각 θ: 타깃 = (d*sinθ, 300, -d*cosθ)
    const inside = (LOCK_CONE - 0.02);
    const outside = (LOCK_CONE + 0.02);
    const tIn = target({ x: d * Math.sin(inside), z: -d * Math.cos(inside) });
    const tOut = target({ x: d * Math.sin(outside), z: -d * Math.cos(outside) });
    expect(canLock(shooter(), tIn)).toBe(true);
    expect(canLock(shooter(), tOut)).toBe(false);
  });

  it('죽은 타깃(alive:false) → false', () => {
    expect(canLock(shooter(), target({ z: -600, alive: false }))).toBe(false);
  });

  it('null 타깃 → false', () => {
    expect(canLock(shooter(), null)).toBe(false);
  });

  it('콘 기준선은 forwardOf와 일치(yaw 회전 시 그 방향이 콘 중심)', () => {
    // yaw=90° 회전 → forward 방향으로 600m 앞 타깃은 콘 안
    const sh = shooter({ yaw: Math.PI / 2 });
    const f = forwardOf(sh);
    const tgt = target({ x: f.x * 600, y: 300 + f.y * 600, z: f.z * 600 });
    expect(canLock(sh, tgt)).toBe(true);
    // 회전 전(yaw=0) 기준 정면이던 -z 600m는 이제 콘 밖
    expect(canLock(sh, target({ z: -600 }))).toBe(false);
  });

  it('롤만 바꾸면 판정 불변(롤은 기수 방향 무관)', () => {
    const tgt = target({ z: -600 });
    expect(canLock(shooter({ roll: 0 }), tgt)).toBe(canLock(shooter({ roll: 1.2 }), tgt));
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('stepLock — 락온 누적/중단/완료', () => {
  it('엔벨로프 내 반복 호출 → lockTimer 단조 증가, ~2초 도달 시 locked', () => {
    let l = createMissileLauncher();
    const c = ctx({ target: target({ z: -600 }) });
    const dt = 0.1;
    let prev = -1;
    let lockedAt = null;
    for (let i = 0; i < 25; i++) {
      const r = stepLock(l, c, dt);
      expect(r.launcher.lockTimer).toBeGreaterThanOrEqual(prev);
      prev = r.launcher.lockTimer;
      l = r.launcher;
      if (l.locked && lockedAt === null) lockedAt = (i + 1) * dt;
    }
    expect(l.locked).toBe(true);
    expect(lockedAt).toBeCloseTo(LOCK_TIME, 1); // ±dt
  });

  it('락 진행 중 콘/사거리 이탈 → 리셋(timer 0, locked false, target null)', () => {
    let l = createMissileLauncher();
    // 1초 누적
    for (let i = 0; i < 10; i++) l = stepLock(l, ctx({ target: target({ z: -600 }) }), 0.1).launcher;
    expect(l.lockTimer).toBeGreaterThan(0.5);
    // 측면(콘 밖)으로 이탈한 ctx
    const r = stepLock(l, ctx({ target: target({ x: 600, z: 0 }) }), 0.1);
    expect(r.launcher.lockTimer).toBe(0);
    expect(r.launcher.locked).toBe(false);
    expect(r.launcher.lockTarget).toBe(null);
  });

  it('락온 진행 중 lockTarget이 상대 owner로 설정된다', () => {
    const r = stepLock(createMissileLauncher(), ctx({ target: target({ owner: 1, z: -600 }) }), 0.1);
    expect(r.launcher.lockTarget).toBe(1);
  });

  it('LOCK_TIME 초과해도 lockTimer는 상한 고정, locked 유지', () => {
    let l = { ...createMissileLauncher(), lockTimer: LOCK_TIME - 0.05, locked: false };
    const c = ctx({ target: target({ z: -600 }) });
    l = stepLock(l, c, 0.1).launcher; // 도달
    expect(l.locked).toBe(true);
    expect(l.lockTimer).toBeCloseTo(LOCK_TIME, 5);
    // 더 진행해도 상한 유지
    l = stepLock(l, c, 1.0).launcher;
    expect(l.lockTimer).toBeCloseTo(LOCK_TIME, 5);
    expect(l.locked).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('stepLock — 발사(수동) · 2발 제한', () => {
  // 락 완료 상태의 런처
  const lockedLauncher = (o = {}) => ({ ...createMissileLauncher(), locked: true, lockTimer: LOCK_TIME, lockTarget: 1, ...o });

  it('locked + tryLock 엣지 → 미사일 1발 생성, ammo--', () => {
    const r = stepLock(lockedLauncher(), ctx({ tryLock: true, target: target({ z: -600 }) }), 0.016);
    expect(r.fired).not.toBe(null);
    expect(r.launcher.ammo).toBe(MISSILE_AMMO - 1);
  });

  it('발사 후 락 초기화(locked false, lockTimer 0) — 재락온 필요', () => {
    const r = stepLock(lockedLauncher(), ctx({ tryLock: true, target: target({ z: -600 }) }), 0.016);
    expect(r.launcher.locked).toBe(false);
    expect(r.launcher.lockTimer).toBe(0);
  });

  it('발사 미사일: forward 방향 초기 속도(크기≈MISSILE_INIT_SPEED), speed=INIT, owner·target·life·decoyed 부여', () => {
    const sh = shooter({ owner: 0 });
    const r = stepLock(lockedLauncher(), ctx({ tryLock: true, shooter: sh, target: target({ owner: 1, z: -600 }) }), 0.016);
    const m = r.fired;
    const f = forwardOf(sh);
    // 보강: 발사 직후 속력 = MISSILE_INIT_SPEED(이후 가속)
    expect(m.vx).toBeCloseTo(f.x * MISSILE_INIT_SPEED, 2);
    expect(m.vy).toBeCloseTo(f.y * MISSILE_INIT_SPEED, 2);
    expect(m.vz).toBeCloseTo(f.z * MISSILE_INIT_SPEED, 2);
    expect(len({ x: m.vx, y: m.vy, z: m.vz })).toBeCloseTo(MISSILE_INIT_SPEED, 2);
    expect(m.speed).toBeCloseTo(MISSILE_INIT_SPEED, 5); // speed 필드 = INIT
    expect(m.owner).toBe(0);
    expect(m.target).toBe(1);
    expect(m.life).toBeCloseTo(MISSILE_LIFE, 5);
    expect(m.decoyed).toBe(false);
  });

  it('발사 위치 = shooter + forward*MUZZLE_OFFSET (정면이면 z = z - MUZZLE_OFFSET)', () => {
    const sh = shooter({ x: 5, y: 300, z: -10 });
    const r = stepLock(lockedLauncher(), ctx({ tryLock: true, shooter: sh, target: target({ z: -600 }) }), 0.016);
    const m = r.fired;
    expect(m.x).toBeCloseTo(5, 3);
    expect(m.y).toBeCloseTo(300, 3);
    expect(m.z).toBeCloseTo(-10 - MUZZLE_OFFSET, 3);
  });

  it('locked=false면 키 눌러도 미발사·ammo 불변(락온만 진행)', () => {
    const r = stepLock(createMissileLauncher(), ctx({ tryLock: true, target: target({ z: -600 }) }), 0.016);
    expect(r.fired).toBe(null);
    expect(r.launcher.ammo).toBe(MISSILE_AMMO);
  });

  it('ammo 0이면 locked·tryLock이어도 미발사', () => {
    const r = stepLock(lockedLauncher({ ammo: 0 }), ctx({ tryLock: true, target: target({ z: -600 }) }), 0.016);
    expect(r.fired).toBe(null);
    expect(r.launcher.ammo).toBe(0);
  });

  it('2발 제한: 재락온+발사 2회로 ammo 0, 3번째는 미발사', () => {
    let l = createMissileLauncher();
    const c = ctx({ tryLock: true, target: target({ z: -600 }) });
    let fired = 0;
    // 한 번의 락온(2초 자동 누적) → 발사 를 두 번 반복
    for (let round = 0; round < 3; round++) {
      // 콘/사거리 유지하며 LOCK_TIME 누적(키 없이 진행), 마지막에 tryLock으로 발사
      for (let i = 0; i < 21; i++) l = stepLock(l, ctx({ target: target({ z: -600 }) }), 0.1).launcher;
      const r = stepLock(l, c, 0.016);
      if (r.fired) fired += 1;
      l = r.launcher;
    }
    expect(fired).toBe(2);
    expect(l.ammo).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('stepMissiles — 유도(선회율 제한)', () => {
  // +z(뒤쪽)로 날아가는 미사일. 타깃은 측면/반대편에 둬 큰 선회 요구.
  // 보강: 속도크기 = speed(=MISSILE_INIT_SPEED), speed 필드 보유.
  const missile = (o = {}) => ({
    x: 0, y: 300, z: 0, vx: 0, vy: 0, vz: MISSILE_INIT_SPEED, speed: MISSILE_INIT_SPEED,
    target: 1, life: MISSILE_LIFE, owner: 0, decoyed: false, ...o,
  });

  it('1스텝 속도방향 각변화 ≤ MAX_TURN_RATE*dt (즉시 못 꺾음)', () => {
    const dt = 0.05;
    // 타깃을 정반대(-z 방향)에 둬 180° 선회 요구 — 한 스텝엔 제한만큼만
    const m = missile();
    const targets = [{ owner: 1, x: 0, y: 300, z: -2000 }];
    const r = stepMissiles([m], dt, targets, []);
    const nm = r.missiles[0];
    const before = { x: m.vx, y: m.vy, z: m.vz };
    const after = { x: nm.vx, y: nm.vy, z: nm.vz };
    expect(angleBetween(before, after)).toBeLessThanOrEqual(MAX_TURN_RATE * dt + 1e-6);
  });

  it('여러 스텝 후 목표 방향으로 수렴(미사일→타깃 각 단조 감소)', () => {
    const dt = 0.05;
    let m = missile(); // +z로 발사
    const targets = [{ owner: 1, x: 0, y: 300, z: -2000 }]; // 반대편 타깃
    let prevAngle = Infinity;
    for (let i = 0; i < 30; i++) {
      const toTgt = { x: targets[0].x - m.x, y: targets[0].y - m.y, z: targets[0].z - m.z };
      const vel = { x: m.vx, y: m.vy, z: m.vz };
      const a = angleBetween(vel, toTgt);
      expect(a).toBeLessThanOrEqual(prevAngle + 1e-6); // 각 비증가(수렴)
      prevAngle = a;
      const r = stepMissiles([m], dt, targets, []);
      if (!r.missiles.length) break;
      m = r.missiles[0];
    }
    expect(prevAngle).toBeLessThan(0.5); // 충분히 정렬
  });

  it('속력 가속: 한 스텝 후 speed 증가(가속), 속도벡터 크기 = speed', () => {
    const dt = 0.05;
    const targets = [{ owner: 1, x: 500, y: 300, z: -500 }];
    const m0 = missile();
    const r = stepMissiles([m0], dt, targets, []);
    const m1 = r.missiles[0];
    // 보강: speed = min(MAX, init + ACCEL*dt) — 한 스텝 만에 증가
    expect(m1.speed).toBeCloseTo(MISSILE_INIT_SPEED + MISSILE_ACCEL * dt, 4);
    expect(m1.speed).toBeGreaterThan(m0.speed);
    // 속도벡터 크기 = speed(방향만 유도로 회전)
    expect(len({ x: m1.vx, y: m1.vy, z: m1.vz })).toBeCloseTo(m1.speed, 3);
  });

  it('속력 단조 증가 후 MISSILE_MAX_SPEED에 수렴·상한 고정', () => {
    const dt = 0.05;
    // 표적을 도달 불가하게 멀리(가속만 검증 — 명중 소멸 회피)
    const targets = [{ owner: 1, x: 0, y: 300, z: -50000 }];
    let m = missile();
    let prev = m.speed;
    for (let i = 0; i < 60; i++) {
      m = stepMissiles([m], dt, targets, []).missiles[0];
      // 단조 비감소(가속), 상한 초과 없음
      expect(m.speed).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(m.speed).toBeLessThanOrEqual(MISSILE_MAX_SPEED + 1e-9);
      // 속도벡터 크기 = speed
      expect(len({ x: m.vx, y: m.vy, z: m.vz })).toBeCloseTo(m.speed, 2);
      prev = m.speed;
    }
    // 충분한 스텝 후 상한 도달
    expect(m.speed).toBeCloseTo(MISSILE_MAX_SPEED, 5);
    // 상한 도달 후 추가 스텝에도 상한 고정
    m = stepMissiles([m], dt, targets, []).missiles[0];
    expect(m.speed).toBeCloseTo(MISSILE_MAX_SPEED, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('stepMissiles — 명중 · 수명 · 지형', () => {
  // -z로 진행하는 미사일(타깃을 진행선상에 둠). 보강: 초기 속력 = MISSILE_INIT_SPEED, speed 필드 보유.
  const missile = (o = {}) => ({
    x: 0, y: 300, z: 0, vx: 0, vy: 0, vz: -MISSILE_INIT_SPEED, speed: MISSILE_INIT_SPEED,
    target: 1, life: MISSILE_LIFE, owner: 0, decoyed: false, ...o,
  });

  it('타깃 HIT_RADIUS 이내 → hit 1건, damage=50, target 일치, 미사일 소멸', () => {
    const dt = 0.01; // 이동량 1.5m < HIT_RADIUS(18)
    const tgt = { owner: 1, x: 0, y: 300, z: -MISSILE_INIT_SPEED * dt };
    const r = stepMissiles([missile()], dt, [tgt], []);
    expect(r.hits.length).toBe(1);
    expect(r.hits[0].damage).toBe(MISSILE_DAMAGE);
    expect(r.hits[0].target).toBe(tgt);
    expect(r.hits[0].owner).toBe(0);
    expect(r.hits[0].position).toBeDefined();
    expect(r.missiles.length).toBe(0);
  });

  it('타깃이 HIT_RADIUS보다 멀면 hit 없음·미사일 생존', () => {
    const dt = 0.01;
    const tgt = { owner: 1, x: HIT_RADIUS + 30, y: 300, z: -MISSILE_INIT_SPEED * dt };
    const r = stepMissiles([missile()], dt, [tgt], []);
    expect(r.hits.length).toBe(0);
    expect(r.missiles.length).toBe(1);
  });

  it('자기 자신(owner===target.owner) 제외 → hit 없음', () => {
    const dt = 0.01;
    const tgt = { owner: 0, x: 0, y: 300, z: -MISSILE_INIT_SPEED * dt };
    const r = stepMissiles([missile({ owner: 0 })], dt, [tgt], []);
    expect(r.hits.length).toBe(0);
  });

  it('alive===false 기체는 명중 무시', () => {
    const dt = 0.01;
    const tgt = { owner: 1, x: 0, y: 300, z: -MISSILE_INIT_SPEED * dt, alive: false };
    const r = stepMissiles([missile()], dt, [tgt], []);
    expect(r.hits.length).toBe(0);
  });

  it('life < dt인 미사일 → 소멸(hits 없음)', () => {
    const r = stepMissiles([missile({ life: 0.005 })], 0.01, [{ owner: 1, x: 9999, y: 300, z: 0 }], []);
    expect(r.missiles.length).toBe(0);
    expect(r.hits.length).toBe(0);
  });

  it('terrain 함수가 항상 true → 미사일 소멸(hits 없음)', () => {
    const r = stepMissiles([missile()], 0.01, [{ owner: 1, x: 9999, y: 300, z: 0 }], [], () => true);
    expect(r.missiles.length).toBe(0);
    expect(r.hits.length).toBe(0);
  });

  it('terrain { collision } 객체 형태도 수용', () => {
    const r = stepMissiles([missile()], 0.01, [], [], { collision: () => true });
    expect(r.missiles.length).toBe(0);
  });

  it('terrain 미제공 → 지형 무시, 미사일 정상 생존', () => {
    const r = stepMissiles([missile()], 0.01, [{ owner: 1, x: 9999, y: 300, z: 0 }], []);
    expect(r.missiles.length).toBe(1);
  });

  it('실제 terrainCollision 래퍼: 산 내부 미사일 소멸, 빈 하늘 미사일 생존', async () => {
    const { terrainCollision } = await import('../terrain.js');
    const wrap = (x, y, z) => terrainCollision(x, y, z, 0);
    const inside = { x: 620, y: 5, z: 720, vx: 0, vy: 0, vz: 0, speed: MISSILE_INIT_SPEED, target: 1, life: MISSILE_LIFE, owner: 0, decoyed: false };
    const sky = { x: 0, y: 1200, z: 0, vx: 0, vy: 0, vz: 0, speed: MISSILE_INIT_SPEED, target: 1, life: MISSILE_LIFE, owner: 0, decoyed: false };
    const r = stepMissiles([inside, sky], 0.001, [], [], wrap);
    expect(r.missiles.length).toBe(1);
    expect(r.missiles[0].y).toBeCloseTo(1200, 1); // 살아남은 건 sky
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('stepMissiles — 플레어 디코이 회피', () => {
  // 미사일이 -z로 진행, 타깃은 진행선상. flare를 미사일 근처에 둬 디코이 유발.
  // 보강: 초기 속력 = MISSILE_INIT_SPEED, speed 필드 보유.
  const missile = (o = {}) => ({
    x: 0, y: 300, z: 0, vx: 0, vy: 0, vz: -MISSILE_INIT_SPEED, speed: MISSILE_INIT_SPEED,
    target: 1, life: MISSILE_LIFE, owner: 0, decoyed: false, ...o,
  });

  it('활성 flare가 디코이 반경 내 → decoyed=true, 기체 hit 발생 안 함', () => {
    const dt = 0.01;
    const tgt = { owner: 1, x: 0, y: 300, z: -MISSILE_INIT_SPEED * dt }; // 평소라면 명중할 위치
    const flare = { x: 10, y: 300, z: 0, radius: 30, life: 2 };     // 미사일과 매우 가까움(<FLARE_DECOY_RADIUS)
    const r = stepMissiles([missile()], dt, [tgt], [flare]);
    expect(r.hits.length).toBe(0);            // 기체 명중 안 됨
    expect(r.missiles.length).toBe(1);
    expect(r.missiles[0].decoyed).toBe(true); // 디코이 전환
  });

  it('디코이된 미사일은 이후에도 기체 명중하지 않는다(회피 성공)', () => {
    const dt = 0.01;
    const tgt = { owner: 1, x: 0, y: 300, z: -5 };
    const flare = { x: 5, y: 300, z: 0, radius: 30, life: 5 };
    let m = missile({ decoyed: true }); // 이미 디코이 상태
    for (let i = 0; i < 10; i++) {
      const r = stepMissiles([m], dt, [tgt], [flare]);
      expect(r.hits.length).toBe(0);
      if (!r.missiles.length) break;
      m = r.missiles[0];
    }
  });

  it('flare가 디코이 반경 밖이면 무효 → 정상 명중', () => {
    const dt = 0.01;
    const tgt = { owner: 1, x: 0, y: 300, z: -MISSILE_INIT_SPEED * dt };
    const flare = { x: FLARE_DECOY_RADIUS + 200, y: 300, z: 0, radius: 30, life: 2 }; // 멀다
    const r = stepMissiles([missile()], dt, [tgt], [flare]);
    expect(r.hits.length).toBe(1);
    expect(r.hits[0].damage).toBe(MISSILE_DAMAGE);
  });

  it('만료 flare(life<=0)는 디코이 트리거 안 됨 → 정상 명중', () => {
    const dt = 0.01;
    const tgt = { owner: 1, x: 0, y: 300, z: -MISSILE_INIT_SPEED * dt };
    const flare = { x: 5, y: 300, z: 0, radius: 30, life: 0 }; // 만료
    const r = stepMissiles([missile()], dt, [tgt], [flare]);
    expect(r.hits.length).toBe(1);
  });

  it('flares 빈 배열 → 디코이 없음, 정상 명중', () => {
    const dt = 0.01;
    const tgt = { owner: 1, x: 0, y: 300, z: -MISSILE_INIT_SPEED * dt };
    const r = stepMissiles([missile()], dt, [tgt], []);
    expect(r.hits.length).toBe(1);
  });

  it('결정론: 동일 (missiles, flares) 두 번 → decoyed 결과 동일', () => {
    const dt = 0.01;
    const tgt = { owner: 1, x: 0, y: 300, z: -MISSILE_INIT_SPEED * dt };
    const flare = { x: 10, y: 300, z: 0, radius: 30, life: 2 };
    const a = stepMissiles([missile()], dt, [tgt], [flare]);
    const b = stepMissiles([missile()], dt, [tgt], [flare]);
    expect(b).toEqual(a);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('결정론 · 불변', () => {
  // 보강: 초기 속력 = MISSILE_INIT_SPEED, speed 필드 보유.
  const missile = (o = {}) => ({
    x: 0, y: 300, z: 0, vx: 0, vy: 0, vz: -MISSILE_INIT_SPEED, speed: MISSILE_INIT_SPEED,
    target: 1, life: MISSILE_LIFE, owner: 0, decoyed: false, ...o,
  });

  it('stepLock: 동일 입력 두 번 → 깊은 동등', () => {
    const l = createMissileLauncher();
    const c = ctx({ target: target({ z: -600 }) });
    const a = stepLock(l, c, 0.1);
    const b = stepLock(l, c, 0.1);
    expect(b).toEqual(a);
  });

  it('stepLock: 인자 launcher를 변형하지 않는다(불변)', () => {
    const l = createMissileLauncher();
    const snap = { ...l };
    stepLock(l, ctx({ target: target({ z: -600 }) }), 0.1);
    expect(l).toEqual(snap);
  });

  it('stepMissiles: 동일 입력 두 번 → 동일 결과', () => {
    const targets = [{ owner: 1, x: 500, y: 300, z: -500 }];
    const a = stepMissiles([missile()], 0.05, targets, []);
    const b = stepMissiles([missile()], 0.05, targets, []);
    expect(b).toEqual(a);
  });

  it('stepMissiles: 원본 배열·미사일 객체를 변형하지 않는다(불변)', () => {
    const orig = missile();
    const arr = [orig];
    const snapArr = [...arr];
    const snapOrig = { ...orig };
    stepMissiles(arr, 0.05, [{ owner: 1, x: 500, y: 300, z: -500 }], []);
    expect(arr).toEqual(snapArr);
    expect(orig).toEqual(snapOrig);
  });
});

// ─────────────────────────────────────────────────────────────────────
// turnToward는 보조(내부)일 수 있어 export될 때만 검증한다.
describe('turnToward — 선회율 제한 1스텝 (export 시)', () => {
  it('θ ≤ maxAngle → 목표 방향에 정렬', () => {
    if (typeof missileMod.turnToward !== 'function') return;
    const from = { x: 0, y: 0, z: -1 };
    const to = { x: 0.1, y: 0, z: -1 }; // 작은 각
    const small = angleBetween(from, to);
    const out = missileMod.turnToward(from, to, small + 0.5); // maxAngle이 θ보다 큼
    expect(len(out)).toBeCloseTo(1, 5);          // 단위벡터
    expect(angleBetween(out, to)).toBeCloseTo(0, 4); // to에 정렬
  });

  it('θ > maxAngle → from에서 to 쪽으로 정확히 maxAngle만큼 회전', () => {
    if (typeof missileMod.turnToward !== 'function') return;
    const from = { x: 0, y: 0, z: -1 };
    const to = { x: 0, y: 0, z: 1 }; // 180° 반대
    const maxAngle = 0.3;
    const out = missileMod.turnToward(from, to, maxAngle);
    expect(len(out)).toBeCloseTo(1, 5);
    expect(angleBetween(from, out)).toBeCloseTo(maxAngle, 4); // 정확히 maxAngle 회전
  });

  it('평행(θ=0) 안전: 그대로 반환(단위)', () => {
    if (typeof missileMod.turnToward !== 'function') return;
    const v = { x: 0, y: 0, z: -1 };
    const out = missileMod.turnToward(v, v, 0.3);
    expect(len(out)).toBeCloseTo(1, 5);
    expect(angleBetween(v, out)).toBeCloseTo(0, 5);
  });
});
