# 설계 — M6 유도미사일 (src/weapons/missile.js 순수 로직)

> 상태: 설계 완료(구현 대기) · 작성: 2026-06-07
> 범위: **순수** `src/weapons/missile.js`(런처 락온 상태기계 + 미사일 발사·유도비행·수명/사거리 소멸·명중 판정·플레어 디코이 회피, THREE 비의존, Vitest 대상)만. 데미지의 **실제 HP 적용**·폭발/사망은 M8 `combat.js`. **플레어 생성·수명·잔량/쿨다운**은 M7 `flare.js`(여기선 `flares` 목록을 **소비**만). 미사일/락 콘 메시·발사음·락온경고음 결선은 렌더/사운드(M4 패밀리·M10).
> SSoT: `mds/spec/seed.md`. 미사일 규칙: "총 2발, 명중 시 체력 -50, 발사 전 락온 2초 필요, 정면 락 콘(~15°) 안에 상대가 있고 최소사거리(~150m)~최대사거리(~1200m) 범위일 때만 발사 가능, 발사 후 상대를 선회율 제한 내에서 유도 추적, 수명 후 자폭/소멸, 플레어로 회피". 좌표/경계는 M1 정합(+Y up, 수면 y=0, `forward=(0,0,-1)` at zero attitude).

---

## 1. 목표와 비범위

### 목표 (이번 M6에서 만든다 — 순수 로직)
- 플레이어별 **런처 상태(락온 상태기계)**: `createMissileLauncher()` → `{ ammo, lockTarget, lockTimer, locked }`.
- **락 판정 순수 함수** `canLock(shooter, target)` → bool: 정면 콘(`forwardOf` 와 `(target-shooter)` 사이 각도 ≤ `LOCK_CONE`) **그리고** 거리 ∈ `[MIN_RANGE, MAX_RANGE]`.
- **락온 스텝** `stepLock(launcher, ctx, dt)` → `{ launcher(새 상태), fired(미사일 또는 null) }`.
  - 입력: `ctx.tryLock`(미사일 키 엣지 bool), `ctx.shooter`(`{x,y,z,yaw,pitch,roll, owner}`), `ctx.target`(상대 기체 `{x,y,z, owner, alive?}`), `dt`.
  - 콘/사거리 충족 동안 `lockTimer` 누적 → `LOCK_TIME`(2초) 도달 시 `locked=true`. 콘/사거리 이탈 시 락 리셋. 발사 트리거(§5.2 권고안).
- **미사일 유도/명중/소멸 스텝** `stepMissiles(missiles, dt, targets, flares, terrain?)` → `{ missiles(생존), hits:[{ target, owner, damage, position }] }`.
  - 목표 방향으로 **선회율 제한**(`MAX_TURN_RATE` rad/s) 내 속도벡터 회전 → 위치 적분, 수명/사거리 소멸, 지형 충돌 소멸, 명중(`HIT_RADIUS`) 판정, **플레어 디코이 회피**.

### 비범위 (타 마일스톤)
- **HP 감소·사망·폭발**: M8 `combat.js`가 `hits`를 받아 `target.hp -= 50` 적용. missile은 **명중 판정 + 데미지 값(50)**까지만 산출(§6).
- **플레어 생성/수명/잔량/쿨다운/전개 위치**: M7 `flare.js`. missile은 `stepMissiles`에 넘어온 `flares` 배열(`{x,y,z, radius, life}`)을 **읽어서 회피 판정에만 사용**(소비). 플레어를 줄이거나 생성하지 않는다.
- **미사일/락 콘/락온 표시 메시, 발사음·락온경고음**: 렌더(M4 패밀리)·사운드(M10). missile은 `{x,y,z}`/숫자/배열/bool만 입출력.
- **잔량·락온 HUD 표시**: M9. missile은 `ammo`/`lockTimer`/`locked` 상태만 노출.
- **기관총·플레어 로직**: M5/M7 별도 모듈. 미사일은 기체·지형·플레어만 상대(탄과 상호작용 없음).

---

## 2. 파일 변경 요약

