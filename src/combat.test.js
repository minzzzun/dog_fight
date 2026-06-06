// combat.js 단위 테스트 (M8, 전투 상태: 체력/충돌/승패 · 순수 로직)
//
// TDD RED 단계: 구현(src/combat.js)은 아직 없다. 이 테스트만 먼저 작성한다.
//
// 가정 시그니처 (설계 mds/design/m8-combat.md §3·§4·§5·§7 기준):
//   상수: MAX_HP(100), CRASH_MARGIN(3)
//   createPlayer() → { hp:100, alive:true, cause:null }
//   createCombat() → { players:[p0,p1], state:'fighting', winner:null }
//   applyHits(combat, hits) → combat(불변·새 객체)
//     hits = [{ target, owner, damage, position? }, ...]
//       target: 피격 플레이어 식별 — 무기는 후보 기체 객체({owner,...})를 넣는다 → target.owner로 index.
//               숫자 index(0|1)도 수용.
//       owner : 가해 플레이어 index(자기명중은 무기에서 이미 제외).
//       damage: gun=1, missile=50. 누락 시 0 취급.
//   checkTerrainCrash(combat, planes, terrainFn, margin?) → combat(불변)
//     planes = [{x,y,z}, {x,y,z}]  // index 0/1 기체 위치
//     terrainFn = (x,y,z,margin)=>bool  // terrain.terrainCollision 주입
//   resolve(combat) → combat(불변·멱등). 한 명 사망→state'over'+winner=상대 index, 둘 다→'draw'.
//   stepCombat(combat, { hits, planes, terrainFn, margin }) → combat(불변·결정론)
//     applyHits → checkTerrainCrash → resolve 통합. state==='over'면 no-op.
//
// combat은 THREE/terrain 비의존(terrainFn 주입). 부동소수 비교는 toBeCloseTo.
import { describe, it, expect } from 'vitest';
import {
  MAX_HP, CRASH_MARGIN,
  createPlayer, createCombat,
  applyHits, checkTerrainCrash, resolve, stepCombat,
} from './combat.js';

// 피격 식별용 타깃 객체(무기가 산출하는 형태). owner index로 식별.
const tgt = (owner, o = {}) => ({ owner, x: 0, y: 300, z: 0, alive: true, ...o });
// hit 1건(무기 hits 요소 형태)
const hit = (owner, damage, o = {}) => ({ target: tgt(owner), owner: owner === 0 ? 1 : 0, damage, ...o });

