// missile.js (M6) — 유도미사일: 락온 상태기계 + 미사일 발사/유도비행/수명·사거리·지형·명중 판정 + 플레어 디코이 회피 (순수 로직)
//
// 설계: mds/design/m6-missile.md §3~§6. THREE 비의존(Vitest 대상).
// 데미지의 실제 HP 적용·사망/폭발은 M8 combat. 플레어 생성·수명·잔량/쿨다운은 M7 flare(여기선 flares 목록을 읽어 회피 판정에만 소비).
// 여기선 락온·발사·유도·명중 "판정"과 데미지 "값(50)"·디코이 "회피"까지만 산출(HP 미변경·플레어 미생성).
//
// 좌표 규약(M1 정합): 오른손, +Y 위, 기본자세 forward=(0,0,-1). 롤은 기수 방향 무관.
//   방향 벡터는 flight.js의 forwardOf를 재사용(중복 구현 금지·이미 순수).
import { forwardOf } from '../flight.js';

// ── 상수 (seed 수치 — 출발점, 튜닝 가능) ──────────────────────────────

// 보유/락온
export const MISSILE_AMMO  = 2;              // 플레이어당 보유 미사일 수
export const LOCK_TIME      = 2;             // 락온 누적 소요(초)
export const LOCK_CONE      = Math.PI / 180 * 15;  // 락 콘 반각(rad) ≈ 15° ≈ 0.262
export const MIN_RANGE      = 150;          // 최소 사거리(m) — 이보다 가까우면 락/발사 불가
export const MAX_RANGE      = 1200;         // 최대 사거리(m) — 이보다 멀면 락/발사 불가
export const MISSILE_DAMAGE = 50;           // 1발 명중당 데미지

// 미사일 비행
export const MISSILE_SPEED  = 250;          // 미사일 속도(m/s) — 기체(~120~180)보다 빠름
export const MAX_TURN_RATE  = 2.2;          // 유도 최대 선회율(rad/s) — 즉시 못 꺾음(회피 여지)
export const MISSILE_LIFE   = 8.0;          // 수명(초)
export const MISSILE_RANGE  = MISSILE_SPEED * MISSILE_LIFE; // 파생 참고값

// 명중 판정
export const HIT_RADIUS     = 18;           // 기체 명중 반경(m) — gun(12)보다 관대(폭발 반경 근사)

// 발사 위치(기수 앞)
export const MUZZLE_OFFSET  = 10;           // 발사점 = shooter.pos + forward * MUZZLE_OFFSET

// 플레어 디코이
export const FLARE_DECOY_RADIUS = 80;       // 미사일이 이 반경 내 활성 flare에 끌리는 거리(m)

// ── 보조 함수 ────────────────────────────────────────────────────────

// 거리² (sqrt 회피)
function dist2(ax, ay, az, bx, by, bz) {
  const dx = ax - bx, dy = ay - by, dz = az - bz;
  return dx * dx + dy * dy + dz * dz;
}

// 단위벡터(0벡터는 그대로)
function normalize(v) {
  const L = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / L, y: v.y / L, z: v.z / L };
}