| 파일 | 변경 | 비고 |
|---|---|---|
| `src/weapons/missile.js` | **신규** — 상수 + `createMissileLauncher`/`canLock`/`stepLock`/`stepMissiles` + 벡터 헬퍼 | THREE 비의존. Vitest 대상 |
| `src/weapons/missile.test.js` | **신규** — 순수 단위 테스트(콘/사거리·락온2초·발사2발·유도선회·명중50·플레어회피·수명/지형·결정론) | 콜로케이트(`gun.test.js`와 동일 위치) |
| `src/main.js` | **추후 결선(M7/M8 통합)** — 양 플레이어 launcher·미사일 풀 보유, `input.missile`→`tryLock`, `flares`(M7) 전달, `hits`→combat 전달, `lockTimer/locked`→HUD | 본 설계의 직접 산출물 아님 |

> 순수 모듈 규약: `import * as THREE` 금지. 방향 벡터는 `flight.js`의 `forwardOf`를 재사용(이미 순수). 위치/속도는 plain `{x,y,z}`/`vx,vy,vz`로 다룬다(gun.js 관례 일치).

---

## 3. 상수 (seed 수치 — 출발점, 튜닝 가능)

```js
import { forwardOf } from '../flight.js';   // 락 콘 정면 기준·미사일 유도 방향 재사용

// 보유/락온 (seed: 2발, 락온 2초, 콘 ~15°, 사거리 150~1200m, 명중 -50)
export const MISSILE_AMMO   = 2;             // 플레이어당 보유 미사일 수
export const LOCK_TIME       = 2;            // 락온 누적 소요(초)
export const LOCK_CONE       = 0.262;        // 락 콘 반각(rad) ≈ 15° (Math.PI/180*15)
export const MIN_RANGE       = 150;          // 최소 사거리(m) — 이보다 가까우면 락/발사 불가
export const MAX_RANGE       = 1200;         // 최대 사거리(m) — 이보다 멀면 락/발사 불가
export const MISSILE_DAMAGE  = 50;           // 1발 명중당 데미지

// 미사일 비행 (seed: 기체보다 빠름, 선회율 제한, 수명 ~8초)
export const MISSILE_SPEED   = 250;          // 미사일 속도(m/s) — 기체(~120~180)보다 빠름
export const MAX_TURN_RATE   = 2.2;          // 유도 최대 선회율(rad/s) — 즉시 못 꺾음(회피 여지)
export const MISSILE_LIFE    = 8.0;          // 수명(초) → 사거리 ≈ 250*8 = 2000m(추적 여유)
export const MISSILE_RANGE   = MISSILE_SPEED * MISSILE_LIFE; // 파생 참고값

// 명중 판정
export const HIT_RADIUS      = 18;           // 기체 명중 반경(m) — gun(12)보다 관대(미사일 폭발 반경 근사)

// 발사 위치(기수 앞)
export const MUZZLE_OFFSET   = 10;           // 발사점 = shooter.pos + forward * MUZZLE_OFFSET

// 플레어 디코이 (M7 flares 소비 — 결정론적 규칙)
export const FLARE_DECOY_RADIUS = 80;        // 미사일이 이 반경 내 플레어에 끌리는 거리(m). flare.radius와 max로 결합 가능
```

> 수치 근거: `LOCK_CONE`을 **반각(half-angle)**으로 정의(콘 중심선=`forward`로부터의 허용 각도) → seed "락 콘 ~15°"를 정면 기준 ±15°로 해석. `MISSILE_SPEED=250`은 기체 상한(180)보다 빨라 추격 성립, `MAX_TURN_RATE`로 즉시 명중 대신 "꺾어 따라붙음"을 만들어 회피 플레이를 보장. `MISSILE_LIFE`(=사거리)는 `MAX_RANGE`(발사 가능 거리)보다 길게 잡아 발사 후 추적 여유를 둠(둘은 의미가 다름: MAX_RANGE=발사 허용, MISSILE_LIFE=발사 후 소멸 시점). `HIT_RADIUS=18`은 미사일 근접신관/폭발 반경 근사. **확률·난수는 쓰지 않는다**(§5.4 디코이는 기하 조건으로 결정론 유지).

---

## 4. 상태/미사일 구조

