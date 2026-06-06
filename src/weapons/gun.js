// gun.js (M5) — 기관총: 총기 상태기계 + 탄 발사/이동/수명·사거리·명중 판정 (순수 로직)
//
// 설계: mds/design/m5-gun.md §3~§5. THREE 비의존(Vitest 대상).
// 데미지의 실제 HP 적용·사망은 M8 combat. 여기선 명중 "판정"과 데미지 "값"까지만 산출.
//
// 좌표 규약(M1 정합): 오른손, +Y 위, 기본자세 forward=(0,0,-1). 롤은 기수 방향 무관.
//   방향 벡터는 flight.js의 forwardOf를 재사용(중복 구현 금지·이미 순수).
import { forwardOf } from '../flight.js';

// ── 상수 (seed 수치 — 출발점, 튜닝 가능) ──────────────────────────────

// 발사/탄창
export const MAG_SIZE      = 100;            // 탄창 용량
export const RELOAD_TIME   = 3;              // 재장전 소요(초)
export const FIRE_RATE     = 12;             // 초당 발사 수(발/s)
export const FIRE_INTERVAL = 1 / FIRE_RATE;  // 발사 간격 ≈ 0.0833초
export const GUN_DAMAGE    = 1;              // 1발 명중당 데미지

// 탄 비행
export const BULLET_SPEED  = 600;            // 탄속(m/s)
export const BULLET_LIFE   = 2.0;            // 수명(초)
export const BULLET_RANGE  = BULLET_SPEED * BULLET_LIFE; // 파생 사거리(참고/HUD)

// 명중 판정
export const HIT_RADIUS    = 12;             // 상대 기체 명중 반경(m)

// 발사 위치(기수 앞)
export const MUZZLE_OFFSET = 8;              // 발사점 = shooter.pos + forward * MUZZLE_OFFSET

// ── 보조 함수 ────────────────────────────────────────────────────────

// 거리² (sqrt 회피)
function dist2(ax, ay, az, bx, by, bz) {
  const dx = ax - bx, dy = ay - by, dz = az - bz;
  return dx * dx + dy * dy + dz * dz;
}

// terrain 인자 유연 수용: 함수 또는 { collision } 객체. 미제공 시 false.
function terrainHit(terrain, x, y, z) {
  if (typeof terrain === 'function') return terrain(x, y, z);
  if (terrain && typeof terrain.collision === 'function') return terrain.collision(x, y, z);
  return false;
}

// 발사 위치/방향 — 기수(forward) 앞에서 탄속을 부여한 탄 생성.
function spawnBullet(shooter) {
  const f = forwardOf(shooter);   // yaw/pitch만 기여(롤 무관)
  return {
    x: shooter.x + f.x * MUZZLE_OFFSET,
    y: shooter.y + f.y * MUZZLE_OFFSET,
    z: shooter.z + f.z * MUZZLE_OFFSET,
    vx: f.x * BULLET_SPEED,
    vy: f.y * BULLET_SPEED,
    vz: f.z * BULLET_SPEED,
    life: BULLET_LIFE,
    owner: shooter.owner,
  };
}

// ── 생성 ─────────────────────────────────────────────────────────────

// 플레이어별 총기 초기 상태. 가득 찬 탄창·비재장전·쿨다운 0.
export function createGun() {
  return {
    ammo: MAG_SIZE,
    reloading: false,
    reloadTimer: 0,
    fireCooldown: 0,
  };
}

// ── 발사 스텝 ────────────────────────────────────────────────────────
//
// ctx = { firing: bool, shooter: { x,y,z, yaw,pitch,roll, owner } }
// 발사·탄창·재장전·쿨다운을 결정론적으로 1스텝 전진. gun은 불변(새 객체 반환).
export function stepGun(gun, ctx, dt) {
  const next = { ...gun };
  const bullets = [];

  // (a) 발사 쿨다운 감소. dt를 초과 차감해도 다음 발사에 잔여를 carry해(아래 (c)에서 += FIRE_INTERVAL)
  //     고정 fps에서 정확히 FIRE_RATE발/s를 유지한다(flat reset은 반올림 손실로 느려짐).
  if (next.fireCooldown > 0) next.fireCooldown -= dt;

  // (b) 재장전 진행 — 진행 중엔 발사 불가
  if (next.reloading) {
    next.reloadTimer = Math.max(0, next.reloadTimer - dt);
    if (next.reloadTimer <= 0) {
      next.reloading = false;
      next.ammo = MAG_SIZE;
    }
    return { gun: next, bullets };
  }

  // (c) 발사 가능: 홀드 && 쿨다운 끝 && 탄 있음
  if (ctx.firing && next.fireCooldown <= 0 && next.ammo > 0) {
    bullets.push(spawnBullet(ctx.shooter));
    next.ammo -= 1;
    next.fireCooldown += FIRE_INTERVAL;  // carry: 잔여 음수에 더해 평균 간격을 정확히 유지

    // (d) 탄창 소진 → 즉시 재장전 시작
    if (next.ammo <= 0) {
      next.reloading = true;
      next.reloadTimer = RELOAD_TIME;
    }
  }

  return { gun: next, bullets };
}

// ── 탄 이동/명중/소멸 스텝 ───────────────────────────────────────────
//
// targets = [{ owner, x, y, z, alive? }] — 명중 후보 기체(보통 양 플레이어).
// terrain = (x,y,z)=>bool 또는 { collision } (선택). 없으면 지형 무시.
// 이동 → 수명/사거리 차감 소멸 → 지형 충돌 소멸 → 상대 명중 판정. 모두 불변.
export function stepBullets(bullets, dt, targets, terrain) {
  const alive = [];
  const hits = [];

  for (const b of bullets) {
    // (a) 이동 + 수명 차감
    const nx = b.x + b.vx * dt;
    const ny = b.y + b.vy * dt;
    const nz = b.z + b.vz * dt;
    const life = b.life - dt;

    // (b) 수명/사거리 초과 → 소멸
    if (life <= 0) continue;

    // (c) 지형/수면 충돌 → 소멸
    if (terrain && terrainHit(terrain, nx, ny, nz)) continue;

    // (d) 명중 판정: 자기 자신 제외, 생존 기체, HIT_RADIUS 이내
    let hit = null;
    for (const t of targets) {
      if (t.owner === b.owner) continue;   // 자기 탄 자기 명중 제외
      if (t.alive === false) continue;     // 죽은 기체 무시
      if (dist2(nx, ny, nz, t.x, t.y, t.z) <= HIT_RADIUS * HIT_RADIUS) {
        hit = t;
        break;
      }
    }
    if (hit) {
      hits.push({ target: hit, owner: b.owner, damage: GUN_DAMAGE, position: { x: nx, y: ny, z: nz } });
      continue;  // 명중 탄 소멸
    }

    // (e) 생존 → 갱신된 탄 보관(불변: 새 객체)
    alive.push({ x: nx, y: ny, z: nz, vx: b.vx, vy: b.vy, vz: b.vz, life, owner: b.owner });
  }

  return { bullets: alive, hits };
}
