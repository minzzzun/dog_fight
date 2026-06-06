// combat.js (M8) — 전투 상태: 체력/충돌/승패 (순수 로직, THREE/terrain 비의존)
//
// gun(M5, damage:1) / missile(M6, damage:50)이 산출한 hits를 "소비"해 HP를 깎고,
// terrain(M3, terrainCollision)을 terrainFn으로 주입받아 지형/수면 충돌 즉사를 처리하며,
// 단판 승패를 판정한다. 모든 함수는 불변·결정론.
//   - createPlayer / createCombat : 초기 상태 생성
//   - applyHits(combat, hits)     : 명중 데미지 적용(0 클램프, hp<=0 → 사망)
//   - checkTerrainCrash(...)      : 지형/수면 충돌 시 즉사(cause='crash')
//   - resolve(combat)             : 한 명 사망→state'over'+winner, 둘 다→'draw'
//   - stepCombat(combat, ctx)     : applyHits→checkTerrainCrash→resolve 통합 1스텝

// ── 상수 (seed 수치) ─────────────────────────────────────────────────
export const MAX_HP = 100;          // 시작 체력 — seed 고정(0 이하면 사망)
export const CRASH_MARGIN = 3;      // 충돌 margin fallback(terrain.CRASH_MARGIN과 정합). main은 명시 전달 권장.

// ── 상태 생성 ────────────────────────────────────────────────────────

// 플레이어 전투 상태 1명. 호출마다 독립된 새 객체.
export function createPlayer() {
  return {
    hp: MAX_HP,        // 체력(100 시작)
    alive: true,       // 생존 상태
    cause: null,       // 사망 원인: null | 'hit' | 'crash'
  };
}

// 세션 전투 상태. index 0=P1(좌), 1=P2(우).
export function createCombat() {
  return {
    players: [createPlayer(), createPlayer()],
    state: 'fighting',   // 'fighting' | 'over'
    winner: null,        // null(진행중) | 0 | 1 | 'draw'
  };
}

// ── 보조: hit.target → player index ──────────────────────────────────
// 무기는 후보 기체 객체({owner,...})를 target에 넣는다 → target.owner로 index.
// 숫자 index(0|1)도 수용. 식별 불가면 null.
function resolveIndex(target) {
  if (typeof target === 'number') return (target === 0 || target === 1) ? target : null;
  if (target && typeof target.owner === 'number') {
    return (target.owner === 0 || target.owner === 1) ? target.owner : null;
  }
  return null;
}

// ── 데미지 적용 ──────────────────────────────────────────────────────
// hits = [{ target, owner, damage, position? }, ...]
export function applyHits(combat, hits) {
  if (combat.state === 'over') return combat;      // 종료 후 no-op
  if (!hits || hits.length === 0) return combat;

  const players = combat.players.map((p) => ({ ...p }));  // 1단 복사(불변)

  for (const h of hits) {
    const idx = resolveIndex(h.target);
    if (idx == null) continue;                     // 식별 불가 hit 무시
    const p = players[idx];
    if (!p.alive) continue;                        // 죽은 기체엔 누적 안 함
    const dmg = h.damage || 0;
    p.hp = Math.max(0, p.hp - dmg);                // 0 바닥 클램프
    if (p.hp <= 0) { p.alive = false; p.cause = p.cause ?? 'hit'; }
  }

  return { ...combat, players };
}

// ── 충돌 즉사 ────────────────────────────────────────────────────────
// planes = [{x,y,z}, {x,y,z}]  terrainFn = (x,y,z,margin)=>bool (주입)
export function checkTerrainCrash(combat, planes, terrainFn, margin = CRASH_MARGIN) {
  if (combat.state === 'over') return combat;
  if (typeof terrainFn !== 'function' || !planes) return combat;

  const players = combat.players.map((p) => ({ ...p }));
  let changed = false;

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const pl = planes[i];
    if (!p.alive || !pl) continue;                 // 죽었거나 위치 없으면 skip
    if (terrainFn(pl.x, pl.y, pl.z, margin)) {      // 지형/수면 충돌 → 즉사
      p.hp = 0;
      p.alive = false;
      p.cause = 'crash';
      changed = true;
    }
  }

  return changed ? { ...combat, players } : combat; // 변화 없으면 원본 그대로(동일성)
}

// ── 단판 승패 판정 ───────────────────────────────────────────────────
export function resolve(combat) {
  if (combat.state === 'over') return combat;      // 멱등

  const [a, b] = combat.players;
  const aDead = !a.alive;
  const bDead = !b.alive;
  if (!aDead && !bDead) return combat;             // 둘 다 생존 → 진행 유지

  let winner;
  if (aDead && bDead) winner = 'draw';             // 동시 사망 → 무승부
  else if (aDead)     winner = 1;                  // P0 죽음 → P1 승
  else                winner = 0;                  // P1 죽음 → P0 승

  return { ...combat, state: 'over', winner };
}

// ── 통합 1스텝 (main 권장 진입점) ────────────────────────────────────
// ctx = { hits, planes, terrainFn, margin }
export function stepCombat(combat, ctx = {}) {
  if (combat.state === 'over') return combat;      // 종료 후 no-op
  let next = applyHits(combat, ctx.hits);
  next = checkTerrainCrash(next, ctx.planes, ctx.terrainFn, ctx.margin);
  next = resolve(next);
  return next;
}