### 4.1 런처 상태 — `createMissileLauncher()`
```js
export function createMissileLauncher() {
  return {
    ammo: MISSILE_AMMO,   // 남은 미사일 수(시작 2)
    lockTarget: null,     // 현재 락온 진행/완료 대상 owner index(없으면 null). 보통 상대 owner
    lockTimer: 0,         // 락온 누적 시간(초). LOCK_TIME 도달 시 완료
    locked: false,        // 락 완료 여부(발사 가능)
  };
}
```
- 플레이어마다 1개 생성(`launcher1 = createMissileLauncher()`, `launcher2 = ...`).
- ONTOLOGY 정합: `plane.lockState`('none'|'locking'|'locked')는 HUD에서 `lockTimer===0 && !locked → 'none'`, `0<lockTimer<LOCK_TIME → 'locking'`, `locked → 'locked'`로 파생(런처 상태가 SSoT, lockState는 표시용 파생값).
- `missilesInFlight`는 런처가 직접 보유하지 않는다 — **미사일 풀은 main이 공용 배열로 보관**하고 `stepMissiles`로 일괄 처리(gun의 bullets 풀 관례 일치). 런처는 발사 카운트(`ammo`)와 락온만 책임.

### 4.2 미사일(missile) 구조 — `stepLock`이 발사 시 생성
```js
{
  x, y, z,          // 위치 {x,y,z} (개별 number 평탄 보관 — flight/gun 관례)
  vx, vy, vz,       // 속도 벡터(크기 = MISSILE_SPEED, 방향은 유도로 매 스텝 회전)
  target,           // 추적 대상 owner index(0/1). 디코이되면 flare 위치로 일시 대체(§5.4)
  life,             // 남은 수명(초). 0 이하 → 자폭/소멸
  owner,            // 발사 플레이어 index(0/1) — 자기 자신 명중 제외용
  decoyed,          // 플레어로 유인됐는지(ONTOLOGY missile.decoyed). 디코이 후 true
}
```
- ONTOLOGY(`missile.position/velocity/target/life/decoyed`)와 정합. 발사 시 `target`은 락온 대상(상대 owner), `decoyed=false`.

---

## 5. API 시그니처와 동작

### 5.1 `canLock(shooter, target) → bool` — 락 가능 판정(순수)

정면 콘 + 사거리 조건을 동시에 만족하는지 검사. `stepLock`이 매 스텝 호출하고, 테스트에서도 단독 검증.

```js
export function canLock(shooter, target) {
  if (!target || target.alive === false) return false;
  const dx = target.x - shooter.x, dy = target.y - shooter.y, dz = target.z - shooter.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  // (a) 사거리: [MIN_RANGE, MAX_RANGE] (제곱 비교로 sqrt 회피)
  if (d2 < MIN_RANGE * MIN_RANGE || d2 > MAX_RANGE * MAX_RANGE) return false;
  // (b) 콘: forward 와 (target-shooter) 사이 각도 ≤ LOCK_CONE
  const f = forwardOf(shooter);                  // 단위벡터(yaw/pitch만, 롤 무관)
  const len = Math.sqrt(d2) || 1;
  const cos = (f.x * dx + f.y * dy + f.z * dz) / len;  // f는 단위라 분모는 |to|뿐
  return cos >= Math.cos(LOCK_CONE);             // 각도 ≤ LOCK_CONE ⇔ cos ≥ cos(LOCK_CONE)
}
```
설계 포인트:
- **콘 기준선은 `forwardOf(shooter)`** — 기수 정면. 롤은 무관(`forwardOf`가 yaw/pitch만 반영). seed "정면 락 콘".
- **각도 비교는 cos로**: `cos ≥ cos(LOCK_CONE)`이면 각도 ≤ `LOCK_CONE`. `acos` 호출 불필요(빠르고 안정).
- **사거리는 제곱 비교**: `MIN_RANGE²≤d²≤MAX_RANGE²`. 너무 가까우면(<150m) 락 불가(seed 최소사거리).
- 순수·결정론: 같은 `(shooter, target)` → 같은 bool.

### 5.2 `stepLock(launcher, ctx, dt) → { launcher, fired }` — 락온 상태기계 1스텝

```js
// ctx = { tryLock: bool(미사일 키 엣지), shooter: {x,y,z,yaw,pitch,roll, owner}, target: {x,y,z, owner, alive} }
export function stepLock(launcher, ctx, dt) {
  const next = { ...launcher };
  let fired = null;

  const inEnvelope = canLock(ctx.shooter, ctx.target);   // 콘+사거리 충족?

  if (!inEnvelope) {
    // (a) 콘/사거리 이탈 → 락 리셋(누적 무효). seed "벗어나면 락 리셋"
    next.lockTimer = 0;
    next.locked = false;
    next.lockTarget = null;
    return { launcher: next, fired: null };
  }

  // (b) 엔벨로프 내 — 락온 진행
  next.lockTarget = ctx.target.owner;
  if (!next.locked) {
    next.lockTimer += dt;                                // 콘/사거리 유지되는 동안 누적
    if (next.lockTimer >= LOCK_TIME) {
      next.lockTimer = LOCK_TIME;                        // 상한 고정(표시 안정)
      next.locked = true;                               // 2초 도달 → 락 완료
    }
  }

  // (c) 발사 트리거 — 권고: "락 완료 + 미사일 키 다시 누름(수동 발사)"
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
```