// from 방향을 to 방향으로 최대 maxAngle(rad)만큼 회전한 단위벡터 반환(1스텝 slerp 근사).
//  - 두 단위벡터 사이 각 θ ≤ maxAngle 이면 to 방향 그대로(도달).
//  - θ > maxAngle 이면 from에서 to 쪽으로 maxAngle 만큼만 회전(선회율 제한).
export function turnToward(from, to, maxAngle) {
  const a = normalize(from), b = normalize(to);
  let cos = a.x * b.x + a.y * b.y + a.z * b.z;
  cos = cos < -1 ? -1 : cos > 1 ? 1 : cos;
  const theta = Math.acos(cos);
  if (theta <= maxAngle || theta === 0) return b;   // 이미 maxAngle 내 → 목표 정렬

  // 역평행(θ≈π): slerp 분모(sinθ)가 0이라 퇴화 → 임의의 수직축으로 maxAngle 만큼 회전.
  const EPS = 1e-6;
  if (Math.PI - theta < EPS) {
    // a에 수직인 축을 하나 고른다(a와 가장 안 평행한 기저축으로 외적).
    const ref = Math.abs(a.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const axis = normalize({
      x: a.y * ref.z - a.z * ref.y,
      y: a.z * ref.x - a.x * ref.z,
      z: a.x * ref.y - a.y * ref.x,
    });
    // 로드리게스 회전: a를 axis 둘레로 maxAngle 회전(축⊥a이라 v·k=0 항 생략).
    const c = Math.cos(maxAngle), s = Math.sin(maxAngle);
    return normalize({
      x: a.x * c + (axis.y * a.z - axis.z * a.y) * s,
      y: a.y * c + (axis.z * a.x - axis.x * a.z) * s,
      z: a.z * c + (axis.x * a.y - axis.y * a.x) * s,
    });
  }

  const t = maxAngle / theta;                        // 보간 비율(0~1)
  // slerp: (sin((1-t)θ)·a + sin(tθ)·b) / sinθ
  const s = Math.sin(theta) || 1;
  const w1 = Math.sin((1 - t) * theta) / s;
  const w2 = Math.sin(t * theta) / s;
  return normalize({ x: w1 * a.x + w2 * b.x, y: w1 * a.y + w2 * b.y, z: w1 * a.z + w2 * b.z });
}

// 미사일에 가장 가까운 활성 flare(life>0). 없으면 null.
function nearestFlare(m, flares) {
  let best = null, bd = Infinity;
  for (const fl of flares) {
    if (fl.life <= 0) continue;
    const d = dist2(m.x, m.y, m.z, fl.x, fl.y, fl.z);
    if (d < bd) { bd = d; best = fl; }
  }
  return best;
}

// terrain 인자 유연 수용: 함수 또는 { collision } 객체. 미제공 시 false.
function terrainHit(terrain, x, y, z) {
  if (typeof terrain === 'function') return terrain(x, y, z);
  if (terrain && typeof terrain.collision === 'function') return terrain.collision(x, y, z);
  return false;
}

// ── 락 가능 판정 (콘 + 사거리) ───────────────────────────────────────
//
// 정면 콘(forward와 (target-shooter) 사이 각 ≤ LOCK_CONE) AND 거리 ∈ [MIN_RANGE, MAX_RANGE].
// 죽은/null 타깃은 false. 순수·결정론.
export function canLock(shooter, target) {
  if (!target || target.alive === false) return false;
  const dx = target.x - shooter.x, dy = target.y - shooter.y, dz = target.z - shooter.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  // (a) 사거리: [MIN_RANGE, MAX_RANGE] (제곱 비교로 sqrt 회피)
  if (d2 < MIN_RANGE * MIN_RANGE || d2 > MAX_RANGE * MAX_RANGE) return false;
  // (b) 콘: forward 와 (target-shooter) 사이 각도 ≤ LOCK_CONE ⇔ cos ≥ cos(LOCK_CONE)
  const f = forwardOf(shooter);          // 단위벡터(yaw/pitch만, 롤 무관)
  const len = Math.sqrt(d2) || 1;
  const cos = (f.x * dx + f.y * dy + f.z * dz) / len;
  return cos >= Math.cos(LOCK_CONE);
}

// ── 생성 ─────────────────────────────────────────────────────────────

// 플레이어별 런처 초기 상태. 탄 2발·미락온·타이머 0·타깃 없음.
export function createMissileLauncher() {
  return {
    ammo: MISSILE_AMMO,   // 남은 미사일 수(시작 2)
    lockTarget: null,     // 락온 진행/완료 대상 owner index(없으면 null)
    lockTimer: 0,         // 락온 누적 시간(초). LOCK_TIME 도달 시 완료
    locked: false,        // 락 완료 여부(발사 가능)
  };
}

// 발사 위치/방향 — 기수(forward) 앞에서 미사일속을 부여한 미사일 생성.
function spawnMissile(shooter, targetOwner) {
  const f = forwardOf(shooter);   // 기수 방향으로 사출(이후 유도로 꺾임)
  return {
    x: shooter.x + f.x * MUZZLE_OFFSET,
    y: shooter.y + f.y * MUZZLE_OFFSET,
    z: shooter.z + f.z * MUZZLE_OFFSET,
    vx: f.x * MISSILE_SPEED,
    vy: f.y * MISSILE_SPEED,
    vz: f.z * MISSILE_SPEED,
    target: targetOwner,
    life: MISSILE_LIFE,
    owner: shooter.owner,
    decoyed: false,
  };
}

// ── 락온 상태기계 1스텝 ──────────────────────────────────────────────
//
// ctx = { tryLock: bool(미사일 키 엣지), shooter: {x,y,z,yaw,pitch,roll,owner}, target: {x,y,z,owner,alive?} }
//  - 엔벨로프(콘+사거리) 충족 동안 lockTimer 누적(키 불필요) → LOCK_TIME 도달 시 locked.
//  - 엔벨로프 이탈 시 락 리셋.
//  - locked && tryLock(엣지) && ammo>0 → 미사일 1발 발사, ammo--, 락 초기화(재락온 필요).
// launcher는 불변(새 객체 반환).
export function stepLock(launcher, ctx, dt) {
  const next = { ...launcher };
  let fired = null;

  const inEnvelope = canLock(ctx.shooter, ctx.target);

  if (!inEnvelope) {
    // (a) 콘/사거리 이탈 → 락 리셋(누적 무효)
    next.lockTimer = 0;
    next.locked = false;
    next.lockTarget = null;
    return { launcher: next, fired: null };
  }

  // (b) 엔벨로프 내 — 락온 진행
  next.lockTarget = ctx.target.owner;
  if (!next.locked) {
    next.lockTimer += dt;          // 콘/사거리 유지되는 동안 누적
    if (next.lockTimer >= LOCK_TIME) {
      next.lockTimer = LOCK_TIME;  // 상한 고정(표시 안정)
      next.locked = true;          // 2초 도달 → 락 완료
    }
  }

  // (c) 발사 트리거(수동) — 락 완료 + 미사일 키 엣지 + 탄 보유
  if (next.locked && ctx.tryLock && next.ammo > 0) {
    fired = spawnMissile(ctx.shooter, ctx.target.owner);
    next.ammo -= 1;
    // 발사 후 락 초기화(연속 발사하려면 재락온 필요 — 2발 신중 사용 유도)
    next.locked = false;
    next.lockTimer = 0;
    next.lockTarget = null;
  }

  return { launcher: next, fired };
}

// ── 추적 목표 위치 결정 (디코이 포함) ────────────────────────────────
//
// 반환: { x,y,z } 추적점 또는 null. 디코이 트리거 시 _decoy:true 동봉.
//  - 이미 decoyed면 가까운 flare를 계속 쫓음(기체 복귀 없음 → 회피 성공).
//  - 아직이면 추적 대상 기체를 쫓되, 활성 flare가 디코이 반경 내면 flare로 전환(_decoy:true).
function aimPoint(m, targets, flares) {
  // (1) 이미 디코이됨 → 가까운 활성 flare 추적(만료 시 null → 직진 후 소멸)
  if (m.decoyed) {
    const fl = nearestFlare(m, flares);
    return fl ? { x: fl.x, y: fl.y, z: fl.z } : null;
  }

  // (2) 추적 대상 기체 위치
  const tgt = targets.find((t) => t.owner === m.target && t.alive !== false);
  const aim = tgt ? { x: tgt.x, y: tgt.y, z: tgt.z } : null;

  // (3) 디코이 트리거: 활성 flare 중 미사일과의 거리 ≤ max(FLARE_DECOY_RADIUS, flare.radius)
  const decoy = flares.find((fl) =>
    fl.life > 0 &&
    dist2(m.x, m.y, m.z, fl.x, fl.y, fl.z) <= Math.max(FLARE_DECOY_RADIUS, fl.radius || 0) ** 2
  );
  if (decoy) return { x: decoy.x, y: decoy.y, z: decoy.z, _decoy: true };

  return aim;
}

// ── 미사일 유도/이동/수명·지형·명중 스텝 ─────────────────────────────
//
// targets = [{ owner, x, y, z, alive? }] — 명중 후보 기체.
// flares  = [{ x, y, z, radius?, life }] — M7이 전개한 활성 플레어(읽기만·비변형).
// terrain = (x,y,z)=>bool 또는 { collision } (선택). 없으면 지형 무시.
// 목표 결정(디코이) → 선회율 제한 유도 회전 → 이동 → 수명 → 지형 → 명중. 모두 불변.
export function stepMissiles(missiles, dt, targets, flares, terrain) {
  const alive = [];
  const hits = [];

  for (const m of missiles) {
    // (a) 추적 목표 결정 — 디코이 우선
    const aim = aimPoint(m, targets, flares);
    let { vx, vy, vz } = m;
    let decoyed = m.decoyed;
    if (aim && aim._decoy) decoyed = true;  // 디코이 전환

    if (aim) {
      // (b) 선회율 제한 유도: 현재 속도방향을 목표방향으로 MAX_TURN_RATE*dt 만큼만 회전
      const steered = turnToward(
        { x: vx, y: vy, z: vz },
        { x: aim.x - m.x, y: aim.y - m.y, z: aim.z - m.z },
        MAX_TURN_RATE * dt,
      );
      vx = steered.x * MISSILE_SPEED;   // 속력은 일정(MISSILE_SPEED), 방향만 갱신
      vy = steered.y * MISSILE_SPEED;
      vz = steered.z * MISSILE_SPEED;
    }

    // (c) 이동 + 수명 차감
    const nx = m.x + vx * dt, ny = m.y + vy * dt, nz = m.z + vz * dt;
    const life = m.life - dt;
    if (life <= 0) continue;                                    // (d) 수명 → 자폭/소멸
    if (terrain && terrainHit(terrain, nx, ny, nz)) continue;   // (e) 지형/수면 충돌 소멸

    // (f) 명중 판정: 디코이된 미사일은 기체에 안 맞음(회피 성공). 자기 제외·생존 기체·HIT_RADIUS 이내.
    let hit = null;
    if (!decoyed) {
      for (const t of targets) {
        if (t.owner === m.owner) continue;
        if (t.alive === false) continue;
        if (dist2(nx, ny, nz, t.x, t.y, t.z) <= HIT_RADIUS * HIT_RADIUS) { hit = t; break; }
      }
    }
    if (hit) {
      hits.push({ target: hit, owner: m.owner, damage: MISSILE_DAMAGE, position: { x: nx, y: ny, z: nz } });
      continue;  // 명중 미사일 소멸
    }

    // (g) 생존 → 갱신 미사일(불변: 새 객체)
    alive.push({ x: nx, y: ny, z: nz, vx, vy, vz, target: m.target, life, owner: m.owner, decoyed });
  }

  return { missiles: alive, hits };
}
