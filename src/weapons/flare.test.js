// flare.js 단위 테스트 (M7, 플레어 디스펜서 + 디코이 수명관리 · 순수 로직)
//
// TDD RED 단계: 구현(src/weapons/flare.js)은 아직 없다. 이 테스트만 먼저 작성한다.
//
// 가정 시그니처 (설계 mds/design/m7-flare.md §3·§4·§5·§7 기준):
//   상수: FLARE_AMMO(3), FLARE_COOLDOWN(5), FLARE_LIFE(6),  ← 보강: 수명 3→6초로 연장
//         FLARE_RADIUS(= missile.FLARE_DECOY_RADIUS = 80)
//   createFlareDispenser() → { ammo, cooldown }
//   stepFlareDispenser(state, ctx, dt) → { state(불변·새 객체), flare(생성 flare 또는 null) }
//     ctx = { deploy: bool(키 엣지), owner: 0|1, pos: {x,y,z}, vel?: {x,y,z} }
//     전개 조건 3중: deploy && cooldown<=0 && ammo>0
//       → flare 생성, ammo--, cooldown=FLARE_COOLDOWN. 매 스텝 cooldown은 dt만큼 감소(0 바닥 클램프).
//   stepFlares(flares, dt) → 생존 flares(배열 직접 반환; life-=dt, life<=0 제거, vx 있으면 위치 적분)
//   flare 구조: { x, y, z, life, radius, owner } (missile이 읽는 {x,y,z,life,radius}와 정합)
//
// 좌표 규약(M1 정합): 오른손, +Y 위, 기본자세 forward=(0,0,-1).
// 부동소수 비교는 toBeCloseTo.
import { describe, it, expect } from 'vitest';
import {
  FLARE_AMMO, FLARE_COOLDOWN, FLARE_LIFE, FLARE_RADIUS,
  createFlareDispenser, stepFlareDispenser, stepFlares,
} from './flare.js';
import { FLARE_DECOY_RADIUS, stepMissiles, MISSILE_INIT_SPEED, MISSILE_LIFE } from './missile.js';

// 기본 전개 컨텍스트(자세 무관 — pos만 사용)
const ctx = (o = {}) => ({ deploy: false, owner: 0, pos: { x: 0, y: 300, z: 0 }, ...o });