**발사 트리거 — 채택안(명시): 수동 발사(MANUAL).**
- 흐름: 콘/사거리 충족 상태에서 미사일 키를 처음 누르거나 계속 조준 → `lockTimer` 누적 → 2초 후 `locked=true` → **락 완료 후 미사일 키를 다시 누르면(엣지) 발사**.
- 근거(권고안 중 택일): seed가 두 안(수동 발사 / 락 완료 자동발사)을 제시했고 본 설계는 **수동 발사**를 채택한다. 이유 — (1) input.js의 `missile`이 이미 **엣지(1회)** 신호라 "락온 시작"과 "발사" 두 동작을 같은 키의 두 번 누름으로 자연 매핑할 수 있다. (2) 락 완료 직후 자동발사는 의도치 않은 발사(2발 한정 자원 낭비)를 유발. (3) 플레이어가 발사 타이밍을 통제 → 도그파이트 감각 향상.
- **엣지 소비 주의**: `ctx.tryLock`은 input.js `pending.missile`(1프레임 엣지). 같은 누름이 "락온 시작 트리거"와 "발사 트리거"로 이중 소비되지 않도록, 락 진행은 **엔벨로프 충족만으로 자동 누적**(키 누름 불필요)하고 `tryLock`은 **발사에만** 사용한다. 즉 콘/사거리에 들어오면 키 없이도 락온이 진행되고(HUD가 'locking' 표시), 락 완료 후 키 엣지로 발사. (대안: 첫 키로 락 시작을 명시적으로 요구하려면 `armed` 플래그 추가 — 본 설계는 단순화 위해 자동 락 진행 채택. §9 열린 결정.)

> **대안안(AUTO, 미채택)**: `(c)`를 `if (next.locked && next.ammo > 0)`로 바꾸면 락 완료 즉시 자동발사. 채택하지 않음. 구현 시 한 줄로 전환 가능하나 일관성을 위해 MANUAL로 고정한다.

#### 5.2.1 발사 위치/방향 — `spawnMissile(shooter, targetOwner)`
```js
function spawnMissile(shooter, targetOwner) {
  const f = forwardOf(shooter);   // 기수 방향으로 사출(이후 유도로 꺾임)
  return {
    x: shooter.x + f.x * MUZZLE_OFFSET,
    y: shooter.y + f.y * MUZZLE_OFFSET,
    z: shooter.z + f.z * MUZZLE_OFFSET,
    vx: f.x * MISSILE_SPEED,        // 초기 속도 = forward * 미사일속(이후 매 스텝 목표로 회전)
    vy: f.y * MISSILE_SPEED,
    vz: f.z * MISSILE_SPEED,
    target: targetOwner,
    life: MISSILE_LIFE,
    owner: shooter.owner,
    decoyed: false,
  };
}
```
- gun의 `spawnBullet`과 동형. 차이: 초기 forward로 나가되 이후 유도로 방향이 바뀜(탄은 직진).

### 5.3 `stepMissiles(missiles, dt, targets, flares, terrain?) → { missiles, hits }`

미사일 배열 전체를 1스텝: **목표 결정(디코이 포함) → 선회율 제한 유도 회전 → 이동 → 수명 소멸 → 지형 소멸 → 명중 판정**.