// ─────────────────────────────────────────────────────────────────────
describe('상수 — seed 수치', () => {
  it('MAX_HP=100, CRASH_MARGIN=3', () => {
    expect(MAX_HP).toBe(100);
    expect(CRASH_MARGIN).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('createPlayer — 초기 상태', () => {
  it('hp=100·alive=true·cause=null', () => {
    const p = createPlayer();
    expect(p.hp).toBe(MAX_HP);
    expect(p.alive).toBe(true);
    expect(p.cause).toBe(null);
  });

  it('호출마다 독립된 새 객체를 반환한다', () => {
    const a = createPlayer();
    const b = createPlayer();
    expect(a).not.toBe(b);
    a.hp = 1;
    expect(b.hp).toBe(MAX_HP);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('createCombat — 세션 초기 상태', () => {
  it('players 2명(둘 다 100/생존)·state=fighting·winner=null', () => {
    const c = createCombat();
    expect(c.players.length).toBe(2);
    expect(c.players[0].hp).toBe(MAX_HP);
    expect(c.players[1].hp).toBe(MAX_HP);
    expect(c.players[0].alive).toBe(true);
    expect(c.players[1].alive).toBe(true);
    expect(c.state).toBe('fighting');
    expect(c.winner).toBe(null);
  });

  it('두 플레이어는 서로 다른 객체(공유 참조 금지)', () => {
    const c = createCombat();
    expect(c.players[0]).not.toBe(c.players[1]);
  });

  it('호출마다 독립된 combat', () => {
    const a = createCombat();
    const b = createCombat();
    expect(a).not.toBe(b);
    a.players[0].hp = 1;
    expect(b.players[0].hp).toBe(MAX_HP);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('applyHits — 명중 데미지 적용', () => {
  it('기관총 hit(damage 1) → 피격자 hp 99', () => {
    const c = createCombat();
    // owner 1이 player 0을 명중(damage 1)
    const r = applyHits(c, [{ target: tgt(0), owner: 1, damage: 1 }]);
    expect(r.players[0].hp).toBe(99);
    expect(r.players[0].alive).toBe(true);
    expect(r.players[1].hp).toBe(MAX_HP); // 가해자 무변화
  });

  it('미사일 hit(damage 50) → 피격자 hp 50', () => {
    const c = createCombat();
    const r = applyHits(c, [{ target: tgt(0), owner: 1, damage: 50 }]);
    expect(r.players[0].hp).toBe(50);
    expect(r.players[0].alive).toBe(true);
  });

  it('여러 hit 누적: damage 50 두 번 → hp 0·사망', () => {
    const c = createCombat();
    const r = applyHits(c, [
      { target: tgt(0), owner: 1, damage: 50 },
      { target: tgt(0), owner: 1, damage: 50 },
    ]);
    expect(r.players[0].hp).toBe(0);
    expect(r.players[0].alive).toBe(false);
  });

  it('기관총 hit 여러 발 누적(damage 1 × 3) → hp 97', () => {
    const c = createCombat();
    const hits = [
      { target: tgt(1), owner: 0, damage: 1 },
      { target: tgt(1), owner: 0, damage: 1 },
      { target: tgt(1), owner: 0, damage: 1 },
    ];
    const r = applyHits(c, hits);
    expect(r.players[1].hp).toBe(97);
  });

  it('hp 0 클램프: 과도한 데미지여도 음수가 되지 않는다', () => {
    const c = createCombat();
    const r = applyHits(c, [{ target: tgt(0), owner: 1, damage: 250 }]);
    expect(r.players[0].hp).toBe(0);
    expect(r.players[0].alive).toBe(false);
  });

  it('hp 0이면 alive=false, cause=hit', () => {
    const c = createCombat();
    const r = applyHits(c, [{ target: tgt(0), owner: 1, damage: 100 }]);
    expect(r.players[0].hp).toBe(0);
    expect(r.players[0].alive).toBe(false);
    expect(r.players[0].cause).toBe('hit');
  });

  it('hit.target이 숫자 index(0|1)여도 수용', () => {
    const c = createCombat();
    const r = applyHits(c, [{ target: 1, owner: 0, damage: 50 }]);
    expect(r.players[1].hp).toBe(50);
  });

  it('hit.target 객체의 owner로 피격자를 식별(target=객체)', () => {
    const c = createCombat();
    const r = applyHits(c, [{ target: { owner: 1, x: 5, y: 5, z: 5 }, owner: 0, damage: 50 }]);
    expect(r.players[1].hp).toBe(50);
    expect(r.players[0].hp).toBe(MAX_HP);
  });

  it('damage 누락 시 0 취급(hp 불변)', () => {
    const c = createCombat();
    const r = applyHits(c, [{ target: tgt(0), owner: 1 }]);
    expect(r.players[0].hp).toBe(MAX_HP);
  });

  it('빈 hits/없는 hits → 변화 없음', () => {
    const c = createCombat();
    expect(applyHits(c, []).players[0].hp).toBe(MAX_HP);
    expect(applyHits(c, undefined).players[0].hp).toBe(MAX_HP);
  });

  it('죽은(alive=false) 플레이어에 추가 hit → 변화 없음(음수 안 됨)', () => {
    const c = createCombat();
    c.players[0].hp = 0;
    c.players[0].alive = false;
    const r = applyHits(c, [{ target: tgt(0), owner: 1, damage: 50 }]);
    expect(r.players[0].hp).toBe(0);
    expect(r.players[0].alive).toBe(false);
  });

  it('같은 프레임 동시 다발 hit으로 죽기까지는 누적, 죽은 뒤 hit은 무시', () => {
    const c = createCombat(); // hp 100
    // 50+50=죽음, 그 뒤 50은 무시(음수 방지)
    const r = applyHits(c, [
      { target: tgt(0), owner: 1, damage: 50 },
      { target: tgt(0), owner: 1, damage: 50 },
      { target: tgt(0), owner: 1, damage: 50 },
    ]);
    expect(r.players[0].hp).toBe(0);
    expect(r.players[0].alive).toBe(false);
  });

  it('state=over면 no-op(데미지 미적용)', () => {
    const c = createCombat();
    c.state = 'over';
    const r = applyHits(c, [{ target: tgt(0), owner: 1, damage: 50 }]);
    expect(r.players[0].hp).toBe(MAX_HP);
  });

  it('식별 불가 hit(target null/잘못된 index)는 무시', () => {
    const c = createCombat();
    const r = applyHits(c, [
      { target: null, owner: 1, damage: 50 },
      { target: 5, owner: 1, damage: 50 },
    ]);
    expect(r.players[0].hp).toBe(MAX_HP);
    expect(r.players[1].hp).toBe(MAX_HP);
  });

  it('불변: 인자 combat·players를 변형하지 않는다', () => {
    const c = createCombat();
    const snap = JSON.stringify(c);
    applyHits(c, [{ target: tgt(0), owner: 1, damage: 50 }]);
    expect(JSON.stringify(c)).toBe(snap);
  });

  it('불변: 입력 hits 배열을 변형하지 않는다', () => {
    const c = createCombat();
    const hits = [{ target: tgt(0), owner: 1, damage: 50 }];
    const snap = JSON.stringify(hits);
    applyHits(c, hits);
    expect(JSON.stringify(hits)).toBe(snap);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('checkTerrainCrash — 지형/수면 충돌 즉사', () => {
  const planeAt = (o = {}) => ({ x: 0, y: 300, z: 0, ...o });

  it('지형/수면 충돌(terrainFn true) 기체 → 즉사(hp 0·alive false·cause crash)', () => {
    const c = createCombat();
    const planes = [planeAt({ y: 1 }), planeAt({ y: 300 })];
    const r = checkTerrainCrash(c, planes, () => true, 3);
    expect(r.players[0].hp).toBe(0);
    expect(r.players[0].alive).toBe(false);
    expect(r.players[0].cause).toBe('crash');
  });

  it('충돌 아닌 기체(terrainFn false) → 무변화', () => {
    const c = createCombat();
    const planes = [planeAt(), planeAt()];
    const r = checkTerrainCrash(c, planes, () => false, 3);
    expect(r.players[0].hp).toBe(MAX_HP);
    expect(r.players[0].alive).toBe(true);
    expect(r.players[1].hp).toBe(MAX_HP);
  });

  it('planes/players 인덱스 정합: index 1 기체만 수면 충돌 → player 1만 즉사', () => {
    const c = createCombat();
    // 수면 판정 가짜 함수: y<=0이면 충돌
    const waterFn = (x, y, z) => y <= 0;
    const planes = [planeAt({ y: 300 }), planeAt({ y: -5 })];
    const r = checkTerrainCrash(c, planes, waterFn, 0);
    expect(r.players[0].alive).toBe(true);
    expect(r.players[1].alive).toBe(false);
    expect(r.players[1].cause).toBe('crash');
  });

  it('두 기체 모두 충돌 → 둘 다 즉사', () => {
    const c = createCombat();
    const planes = [planeAt({ y: 1 }), planeAt({ y: 1 })];
    const r = checkTerrainCrash(c, planes, () => true, 3);
    expect(r.players[0].alive).toBe(false);
    expect(r.players[1].alive).toBe(false);
  });

  it('이미 죽은 기체는 다시 처리하지 않음(crash로 덮어쓰지 않음)', () => {
    const c = createCombat();
    c.players[0].hp = 0;
    c.players[0].alive = false;
    c.players[0].cause = 'hit';
    const planes = [planeAt({ y: 1 }), planeAt({ y: 300 })];
    const r = checkTerrainCrash(c, planes, () => true, 3);
    expect(r.players[0].cause).toBe('hit'); // 기존 사망 원인 유지
  });

  it('충돌이 하나도 없으면 원본 combat을 그대로 반환(불변·동일성)', () => {
    const c = createCombat();
    const planes = [planeAt(), planeAt()];
    const r = checkTerrainCrash(c, planes, () => false, 3);
    expect(r).toBe(c);
  });

  it('margin 인자가 terrainFn에 전달된다', () => {
    const c = createCombat();
    let seenMargin = null;
    const fn = (x, y, z, margin) => { seenMargin = margin; return false; };
    checkTerrainCrash(c, [planeAt(), planeAt()], fn, 7);
    expect(seenMargin).toBe(7);
  });

  it('margin 미전달 시 CRASH_MARGIN 기본값 사용', () => {
    const c = createCombat();
    let seenMargin = null;
    const fn = (x, y, z, margin) => { seenMargin = margin; return false; };
    checkTerrainCrash(c, [planeAt(), planeAt()], fn);
    expect(seenMargin).toBe(CRASH_MARGIN);
  });

  it('state=over면 no-op', () => {
    const c = createCombat();
    c.state = 'over';
    const r = checkTerrainCrash(c, [planeAt({ y: 1 }), planeAt({ y: 1 })], () => true, 3);
    expect(r.players[0].alive).toBe(true);
  });

  it('실제 terrainCollision 주입: 산 내부 좌표 기체는 즉사, 빈 하늘 기체는 생존', async () => {
    const { terrainCollision } = await import('./terrain.js');
    const c = createCombat();
    // 섬2 고산(cx 620, cz 720) 정상 부근 낮은 고도 → 지형 내부 / 빈 하늘 고고도 → 안전
    const planes = [{ x: 620, y: 5, z: 720 }, { x: 0, y: 1200, z: 0 }];
    const r = checkTerrainCrash(c, planes, terrainCollision, 0);
    expect(r.players[0].alive).toBe(false);
    expect(r.players[0].cause).toBe('crash');
    expect(r.players[1].alive).toBe(true);
  });

  it('불변: 인자 combat을 변형하지 않는다', () => {
    const c = createCombat();
    const snap = JSON.stringify(c);
    checkTerrainCrash(c, [planeAt({ y: 1 }), planeAt({ y: 300 })], () => true, 3);
    expect(JSON.stringify(c)).toBe(snap);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('resolve — 단판 승패 판정', () => {
  it('아무도 안 죽음 → state fighting 유지·winner null', () => {
    const c = createCombat();
    const r = resolve(c);
    expect(r.state).toBe('fighting');
    expect(r.winner).toBe(null);
  });

  it('player 0 사망 → state over·winner 1(상대 승)', () => {
    const c = createCombat();
    c.players[0].alive = false;
    c.players[0].hp = 0;
    const r = resolve(c);
    expect(r.state).toBe('over');
    expect(r.winner).toBe(1);
  });

  it('player 1 사망 → state over·winner 0(상대 승)', () => {
    const c = createCombat();
    c.players[1].alive = false;
    c.players[1].hp = 0;
    const r = resolve(c);
    expect(r.state).toBe('over');
    expect(r.winner).toBe(0);
  });

  it('둘 다 사망(동시) → winner draw', () => {
    const c = createCombat();
    c.players[0].alive = false;
    c.players[1].alive = false;
    const r = resolve(c);
    expect(r.state).toBe('over');
    expect(r.winner).toBe('draw');
  });

  it('이미 over인 combat은 멱등(그대로 반환)', () => {
    const c = createCombat();
    c.state = 'over';
    c.winner = 1;
    const r = resolve(c);
    expect(r.state).toBe('over');
    expect(r.winner).toBe(1);
  });

  it('불변: 둘 다 생존 시 인자 combat 변형 없음', () => {
    const c = createCombat();
    const snap = JSON.stringify(c);
    resolve(c);
    expect(JSON.stringify(c)).toBe(snap);
  });

  it('불변: 사망 판정 시에도 인자 combat 변형 없음', () => {
    const c = createCombat();
    c.players[0].alive = false;
    const snap = JSON.stringify(c);
    resolve(c);
    expect(JSON.stringify(c)).toBe(snap);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('stepCombat — 통합 1스텝 (데미지→충돌→승패)', () => {
  const planeAt = (o = {}) => ({ x: 0, y: 300, z: 0, ...o });

  it('데미지만으로 격추: 미사일 두 발 hit → player 0 사망·winner 1', () => {
    const c = createCombat();
    const r = stepCombat(c, {
      hits: [
        { target: tgt(0), owner: 1, damage: 50 },
        { target: tgt(0), owner: 1, damage: 50 },
      ],
      planes: [planeAt(), planeAt()],
      terrainFn: () => false,
      margin: 3,
    });
    expect(r.players[0].alive).toBe(false);
    expect(r.state).toBe('over');
    expect(r.winner).toBe(1);
  });

  it('충돌로 격추: player 1 지형 충돌 → 사망·winner 0', () => {
    const c = createCombat();
    const r = stepCombat(c, {
      hits: [],
      planes: [planeAt({ y: 300 }), planeAt({ y: 1 })],
      terrainFn: (x, y, z) => y < 3,
      margin: 0,
    });
    expect(r.players[1].alive).toBe(false);
    expect(r.players[1].cause).toBe('crash');
    expect(r.winner).toBe(0);
  });

  it('데미지+충돌 동시: 한쪽 미사일 격추 + 다른쪽 충돌 → 둘 다 사망 → draw', () => {
    const c = createCombat();
    const r = stepCombat(c, {
      hits: [{ target: tgt(0), owner: 1, damage: 100 }],
      planes: [planeAt({ y: 300 }), planeAt({ y: 1 })],
      terrainFn: (x, y, z) => y < 3,
      margin: 0,
    });
    expect(r.players[0].alive).toBe(false);
    expect(r.players[1].alive).toBe(false);
    expect(r.winner).toBe('draw');
  });

  it('아무 일 없으면 fighting 유지·winner null', () => {
    const c = createCombat();
    const r = stepCombat(c, {
      hits: [{ target: tgt(0), owner: 1, damage: 1 }],
      planes: [planeAt(), planeAt()],
      terrainFn: () => false,
      margin: 3,
    });
    expect(r.players[0].hp).toBe(99);
    expect(r.state).toBe('fighting');
    expect(r.winner).toBe(null);
  });

  it('state=over면 no-op(데미지·충돌 누적 안 함)', () => {
    const c = createCombat();
    c.state = 'over';
    c.winner = 0;
    const r = stepCombat(c, {
      hits: [{ target: tgt(1), owner: 0, damage: 50 }],
      planes: [planeAt({ y: 1 }), planeAt({ y: 1 })],
      terrainFn: () => true,
      margin: 3,
    });
    expect(r.players[1].hp).toBe(MAX_HP);
    expect(r.winner).toBe(0);
  });

  it('빈 ctx여도 안전(no-op, fighting 유지)', () => {
    const c = createCombat();
    const r = stepCombat(c, {});
    expect(r.state).toBe('fighting');
    expect(r.winner).toBe(null);
  });

  it('결정론: 동일 입력 두 번 → 깊은 동등', () => {
    const c = createCombat();
    const ctx = {
      hits: [{ target: tgt(0), owner: 1, damage: 50 }],
      planes: [planeAt(), planeAt()],
      terrainFn: () => false,
      margin: 3,
    };
    const a = stepCombat(c, ctx);
    const b = stepCombat(c, ctx);
    expect(b).toEqual(a);
  });

  it('불변: 인자 combat을 변형하지 않는다', () => {
    const c = createCombat();
    const snap = JSON.stringify(c);
    stepCombat(c, {
      hits: [{ target: tgt(0), owner: 1, damage: 50 }],
      planes: [planeAt({ y: 1 }), planeAt()],
      terrainFn: () => false,
      margin: 3,
    });
    expect(JSON.stringify(c)).toBe(snap);
  });
});