// ─────────────────────────────────────────────────────────────────────
describe('상수 — seed 수치', () => {
  it('보유/쿨다운/수명 상수', () => {
    expect(FLARE_AMMO).toBe(3);
    expect(FLARE_COOLDOWN).toBe(5);
    expect(FLARE_LIFE).toBe(6); // 보강: 디코이 지속 3→6초
  });

  it('FLARE_RADIUS는 missile.FLARE_DECOY_RADIUS와 정합(=200)', () => {
    expect(FLARE_RADIUS).toBe(FLARE_DECOY_RADIUS);
    expect(FLARE_RADIUS).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('createFlareDispenser — 초기 상태', () => {
  it('잔량 3발·쿨다운 0(즉시 전개 가능)', () => {
    const d = createFlareDispenser();
    expect(d.ammo).toBe(FLARE_AMMO);
    expect(d.cooldown).toBe(0);
  });

  it('호출마다 독립된 새 객체(공유 참조 없음)', () => {
    const a = createFlareDispenser();
    const b = createFlareDispenser();
    expect(a).not.toBe(b);
    a.ammo = 0;
    expect(b.ammo).toBe(FLARE_AMMO);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('stepFlareDispenser — 전개·잔량·쿨다운', () => {
  it('정상 전개: deploy && cooldown<=0 && ammo>0 → flare 생성, ammo--, cooldown=FLARE_COOLDOWN', () => {
    const d = createFlareDispenser();
    const r = stepFlareDispenser(d, ctx({ deploy: true }), 0.016);
    expect(r.flare).not.toBeNull();
    expect(r.state.ammo).toBe(FLARE_AMMO - 1);
    expect(r.state.cooldown).toBe(FLARE_COOLDOWN);
  });

  it('생성 flare 형태: pos 위치·life=FLARE_LIFE·radius=FLARE_RADIUS·owner (missile 정합)', () => {
    const d = createFlareDispenser();
    const r = stepFlareDispenser(d, ctx({ deploy: true, owner: 1, pos: { x: 5, y: 200, z: -7 } }), 0.016);
    const f = r.flare;
    expect(f.x).toBeCloseTo(5, 6);
    expect(f.y).toBeCloseTo(200, 6);
    expect(f.z).toBeCloseTo(-7, 6);
    expect(f.life).toBe(FLARE_LIFE);
    expect(f.radius).toBe(FLARE_RADIUS);
    expect(f.owner).toBe(1);
  });

  it('쿨다운 중(cooldown>0) deploy → flare null, ammo 불변, 쿨다운은 dt만큼 감소', () => {
    const d = { ammo: 3, cooldown: 5 };
    const r = stepFlareDispenser(d, ctx({ deploy: true }), 1);
    expect(r.flare).toBeNull();
    expect(r.state.ammo).toBe(3);
    expect(r.state.cooldown).toBeCloseTo(4, 6); // 5 - 1
  });

  it('엣지 없으면(deploy:false) 미전개 — 쿨다운만 감소', () => {
    const d = { ammo: 3, cooldown: 2 };
    const r = stepFlareDispenser(d, ctx({ deploy: false }), 0.5);
    expect(r.flare).toBeNull();
    expect(r.state.ammo).toBe(3);
    expect(r.state.cooldown).toBeCloseTo(1.5, 6);
  });

  it('잔량 0이면 deploy·cooldown<=0이어도 미전개', () => {
    const d = { ammo: 0, cooldown: 0 };
    const r = stepFlareDispenser(d, ctx({ deploy: true }), 0.016);
    expect(r.flare).toBeNull();
    expect(r.state.ammo).toBe(0);
    expect(r.state.cooldown).toBe(0); // 변동 없음
  });

  it('3발 제한: 쿨다운 경과시키며 전개 3회 → 3개 생성·ammo 0, 4번째는 null', () => {
    let d = createFlareDispenser();
    const created = [];

    // 1회차 전개
    let r = stepFlareDispenser(d, ctx({ deploy: true }), 0.016);
    d = r.state;
    if (r.flare) created.push(r.flare);

    // 2·3회차: 매번 쿨다운(5초)을 경과시킨 뒤 새 엣지로 전개
    for (let k = 0; k < 2; k++) {
      // 쿨다운 소진(키 안 누른 채 시간 경과)
      r = stepFlareDispenser(d, ctx({ deploy: false }), FLARE_COOLDOWN);
      d = r.state;
      expect(d.cooldown).toBeLessThanOrEqual(0 + 1e-9);
      // 새 엣지로 전개
      r = stepFlareDispenser(d, ctx({ deploy: true }), 0.016);
      d = r.state;
      if (r.flare) created.push(r.flare);
    }

    expect(created.length).toBe(3);
    expect(d.ammo).toBe(0);

    // 4번째: 쿨다운 경과시켜도 잔량 0이라 미전개
    r = stepFlareDispenser(d, ctx({ deploy: false }), FLARE_COOLDOWN);
    d = r.state;
    r = stepFlareDispenser(d, ctx({ deploy: true }), 0.016);
    expect(r.flare).toBeNull();
    expect(r.state.ammo).toBe(0);
  });

  it('쿨다운 경과 후 재전개 가능: dt 누적으로 cooldown<=0이 된 뒤 새 엣지로 전개', () => {
    let d = createFlareDispenser();
    // 1회 전개 → cooldown=5
    let r = stepFlareDispenser(d, ctx({ deploy: true }), 0.016);
    d = r.state;
    expect(d.cooldown).toBe(FLARE_COOLDOWN);

    // 5초 미만 경과 시점에는 재전개 불가
    r = stepFlareDispenser(d, ctx({ deploy: true }), 2);
    d = r.state;
    expect(r.flare).toBeNull(); // 아직 쿨다운 중(약 3초 남음)

    // 충분히 경과(누적 5초 이상)시킨 뒤 새 엣지로 재전개
    r = stepFlareDispenser(d, ctx({ deploy: false }), 3);
    d = r.state;
    r = stepFlareDispenser(d, ctx({ deploy: true }), 0.016);
    expect(r.flare).not.toBeNull();
    expect(r.state.ammo).toBe(FLARE_AMMO - 2);
  });

  it('쿨다운 바닥 클램프: 큰 dt로 감소해도 음수가 아니라 0에서 멈춘다', () => {
    const d = { ammo: 3, cooldown: 1 };
    const r = stepFlareDispenser(d, ctx({ deploy: false }), 10);
    expect(r.state.cooldown).toBe(0);
  });

  it('불변: 입력 state를 변형하지 않는다', () => {
    const d = createFlareDispenser();
    const snapshot = { ...d };
    stepFlareDispenser(d, ctx({ deploy: true }), 0.016);
    expect(d).toEqual(snapshot);
  });

  it('결정론: 동일 (state, ctx, dt) 두 번 → 깊은 동등', () => {
    const d = createFlareDispenser();
    const c = ctx({ deploy: true, owner: 1, pos: { x: 1, y: 2, z: 3 } });
    const a = stepFlareDispenser(d, c, 0.016);
    const b = stepFlareDispenser(d, c, 0.016);
    expect(b).toEqual(a);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('stepFlares — 수명 감소·만료 제거', () => {
  it('수명 감소: life=FLARE_LIFE인 flare → 1스텝 후 life=FLARE_LIFE-dt(생존)', () => {
    const fl = { x: 0, y: 300, z: 0, life: FLARE_LIFE, radius: FLARE_RADIUS, owner: 0 };
    const out = stepFlares([fl], 0.5);
    expect(out.length).toBe(1);
    expect(out[0].life).toBeCloseTo(FLARE_LIFE - 0.5, 6);
    // 위치는 고정(vx 없음)
    expect(out[0].x).toBeCloseTo(0, 6);
    expect(out[0].y).toBeCloseTo(300, 6);
    expect(out[0].z).toBeCloseTo(0, 6);
  });

  it('만료 제거: life<=dt인 flare → 배열에서 제거', () => {
    const fl = { x: 0, y: 300, z: 0, life: 0.01, radius: FLARE_RADIUS, owner: 0 };
    const out = stepFlares([fl], 0.02);
    expect(out.length).toBe(0);
  });

  it('여러 flare 혼재: 생존분만 정확히 반환', () => {
    const flares = [
      { x: 0, y: 300, z: 0, life: 0.005, radius: FLARE_RADIUS, owner: 0 }, // 만료
      { x: 1, y: 300, z: 0, life: 2.0, radius: FLARE_RADIUS, owner: 0 },   // 생존
      { x: 2, y: 300, z: 0, life: 0.01, radius: FLARE_RADIUS, owner: 1 },  // 만료
      { x: 3, y: 300, z: 0, life: 1.0, radius: FLARE_RADIUS, owner: 1 },   // 생존
    ];
    const out = stepFlares(flares, 0.02);
    expect(out.length).toBe(2);
    expect(out.map((f) => f.x).sort()).toEqual([1, 3]);
  });

  it('(선택) 위치 적분: vx가 있으면 x=x+vx*dt 등, 없으면 위치 불변', () => {
    const moving = { x: 0, y: 300, z: 0, vx: 10, vy: -2, vz: 4, life: 2, radius: FLARE_RADIUS, owner: 0 };
    const out = stepFlares([moving], 0.5);
    expect(out.length).toBe(1);
    expect(out[0].x).toBeCloseTo(0 + 10 * 0.5, 6);
    expect(out[0].y).toBeCloseTo(300 + -2 * 0.5, 6);
    expect(out[0].z).toBeCloseTo(0 + 4 * 0.5, 6);
  });

  it('빈 배열 안전: stepFlares([], dt) → []', () => {
    expect(stepFlares([], 0.016)).toEqual([]);
  });

  it('불변: 원본 배열·flare 객체를 변형하지 않는다', () => {
    const fl = { x: 0, y: 300, z: 0, life: FLARE_LIFE, radius: FLARE_RADIUS, owner: 0 };
    const flares = [fl];
    const snapshot = { ...fl };
    stepFlares(flares, 0.5);
    expect(flares.length).toBe(1);
    expect(fl).toEqual(snapshot);
  });

  it('결정론: 동일 (flares, dt) 두 번 → 동일 결과', () => {
    const flares = [
      { x: 0, y: 300, z: 0, life: 2, radius: FLARE_RADIUS, owner: 0 },
      { x: 5, y: 300, z: 0, vx: 1, vy: 0, vz: 0, life: 1, radius: FLARE_RADIUS, owner: 1 },
    ];
    const a = stepFlares(flares, 0.1);
    const b = stepFlares(flares, 0.1);
    expect(b).toEqual(a);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('missile 디코이와 호환 (통합 케이스)', () => {
  // 미사일이 -z로 진행, 타깃은 진행선상(평소라면 명중). flare를 미사일 근처에 둔다.
  // 보강(missile 가속 모델): 초기 속력 = MISSILE_INIT_SPEED, speed 필드 보유.
  const missile = (o = {}) => ({
    x: 0, y: 300, z: 0, vx: 0, vy: 0, vz: -MISSILE_INIT_SPEED, speed: MISSILE_INIT_SPEED,
    target: 1, life: MISSILE_LIFE, owner: 0, decoyed: false, ...o,
  });

  it('stepFlareDispenser로 만든 flare를 미사일 근처에 두면 디코이 발동 → hits 없음·decoyed=true', () => {
    const dt = 0.01;
    // 미사일 위치(0,300,0) 근처에 전개되도록 pos를 잡는다(FLARE_DECOY_RADIUS=80 이내).
    const d = createFlareDispenser();
    const made = stepFlareDispenser(d, ctx({ deploy: true, owner: 1, pos: { x: 10, y: 300, z: 0 } }), dt);
    const flare = made.flare;
    expect(flare).not.toBeNull();

    const tgt = { owner: 1, x: 0, y: 300, z: -MISSILE_INIT_SPEED * dt }; // 평소라면 명중할 위치
    const r = stepMissiles([missile()], dt, [tgt], [flare]);
    expect(r.hits.length).toBe(0);            // 기체 명중 안 됨(디코이)
    expect(r.missiles.length).toBe(1);
    expect(r.missiles[0].decoyed).toBe(true); // 디코이 전환
  });

  it('생성 flare는 life>0·radius 보유 → missile.test.js 디코이 형태와 정합', () => {
    const d = createFlareDispenser();
    const r = stepFlareDispenser(d, ctx({ deploy: true }), 0.01);
    const f = r.flare;
    expect(f.life).toBeGreaterThan(0);
    expect(typeof f.radius).toBe('number');
    expect(typeof f.x).toBe('number');
    expect(typeof f.y).toBe('number');
    expect(typeof f.z).toBe('number');
  });

  it('stepFlares로 만료된 flare(life<=0 → 제거)는 디코이 무효 → 정상 명중', () => {
    const dt = 0.01;
    // 수명이 거의 다 된 flare를 stepFlares로 만료시키면 배열에서 제거됨
    const expiring = { x: 5, y: 300, z: 0, life: 0.005, radius: FLARE_RADIUS, owner: 1 };
    const survivors = stepFlares([expiring], 0.02);
    expect(survivors.length).toBe(0); // 제거됨

    const tgt = { owner: 1, x: 0, y: 300, z: -MISSILE_INIT_SPEED * dt };
    const r = stepMissiles([missile()], dt, [tgt], survivors); // 디코이 후보 없음
    expect(r.hits.length).toBe(1);            // 정상 명중
    expect(r.missiles.length).toBe(0);
  });
});

// ── 플레어 시간 재장전 (보강) ───────────────────────────────────────
import { FLARE_REGEN, FLARE_AMMO as FLARE_AMMO_MAX, createFlareDispenser as mkDisp, stepFlareDispenser as stepDisp } from './flare.js';

describe('플레어 시간 재장전(FLARE_REGEN)', () => {
  const ctx = { deploy: false, owner: 0, pos: { x: 0, y: 0, z: 0 } };

  it('FLARE_REGEN=180', () => {
    expect(FLARE_REGEN).toBe(180);
  });

  it('ammo 0에서 180초 경과 → 1발 재충전', () => {
    let s = { ...mkDisp(), ammo: 0 };
    s = stepDisp(s, ctx, 180).state;
    expect(s.ammo).toBe(1);
  });

  it('최대 FLARE_AMMO(3) 초과 재충전 안 됨', () => {
    let s = { ...mkDisp(), ammo: 2 };
    s = stepDisp(s, ctx, 180).state;   // →3
    s = stepDisp(s, ctx, 180).state;   // 유지(3)
    expect(s.ammo).toBe(FLARE_AMMO_MAX);
  });
});