```js
// targets = [{ owner, x, y, z, alive }] — 명중 후보 기체(보통 양 플레이어)
// flares  = [{ x, y, z, radius, life }] — M7이 전개한 활성 플레이어(디코이 소비, 비변형)
// terrain = (x,y,z)=>bool 또는 { collision } (선택). 없으면 지형 무시.
export function stepMissiles(missiles, dt, targets, flares, terrain) {
  const alive = [];
  const hits = [];

  for (const m of missiles) {
    // (a) 추적 목표 위치 결정 — 디코이 우선
    const aim = aimPoint(m, targets, flares);   // §5.4 → { x,y,z } 또는 null
    let { vx, vy, vz, decoyed } = m;

    if (aim) {
      // (b) 선회율 제한 유도: 현재 속도방향을 목표방향으로 MAX_TURN_RATE*dt 만큼만 회전
      const steered = turnToward({ x: vx, y: vy, z: vz },
                                 { x: aim.x - m.x, y: aim.y - m.y, z: aim.z - m.z },
                                 MAX_TURN_RATE * dt);
      vx = steered.x * MISSILE_SPEED;           // 속력은 일정(MISSILE_SPEED), 방향만 갱신
      vy = steered.y * MISSILE_SPEED;
      vz = steered.z * MISSILE_SPEED;
    }

    // (c) 이동 + 수명 차감
    const nx = m.x + vx * dt, ny = m.y + vy * dt, nz = m.z + vz * dt;
    const life = m.life - dt;
    if (life <= 0) continue;                    // (d) 수명 → 자폭/소멸
    if (terrain && terrainHit(terrain, nx, ny, nz)) continue;  // (e) 지형/수면 충돌 소멸

    // (f) 명중 판정: 자기 제외, 생존 기체, HIT_RADIUS 이내 (디코이된 미사일은 기체에 안 맞음 — §5.4)
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
      continue;                                 // 명중 미사일 소멸
    }

    // (g) 생존 → 갱신 미사일(불변: 새 객체)
    alive.push({ x: nx, y: ny, z: nz, vx, vy, vz, target: m.target, life, owner: m.owner, decoyed });
  }

  return { missiles: alive, hits };
}
```
설계 포인트:
- **선회율 제한이 핵심**(seed "선회율 제한 내 유도 추적"): `turnToward`가 현재 속도방향을 목표방향으로 **`MAX_TURN_RATE*dt` rad 이하**만 회전 → 미사일이 즉시 못 꺾어 회피 여지 생김. 두 방향각이 `MAX_TURN_RATE*dt`보다 크면 그만큼만 회전(slerp 1스텝, §5.5).
- **속력 일정**: 방향만 유도로 바꾸고 크기는 항상 `MISSILE_SPEED`. 추격 성립(기체보다 빠름).
- **소멸 우선순위**: 수명 → 지형 → 명중. gun.stepBullets와 동일 패턴.
- **데미지는 값만(50)**: HP 차감은 combat(§6).
- **불변**: 원본 배열·미사일 객체 비변형, 새 배열/새 객체 반환.

### 5.4 플레어 디코이 회피 규칙 (결정론) — `aimPoint(m, targets, flares)`

seed "플레어로 회피". **난수 없이 기하 조건으로 결정**한다.

```js
function aimPoint(m, targets, flares) {
  // (1) 이미 디코이됐으면 계속 그 위치(현 추적점)로 — 기체 추적 복귀 없음(빗나가게)
  //     decoyed 미사일은 가까운 활성 flare 중심을 쫓다가 지나쳐 수명/지형으로 소멸.
  if (m.decoyed) {
    const f = nearestFlare(m, flares);
    return f ? { x: f.x, y: f.y, z: f.z } : null;  // flare 만료되면 null → 직진 후 소멸
  }

  // (2) 추적 대상 기체 위치
  const tgt = targets.find((t) => t.owner === m.target && t.alive !== false);
  const aim = tgt ? { x: tgt.x, y: tgt.y, z: tgt.z } : null;

  // (3) 디코이 트리거: "추적 대상 근처에 전개된 flare가 미사일과 가까우면 미사일이 flare로 끌림"
  //     조건(결정론): 활성 flare 중 미사일과의 거리 ≤ (FLARE_DECOY_RADIUS, flare.radius 중 큰 값)인 것이 있으면 디코이.
  const decoy = flares.find((fl) =>
    fl.life > 0 &&
    dist2(m.x, m.y, m.z, fl.x, fl.y, fl.z) <= Math.max(FLARE_DECOY_RADIUS, fl.radius || 0) ** 2
  );
  if (decoy) {
    // 호출부에서 이 분기를 감지해 decoyed=true로 마킹해야 한다(아래 주: stepMissiles가 처리).
    return { x: decoy.x, y: decoy.y, z: decoy.z, _decoy: true };
  }
  return aim;
}
```
> 구현 주의: 위 `aimPoint`가 `_decoy:true`를 반환하면 `stepMissiles`가 해당 미사일을 `decoyed=true`로 전환하고 이후 그 미사일은 **기체 명중 판정에서 제외**(§5.3 (f)의 `if(!decoyed)`)된다. 즉 디코이된 미사일은 flare를 쫓다가 명중 없이 수명/지형으로 소멸 → "플레어로 회피" 성립. (단순화를 위해 `aimPoint`가 마킹 신호를 함께 돌려주는 구조; 구현 시 별도 반환 또는 stepMissiles 내 인라인 판정 중 택일 — 동작 동일.)

