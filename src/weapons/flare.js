// flare.js (M7) — 플레어: 플레이어별 디스펜서(전개·잔량·쿨다운) + 디코이 수명관리 (순수 로직)
//
// 설계: mds/design/m7-flare.md §3~§5. THREE 비의존(Vitest 대상).
// flare는 플레어를 "생성"하고 잔량·쿨다운·수명을 "관리"할 뿐, 미사일을 빗나가게 하는
// "판정"은 하지 않는다. 디코이 회피는 missile(M6)이 flares 목록을 읽어 단일 지점에서 판정.
//
// 좌표 규약(M1 정합): 오른손, +Y 위, 기본자세 forward=(0,0,-1). 위치는 plain {x,y,z}.
import { FLARE_DECOY_RADIUS } from './missile.js';

// ── 상수 (seed 수치 — 출발점, 튜닝 가능) ──────────────────────────────
export const FLARE_AMMO     = 3;                  // 플레이어당 보유 플레어 수(시작 3)
export const FLARE_COOLDOWN = 5;                  // 전개 쿨다운(초) — 연속 전개 방지
export const FLARE_LIFE     = 6;                  // 디코이 유효 지속(초) — life<=0이면 디코이 무효
export const FLARE_RADIUS   = FLARE_DECOY_RADIUS; // 디코이 반경(m) — missile과 단일화(=80)

// 전개 직후 뒤/아래로 분리되는 초기 속도(시각/감각용). 0이면 고정 위치.
export const FLARE_DROP_SPEED = 25;               // (m/s) — 디코이 판정엔 영향 없음

// ── 생성 ─────────────────────────────────────────────────────────────

// 플레이어별 디스펜서 초기 상태. 잔량 3·쿨다운 0(즉시 전개 가능).
export function createFlareDispenser() {
  return {
    ammo: FLARE_AMMO,   // 남은 플레어 수(시작 3)
    cooldown: 0,        // 전개 쿨다운 잔여(초). 0 이하여야 전개 가능
  };
}

// 전개 위치·(선택)초기 속도 부여 — 기본은 기체 현재 위치 그대로.
function spawnFlare(owner, pos, vel) {
  const flare = {
    x: pos.x, y: pos.y, z: pos.z,   // 기본: 기체 현재 위치에서 전개
    life: FLARE_LIFE,
    radius: FLARE_RADIUS,
    owner,
  };
  // (선택) 진행 반대(뒤) + 약간 아래로 분리되는 초기 속도(시각용·디코이 무관)
  if (FLARE_DROP_SPEED > 0 && vel) {
    const L = Math.hypot(vel.x, vel.y, vel.z) || 1;
    flare.vx = -vel.x / L * FLARE_DROP_SPEED;        // 진행 반대(뒤)로
    flare.vy = -vel.y / L * FLARE_DROP_SPEED - 9.8;  // 약간 아래로(중력 흉내)
    flare.vz = -vel.z / L * FLARE_DROP_SPEED;
  }
  return flare;
}

// ── 전개·잔량·쿨다운 1스텝 ───────────────────────────────────────────
//
// ctx = { deploy: bool(플레어 키 엣지), owner: 0|1, pos: {x,y,z}, vel?: {x,y,z} }
//  - 매 스텝 cooldown을 dt만큼 감소(0 바닥 클램프).
//  - 전개 조건 3중: deploy && cooldown<=0 && ammo>0 → flare 생성, ammo--, cooldown=FLARE_COOLDOWN.
// state는 불변(새 객체 반환). 같은 (state, ctx, dt) → 같은 결과(결정론).
export function stepFlareDispenser(state, ctx, dt) {
  const next = { ...state };
  let flare = null;

  // (a) 쿨다운 감소(매 스텝, 0 바닥 클램프)
  if (next.cooldown > 0) next.cooldown = Math.max(0, next.cooldown - dt);

  // (b) 전개 가능: 키 엣지 && 쿨다운 끝 && 잔량 있음
  if (ctx.deploy && next.cooldown <= 0 && next.ammo > 0) {
    flare = spawnFlare(ctx.owner, ctx.pos, ctx.vel);
    next.ammo -= 1;
    next.cooldown = FLARE_COOLDOWN;   // 쿨다운 재설정(연속 전개 방지)
  }

  return { state: next, flare };
}

// ── 수명관리 1스텝 ───────────────────────────────────────────────────
//
// life-=dt 후 life<=0이면 제거. vx 있으면 위치 적분(천천히 낙하/이동).
// 생존 flares 배열을 직접 반환(부산물 없음). 불변·결정론(원본·flare 객체 비변형).
export function stepFlares(flares, dt) {
  const alive = [];
  for (const fl of flares) {
    const life = fl.life - dt;
    if (life <= 0) continue;                 // (a) 디코이 지속 만료 → 제거
    const next = { ...fl, life };
    if (fl.vx !== undefined) {               // (b) (선택) 위치 적분
      next.x = fl.x + fl.vx * dt;
      next.y = fl.y + fl.vy * dt;
      next.z = fl.z + fl.vz * dt;
    }
    alive.push(next);                        // (c) 생존 → 갱신 flare(불변: 새 객체)
  }
  return alive;
}