디코이 규칙 요약(결정론):
- **트리거**: 미사일이 활성 flare(`life>0`)와 `max(FLARE_DECOY_RADIUS, flare.radius)` 이내로 접근하면 디코이.
- **결과**: `decoyed=true` → 추적 대상이 flare로 바뀌고 **기체 명중 불가**. flare를 쫓다 지나쳐 수명/지형으로 소멸(또는 flare 만료 시 직진 후 수명 소멸).
- **확률 없음**: 거리(기하) 단일 조건 → 같은 입력 같은 결과. (튜닝 여지: "콘 안 + 일정 거리" 등 추가 조건 가능하나 난수는 도입하지 않음 — §9.)
- M7 연동: `flares` 항목은 `{x,y,z,radius,life}`. missile은 읽기만(life 차감·생성은 flare.js).

### 5.5 보조 함수
```js
function dist2(ax, ay, az, bx, by, bz) {        // 거리²(sqrt 회피)
  const dx = ax - bx, dy = ay - by, dz = az - bz;
  return dx * dx + dy * dy + dz * dz;
}
function normalize(v) {                          // 단위벡터(0벡터는 그대로)
  const L = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / L, y: v.y / L, z: v.z / L };
}
// from 방향을 to 방향으로 최대 maxAngle(rad)만큼 회전한 단위벡터 반환(1스텝 slerp 근사).
//  - 두 단위벡터 사이 각 θ ≤ maxAngle 이면 to 방향 그대로(도달).
//  - θ > maxAngle 이면 from에서 to 쪽으로 maxAngle 만큼만 회전(선회율 제한).
function turnToward(from, to, maxAngle) {
  const a = normalize(from), b = normalize(to);
  let cos = a.x * b.x + a.y * b.y + a.z * b.z;
  cos = cos < -1 ? -1 : cos > 1 ? 1 : cos;
  const theta = Math.acos(cos);
  if (theta <= maxAngle || theta === 0) return b;       // 이미 maxAngle 내 → 목표 정렬
  const t = maxAngle / theta;                           // 보간 비율(0~1)
  // slerp: (sin((1-t)θ)·a + sin(tθ)·b) / sinθ
  const s = Math.sin(theta) || 1;
  const w1 = Math.sin((1 - t) * theta) / s;
  const w2 = Math.sin(t * theta) / s;
  return normalize({ x: w1 * a.x + w2 * b.x, y: w1 * a.y + w2 * b.y, z: w1 * a.z + w2 * b.z });
}
function nearestFlare(m, flares) {              // 미사일에 가장 가까운 활성 flare
  let best = null, bd = Infinity;
  for (const fl of flares) {
    if (fl.life <= 0) continue;
    const d = dist2(m.x, m.y, m.z, fl.x, fl.y, fl.z);
    if (d < bd) { bd = d; best = fl; }
  }
  return best;
}
function terrainHit(terrain, x, y, z) {          // gun.js와 동일 — terrain 인자 유연 수용
  if (typeof terrain === 'function') return terrain(x, y, z);
  if (terrain && typeof terrain.collision === 'function') return terrain.collision(x, y, z);
  return false;
}
```
- **`turnToward`(slerp 1스텝)**가 선회율 제한의 핵심. 평행/역평행(θ=0 또는 π) 안전 처리(`s||1`, θ===0 조기 반환). 역평행(180°)은 드물지만 maxAngle만큼 회전해 점차 돌아 들어옴.

---

## 6. 책임 경계

| 책임 | 담당 |
|---|---|
| 락 가능 판정(콘 ±15° + 사거리 150~1200m) | **missile (M6)** — `canLock` |
| 락온 2초 누적·완료·이탈 리셋 | **missile (M6)** — `stepLock` |
| 발사 트리거(락 완료 + 키 엣지, 수동), `ammo` 2발 차감 | **missile (M6)** |
| 발사 위치·방향, 초기 속도 부여 | **missile (M6)** — `spawnMissile` |
| 유도 비행(선회율 제한), 이동 적분, 수명/사거리 소멸 | **missile (M6)** — `stepMissiles` |
| 명중 판정(반경 내), 지형 충돌 소멸, **데미지 값(=50) 산출** | **missile (M6)** |
| 플레어 디코이 **회피 판정**(flares 소비, 기하 결정론) | **missile (M6)** |
| 플레어 **생성·수명·잔량·쿨다운·전개 위치** | **flare (M7)** |
| `hits` 받아 **HP 차감**(`hp -= 50`), 0 이하 사망/승패 | **combat (M8)** |
| 지형/수면 충돌 **즉사**(기체) | combat (M8) + terrain 질의(M3) |
| 미사일·락 콘·락온 표시 메시, 발사음·락온경고음 | render/audio |
| 미사일 잔량·락온 상태 HUD | HUD (M9) |
| `input.missile`(엣지 bool) → `ctx.tryLock` 전달, `flares` 목록 공급 | input(M2) + flare(M7) + main 결선 |

핵심: **missile은 락온·발사·유도·명중을 "판정"하고 데미지 "값(50)"·디코이 "회피"를 산출할 뿐, HP를 직접 건드리지 않고 플레어를 생성/소모하지 않는다.** combat이 단일 지점에서 데미지를 적용(gun -1 / missile -50)하고, flare(M7)가 플레어 자원을 관리한다.

---

## 7. 단위 테스트 가이드 (`src/weapons/missile.test.js`)

### canLock — 콘/사거리
- **콘 안 + 적정거리**: 정면(forward) 방향 600m 앞 타깃 → `canLock===true`.
- **콘 밖**: 같은 거리지만 측면(forward와 90°) 타깃 → `false`. 콘 경계(±15° 직전/직후) → true/false 경계 검증.
- **근거리(<MIN_RANGE)**: 정면 100m 타깃 → `false`(최소사거리 미달).
- **원거리(>MAX_RANGE)**: 정면 1500m 타깃 → `false`(최대사거리 초과).
- **죽은 타깃**(`alive:false`)·`null` → `false`.
- yaw/pitch 변경 시 콘 기준선이 `forwardOf`와 일치(롤만 바꾸면 판정 불변).

### stepLock — 락온 2초 누적/중단/완료/발사
- **누적**: 엔벨로프 내에서 dt 반복 호출 → `lockTimer` 단조 증가, 총 2초 도달 시 `locked===true`(±dt).
- **중단 리셋**: 락 진행 중(예 lockTimer≈1s) 타깃이 콘/사거리 이탈하게 만든 ctx로 호출 → `lockTimer===0`, `locked===false`, `lockTarget===null`.
- **완료 상한**: 2초 초과해도 `lockTimer===LOCK_TIME`, `locked` 유지.
- **발사(수동)**: `locked===true` 상태에서 `tryLock:true` → `fired!==null`(미사일 생성), `ammo` 1 감소, 발사 후 `locked===false`·`lockTimer===0`(재락온 필요).
- **락 전 키 무시**: `locked===false`에서 `tryLock:true` → `fired===null`, `ammo` 불변(락온만 진행).
- **2발 제한**: 두 번 재락온+발사로 `ammo===0`, 세 번째는 `fired===null`(탄 없음).

### stepMissiles — 유도(선회율 제한)·명중·소멸
- **선회율 제한(즉시 못 꺾음)**: 미사일이 +z로 날고 타깃이 정반대/측면 → 1스텝 속도방향 변화각 ≤ `MAX_TURN_RATE*dt`(즉시 정렬 안 됨). 여러 스텝 후 점점 목표 방향으로 수렴(각도 단조 감소).
- **점점 목표로**: 측면 타깃 추적 시 N스텝 뒤 미사일→타깃 방향과 속도방향의 각이 0에 수렴.
- **명중 데미지 50**: 타깃을 미사일 진행선상 `HIT_RADIUS` 이내에 두면 `hits.length===1`, `hits[0].damage===MISSILE_DAMAGE(50)`, `target` 일치, 미사일 소멸.
- **자기 제외/죽은 기체**: `owner===target.owner`·`alive:false`는 명중 후보 제외.
- **수명 소멸**: `life<dt` 미사일 → 소멸(`missiles.length===0`, `hits` 없음).
- **지형 소멸**: `terrain` 항상 true 주입 → 한 스텝에 소멸. 미제공 시 지형 무시.

### 플레어 회피(디코이)
- **flare 근처면 빗나감**: 미사일과 타깃 사이/근처에 `life>0` flare를 `FLARE_DECOY_RADIUS` 이내로 두면 → 미사일 `decoyed===true`로 전환, 이후 기체 `hits` 발생 안 함(flare 쪽으로 유도되다 수명 소멸).
- **flare 멀면 무효**: flare가 반경 밖이면 디코이 안 됨 → 정상 명중.
- **life≤0 flare 무시**: 만료 flare는 디코이 트리거 안 됨.
- **결정론**: 같은 (missiles, flares) → decoyed 결과 동일(난수 없음).

### 결정론/불변
- 동일 `(launcher, ctx, dt)`로 두 번 `stepLock` → 깊은 동등(미사일 좌표·런처 상태 동일).
- 동일 `(missiles, dt, targets, flares)`로 두 번 `stepMissiles` → 동일 결과. 원본 배열/객체 비변형 확인(불변).
- `turnToward` 단위테스트: θ≤maxAngle → 목표 정렬, θ>maxAngle → 정확히 maxAngle만큼 회전(반환 단위벡터와 from 사이 각 ≈ maxAngle), 평행/역평행 안전.

---

## 8. 다른 마일스톤 영향

- **M2 input**: `readPlayer`가 이미 `missile`(엣지 1회 bool)을 제공(`input.js` line 96). main이 `ctx.tryLock = p1.missile`으로 전달. 같은 엣지가 발사에만 쓰이도록 락 진행은 엔벨로프 자동(§5.2).
- **M1 flight / planeMesh(M4)**: `forwardOf`를 락 콘 기준선·미사일 사출 방향에 재사용(중복 구현 금지). render는 `missiles` 배열로 미사일 메시를, `launcher.lockTimer/locked`로 락 콘·락온 표시를 그린다(M4 패밀리 또는 통합 단계).
- **M7 flare**: `stepMissiles(..., flares, ...)`로 `{x,y,z,radius,life}` 목록을 공급. missile은 읽기만. M7 완료 후 main이 두 모듈을 결선.
- **M8 combat**: `stepMissiles`의 `hits`(`damage:50`)를 받아 `target.hp -= 50`, HP≤0 사망/승패. gun·missile의 `hits` 형식을 통일(`{target, owner, damage, position}`)해 combat이 한 경로로 처리.
- **M9 HUD**: `launcher.ammo`(미사일 잔량), `launcher.lockTimer`/`locked`(락온 진행 바·LOCK 표시), ONTOLOGY `plane.lockState`('none'|'locking'|'locked') 파생.
- **M10 audio**: 락온 진행(`0<lockTimer<LOCK_TIME`)→락온경고음, `locked` 도달→락온완료음, `fired`→미사일발사음, `hits`/디코이 소멸→폭발음 트리거.

---

## 9. 열린 결정(구현 시 확정 — 명세 불변 범위)
- 상수 정확값(`MISSILE_SPEED`/`MAX_TURN_RATE`/`MISSILE_LIFE`/`HIT_RADIUS`/`LOCK_CONE`/`FLARE_DECOY_RADIUS`)은 플레이 감각으로 튜닝(상수 한 곳 §3).
- 발사 트리거: **수동 발사(MANUAL) 채택**(§5.2). AUTO 전환은 한 줄(미채택). 둘 중 하나로 일관 적용.
- 락 진행 방식: 엔벨로프 자동 누적(권고) vs 첫 키로 명시적 `armed` 시작 — 본 설계는 자동 누적(엣지 이중소비 회피).
- 디코이 규칙 강화 여부: 현재 "거리 단일 기하 조건". 필요 시 "미사일-flare가 미사일-타깃보다 가까울 때만" 등 추가 조건(여전히 난수 없이). 디코이된 미사일이 flare를 쫓다 재획득(re-lock)할지 여부 — 현재 **재획득 없음**(회피 성공 확정).
- 미사일에 발사 시점 기체 속도 가산 여부(현재 비가산; 초기 forward*MISSILE_SPEED만).
- 미사일 풀: 공용 단일 배열(권고, gun 일치) vs 플레이어별 분리.
