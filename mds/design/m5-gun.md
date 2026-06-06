# 설계 — M5 기관총 (src/weapons/gun.js 순수 로직)

> 상태: 설계 완료(구현 대기) · 작성: 2026-06-07
> 범위: **순수** `src/weapons/gun.js`(총기 상태기계 + 탄 발사·이동·수명/사거리·명중 판정, THREE 비의존, Vitest 대상)만. 데미지의 **실제 HP 적용**과 폭발/사망 처리는 M8 `combat.js`. 탄·머즐 플래시 메시와 발사음 결선은 렌더/사운드(M5 통합 또는 별도) 책임.
> SSoT: `mds/spec/seed.md`. 기관총 규칙: "키 홀드 시 연사(~12발/s), 탄창 100발, 소진 시 재장전 3초(재장전 중 발사 불가), 1발 명중당 체력 -1, 탄에 사거리/수명 제한". 좌표/경계는 M1 정합(+Y up, 수면 y=0, `forward=(0,0,-1)` at zero attitude).

---

## 1. 목표와 비범위

### 목표 (이번 M5에서 만든다 — 순수 로직)
- 플레이어별 **총기 상태**: `createGun()` → `{ ammo, reloading, reloadTimer, fireCooldown }`.
- **발사 스텝** `stepGun(gunState, ctx, dt)` → `{ gun(새 상태), bullets(이번 프레임 새로 생성된 탄 배열) }`.
  - 입력: `ctx.firing`(홀드 bool), `ctx.shooter`(`{x,y,z,yaw,pitch,roll, owner}` — 발사 위치/방향 산출), `dt`.
  - 연사 간격·탄창 차감·재장전 타이머·발사 쿨다운을 모두 한 함수에서 결정론적으로 관리.
- **탄 이동/명중/소멸 스텝** `stepBullets(bullets, dt, targets, terrain?)` → `{ bullets(생존 탄), hits:[{ target, owner, damage, position }] }`.
  - 위치 적분, 수명/사거리 차감 소멸, 상대 기체 명중 반경 판정, 지형 충돌 소멸.
- 위 둘을 한 프레임 흐름으로 묶는 편의 함수 `stepWeapon`(선택) — main 결선 단순화용.

### 비범위 (타 마일스톤)
- **HP 감소·사망·폭발**: M8 `combat.js`가 `hits`를 받아 `target.hp -= damage` 적용. gun은 **명중 판정 + 데미지 값**까지만 산출(책임 경계 §6).
- **탄 메시/머즐 플래시/트레이서·발사음**: 렌더(M4 패밀리)·사운드(M10). gun은 `{x,y,z}`/숫자/배열만 입출력.
- **탄약 HUD 표시**: M9. gun은 `ammo`/`reloading`/`reloadTimer` 상태만 노출.
- **미사일/플레어**: M6/M7 별도 모듈.
- 탄 vs 탄/탄 vs 미사일 상호작용 없음(기관총 탄은 기체·지형만 상대).

---

## 2. 파일 변경 요약

| 파일 | 변경 | 비고 |
|---|---|---|
| `src/weapons/gun.js` | **신규** — 상수 + `createGun`/`stepGun`/`stepBullets`(+`stepWeapon`) + 벡터 헬퍼 | THREE 비의존. Vitest 대상 |
| `src/weapons/gun.test.js` | **신규** — 순수 단위 테스트(연사/재장전/위치·방향/수명/명중/지형/결정론) | 콜로케이트(기존 테스트와 동일 위치) |
| `src/main.js` | **추후 결선(M5 통합 또는 M8)** — 양 플레이어 gun 상태·탄 풀 보유, `input.gun`→`firing`, `hits`→combat 전달 | 본 설계의 직접 산출물 아님 |

> 순수 모듈 규약: `import * as THREE` 금지. 방향 벡터는 `flight.js`의 `forwardOf`를 재사용(이미 순수)하고, 위치/속도는 plain `{x,y,z}`로 다룬다.

---

## 3. 상수 (seed 수치 — 출발점, 튜닝 가능)

```js
// 발사/탄창 (seed: ~12발/s, 100발, 3초 재장전, 명중 -1)
export const MAG_SIZE      = 100;            // 탄창 용량
export const RELOAD_TIME   = 3;              // 재장전 소요(초)
export const FIRE_RATE     = 12;             // 초당 발사 수(발/s)
export const FIRE_INTERVAL = 1 / FIRE_RATE;  // 발사 간격 ≈ 0.0833초
export const GUN_DAMAGE    = 1;              // 1발 명중당 데미지

// 탄 비행 (seed: 탄속 빠르게, 사거리/수명 제한)
export const BULLET_SPEED  = 600;            // 탄속(m/s) — 기체(~120~180)보다 훨씬 빠름
export const BULLET_LIFE   = 2.0;            // 수명(초) → 사거리 ≈ 600*2 = 1200m
export const BULLET_RANGE  = BULLET_SPEED * BULLET_LIFE; // 파생 사거리(참고/HUD)

// 명중 판정
export const HIT_RADIUS    = 12;             // 상대 기체 명중 반경(m) — 기체 크기 + 약간의 관대함

// 발사 위치(기수 앞)
export const MUZZLE_OFFSET = 8;              // 발사점 = shooter.pos + forward * MUZZLE_OFFSET (자기 탄 자기 충돌 회피)
```

> 수치 근거: `FIRE_INTERVAL`을 누적 쿨다운으로 관리하면 정확히 12발/s. `HIT_RADIUS=12`는 명중감을 위한 구 충돌 근사(레이캐스트 대신 거리 비교 — §5.2). `MUZZLE_OFFSET`로 탄이 발사 즉시 자기 기체 반경 안에서 자폭/오판되는 것을 막는다. 사거리는 `BULLET_LIFE`로 단일 관리(수명=사거리 제한 통합).

---

## 4. 상태/탄 구조

### 4.1 총기 상태 — `createGun()`
```js
export function createGun() {
  return {
    ammo: MAG_SIZE,      // 현재 탄창 잔량 (0~100)
    reloading: false,    // 재장전 중 여부
    reloadTimer: 0,      // 재장전 남은 시간(초). reloading일 때만 >0
    fireCooldown: 0,     // 다음 발사까지 남은 쿨다운(초). <=0 이면 발사 가능
  };
}
```
- 플레이어마다 1개 생성(`gun1 = createGun()`, `gun2 = createGun()`).
- `ammo`/`reloading`/`reloadTimer`는 그대로 HUD(M9)·combat 표시에 노출.

### 4.2 탄(bullet) 구조 — `stepGun`이 생성
```js
{
  x, y, z,          // 위치 {x,y,z} (개별 number로 평탄 보관 — flight 상태와 동일 관례)
  vx, vy, vz,       // 속도 벡터 = forward * BULLET_SPEED
  life,             // 남은 수명(초). 0 이하 → 소멸
  owner,            // 발사 플레이어 index(0/1) — 자기 자신 명중 제외용
}
```
- ONTOLOGY(`bullet.position/velocity/life/owner`)와 정합. `velocity`는 평탄 `vx,vy,vz`로 보관(곱셈·적분 단순).
- 탄 풀은 **플레이어 공용 단일 배열** 권장(`bullets = []`). 각 탄의 `owner`로 소속을 구분하므로 풀을 분리할 필요가 없고, `stepBullets`가 모든 탄을 한 번에 처리하며 `owner !== target.owner`인 기체만 명중 후보로 본다.

---

## 5. API 시그니처와 동작

### 5.1 `stepGun(gun, ctx, dt) → { gun, bullets }`

발사·탄창·재장전·쿨다운을 결정론적으로 1스텝 전진.

```js
// ctx = { firing: bool, shooter: { x,y,z, yaw,pitch,roll, owner } }
export function stepGun(gun, ctx, dt) {
  const next = { ...gun };
  const bullets = [];

  // (a) 타이머 감소 (dt 기반, 음수 방지)
  if (next.fireCooldown > 0) next.fireCooldown = Math.max(0, next.fireCooldown - dt);

  // (b) 재장전 진행
  if (next.reloading) {
    next.reloadTimer = Math.max(0, next.reloadTimer - dt);
    if (next.reloadTimer <= 0) {       // 재장전 완료
      next.reloading = false;
      next.ammo = MAG_SIZE;
    }
    return { gun: next, bullets };     // 재장전 중엔 발사 불가
  }

  // (c) 발사 가능 조건: 홀드 && 쿨다운 끝 && 탄 있음
  if (ctx.firing && next.fireCooldown <= 0 && next.ammo > 0) {
    bullets.push(spawnBullet(ctx.shooter));  // §5.1.1
    next.ammo -= 1;
    next.fireCooldown = FIRE_INTERVAL;

    // (d) 탄창 소진 → 즉시 재장전 시작
    if (next.ammo <= 0) {
      next.reloading = true;
      next.reloadTimer = RELOAD_TIME;
    }
  }

  return { gun: next, bullets };
}
```

설계 포인트:
- **연사 간격**: `fireCooldown`이 0 이하일 때만 발사하고, 발사 직후 `FIRE_INTERVAL`로 재충전 → 홀드해도 12발/s로 제한. 쿨다운이 dt보다 작게 남은 경우에도 한 프레임 1발만(현실적인 단순화; 고정 60fps에서 dt≈0.0167 < 0.083이라 5~6프레임마다 1발 발사되어 정확히 ~12발/s).
- **탄창 소진 → 재장전**: 마지막 1발을 쏘면(ammo가 0이 됨) 같은 스텝에서 `reloading=true`로 전환. 다음 스텝부터 발사 차단·타이머 감소.
- **재장전 중 발사 불가**: (b)에서 일찍 return하므로 firing이 true여도 탄 생성 없음.
- **불변 갱신**: 인자 `gun`은 변형하지 않고 `{...gun}` 새 객체 반환(flight/scoring 관례). 호출부는 `({ gun: gun1, bullets } = stepGun(gun1, ctx, dt))` 식으로 받는다.
- **결정론**: 난수·시간 미사용. 같은 `(gun, ctx, dt)` → 같은 결과.

#### 5.1.1 발사 위치/방향 — `spawnBullet(shooter)`
```js
function spawnBullet(shooter) {
  const f = forwardOf(shooter);   // flight.js 재사용: yaw/pitch만 기여하는 기수 방향(롤 무관)
  return {
    x: shooter.x + f.x * MUZZLE_OFFSET,   // 기수 앞쪽에서 발사
    y: shooter.y + f.y * MUZZLE_OFFSET,
    z: shooter.z + f.z * MUZZLE_OFFSET,
    vx: f.x * BULLET_SPEED,               // 속도 = forward * 탄속
    vy: f.y * BULLET_SPEED,
    vz: f.z * BULLET_SPEED,
    life: BULLET_LIFE,
    owner: shooter.owner,
  };
}
```
- `forwardOf`는 이미 순수(`flight.js` line 87). 롤은 기수 방향에 무영향이라 탄은 항상 yaw/pitch가 가리키는 정면으로 나간다(seed "비행기 전방").
- 탄은 발사 시점의 기체 속도를 더하지 않음(아케이드 단순화). 탄속이 기체보다 훨씬 빨라 체감 영향 작음. 필요 시 `shooter.speed`로 forward 성분만 가산하는 튜닝 여지.

### 5.2 `stepBullets(bullets, dt, targets, terrain?) → { bullets, hits }`

탄 배열 전체를 1스텝: 이동 → 수명/사거리 차감 → 지형 충돌 소멸 → 상대 명중 판정.

```js
// targets = [{ owner, x, y, z, alive }] — 명중 후보 기체(보통 양 플레이어)
// terrain = { collision: (x,y,z)=>bool } 또는 terrainCollision 함수(선택). 없으면 지형 무시.
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

    // (c) 지형/수면 충돌 → 소멸 (terrain 제공 시)
    if (terrain && terrainHit(terrain, nx, ny, nz)) continue;

    // (d) 명중 판정: 자기 자신 제외, 생존 기체, HIT_RADIUS 이내
    let hit = null;
    for (const t of targets) {
      if (t.owner === b.owner) continue;     // 자기 탄 자기 명중 제외
      if (t.alive === false) continue;       // 죽은 기체 무시
      if (dist2(nx, ny, nz, t.x, t.y, t.z) <= HIT_RADIUS * HIT_RADIUS) {
        hit = t; break;
      }
    }
    if (hit) {
      hits.push({ target: hit, owner: b.owner, damage: GUN_DAMAGE, position: { x: nx, y: ny, z: nz } });
      continue;                              // 명중한 탄은 소멸(생존 배열에 안 넣음)
    }

    // (e) 생존 → 갱신된 탄 보관(불변: 새 객체)
    alive.push({ x: nx, y: ny, z: nz, vx: b.vx, vy: b.vy, vz: b.vz, life, owner: b.owner });
  }

  return { bullets: alive, hits };
}
```

설계 포인트:
- **명중 판정(거리 구 충돌)**: 레이캐스트 대신 "이동 후 위치가 기체 중심 `HIT_RADIUS` 이내"로 근사(`dist2 ≤ r²`, sqrt 회피). 탄속 600·dt 0.0167 → 프레임당 ~10m 이동이 `HIT_RADIUS=12`보다 작아 터널링 위험 낮음. (정밀이 필요하면 후속에 선분-구 교차로 교체 — 본 설계는 거리 근사 채택.)
- **지형 충돌 소멸**: `terrain` 인자가 주어지면 이동 후 위치가 지형/수면이면 탄 제거(seed "탄에 사거리/수명 제한"의 확장 — 엄폐물 뒤 안전 보장). `terrain`은 `terrainCollision(x,y,z)`를 래핑해 넘긴다(margin 0 권장; 탄은 점). 미제공 시 지형 무시(단위 테스트에서 지형 없는 케이스 단순화).
- **소멸 우선순위**: 수명 → 지형 → 명중. 명중·지형·수명 중 하나라도 걸리면 `alive`에서 빠진다.
- **데미지는 값만**: `hits[i].damage`까지만 산출, HP 차감은 combat. `target`은 후보 객체 참조(combat이 누구인지 식별).
- **불변**: 원본 배열·탄 객체 변형 없이 새 배열/새 탄 반환.

#### 보조 함수
```js
function dist2(ax, ay, az, bx, by, bz) {        // 거리² (sqrt 회피)
  const dx = ax - bx, dy = ay - by, dz = az - bz;
  return dx * dx + dy * dy + dz * dz;
}
function terrainHit(terrain, x, y, z) {          // terrain 인자 유연 수용
  if (typeof terrain === 'function') return terrain(x, y, z);
  if (terrain && typeof terrain.collision === 'function') return terrain.collision(x, y, z);
  return false;
}
```

### 5.3 `stepWeapon(gun, bullets, ctx, dt, targets, terrain?)` — 편의 묶음(선택)
main 결선 단순화를 위해 `stepGun` + `stepBullets`를 한 번에:
```js
export function stepWeapon(gun, bullets, ctx, dt, targets, terrain) {
  const fired = stepGun(gun, ctx, dt);                         // 새 탄 생성
  const moved = stepBullets([...bullets, ...fired.bullets], dt, targets, terrain);
  return { gun: fired.gun, bullets: moved.bullets, hits: moved.hits };
}
```
- 새로 생성된 탄도 같은 프레임에 한 번 이동(`...fired.bullets` 합류)시켜 1프레임 지연을 없앤다. 채택 여부는 구현 시 결정(개별 함수만으로도 충분).

---

## 6. 책임 경계

| 책임 | 담당 |
|---|---|
| 발사 타이밍(연사 간격), 탄창 차감, 재장전 타이머/완료 | **gun (M5)** |
| 발사 위치·방향(`forward`·머즐 오프셋), 탄 속도 부여 | **gun (M5)** |
| 탄 이동 적분, 수명/사거리 소멸 | **gun (M5)** |
| 명중 판정(반경 내 hit), 지형 충돌 소멸, **데미지 값(=1) 산출** | **gun (M5)** |
| `hits` 받아 **HP 차감**(`hp -= damage`), 0 이하 사망 처리 | **combat (M8)** |
| 지형/수면 충돌 **즉사**(기체) | combat (M8) + terrain 질의(M3) |
| 탄 메시·트레이서·머즐 플래시 렌더, 발사음 | render/audio |
| 탄약/재장전 HUD 표시 | HUD (M9) |
| `input.gun`(홀드 bool) → `ctx.firing` 전달 | input (M2) + main 결선 |

핵심: **gun은 명중을 "판정"하고 데미지 "값"을 보고할 뿐, HP를 직접 건드리지 않는다.** combat이 단일 지점에서 양 무기(gun -1 / missile -50)의 데미지를 적용해 사망·승패를 일원 관리한다.

---

## 7. 단위 테스트 가이드 (`src/weapons/gun.test.js`)

### 발사·연사 간격
- `createGun()` 초기값: `ammo===MAG_SIZE`, `!reloading`, `fireCooldown===0`.
- 1회 `stepGun(gun, {firing:true, shooter}, dt)` → `bullets.length===1`, `ammo===99`, `fireCooldown≈FIRE_INTERVAL`.
- **쿨다운 동안 미발사**: 직후 작은 dt로 다시 호출(쿨다운 미소진) → `bullets.length===0`, `ammo` 불변.
- 충분한 dt(>FIRE_INTERVAL) 경과 후 → 다시 1발. 누적 시간 1초·작은 dt 반복 → 총 발사 수 ≈ 12(±1)로 12발/s 검증.
- `firing:false`면 쿨다운 0이어도 발사 없음.

### 탄창 소진 → 재장전 3초 → 재장전 후 발사
- `ammo`를 1로 세팅 후 발사 → `ammo===0`, `reloading===true`, `reloadTimer≈RELOAD_TIME`.
- 재장전 중 `firing:true` 호출 → 발사 없음(`bullets.length===0`), `reloadTimer` 감소.
- 누적 dt가 `RELOAD_TIME` 도달 → `reloading===false`, `ammo===MAG_SIZE`.
- 재장전 완료 직후 발사 → 정상적으로 1발(`ammo===99`).

### 발사 위치/방향
- yaw=pitch=roll=0 shooter → 생성 탄 속도 `vz≈-BULLET_SPEED`(forward=(0,0,-1)), `vx≈vy≈0`.
- 위치 = `shooter.pos + forward*MUZZLE_OFFSET` (예: z = shooter.z - MUZZLE_OFFSET).
- yaw=90° → 탄이 +x 또는 -x 방향(forwardOf 규약과 일치) — `forwardOf`와 동일 방향 단언.
- 롤만 변경해도 탄 방향 불변(롤은 기수에 무영향).

### 탄 이동·수명/사거리 소멸
- `stepBullets([bullet], dt, [])` → 위치가 `vel*dt`만큼 전진, `life` 감소.
- `life < dt`인 탄 → 소멸(`bullets.length===0`, `hits` 없음).
- 수명 동안 누적 이동 거리 ≈ `BULLET_RANGE`(사거리) 근사 검증.

### 명중 반경
- 타깃을 탄 진행선상 `HIT_RADIUS` 이내에 두고 step → `hits.length===1`, `hits[0].damage===GUN_DAMAGE(1)`, `target`이 그 기체, 해당 탄 소멸.
- 타깃을 `HIT_RADIUS`보다 멀리 → `hits` 없음, 탄 생존.
- **자기 자신 제외**: `owner===target.owner`인 기체는 명중 후보에서 제외(빗나감 처리).
- `alive:false` 기체는 명중 무시.

### 지형 충돌 소멸
- `terrain`을 "항상 true"로 주입 → 어떤 탄도 한 스텝에 소멸(`bullets.length===0`), `hits` 없음.
- `terrain` 미제공(undefined) → 지형 무시, 탄 정상 생존.
- 실제 `terrainCollision` 래퍼로 산 내부 좌표 탄 → 소멸, 빈 하늘 탄 → 생존(통합 성격, 선택).

### 결정론
- 동일 `(gun, ctx, dt)`로 두 번 `stepGun` → 깊은 동등(탄 좌표·gun 상태 동일).
- 동일 `(bullets, dt, targets)`로 두 번 `stepBullets` → 동일 결과. 원본 배열/객체 비변형 확인(불변).

---

## 8. 다른 마일스톤 영향

- **M2 input**: `readPlayer`가 이미 `gun`(홀드 bool)을 제공(`input.js` line 95). main이 `ctx.firing = p1.gun`으로 그대로 전달.
- **M1 flight / planeMesh**: `forwardOf`를 gun이 재사용(중복 구현 금지). 발사 위치는 `shooter`로 plane 상태를 넘기면 됨(`owner` 필드만 추가 부여).
- **M4 render**: 탄 메시(작은 구/라인 트레이서)·머즐 플래시는 렌더 레이어가 `bullets` 배열을 매 프레임 읽어 그린다. 발사/명중 결선(탄 풀 유지)은 **M5 통합 또는 M8 단계**에서 main에 추가.
- **M8 combat**: `stepBullets`의 `hits`를 받아 `target.hp -= hit.damage` 적용, HP≤0 사망/승패 판정. gun과 combat의 경계는 §6.
- **M9 HUD**: `gun.ammo`/`gun.reloading`/`gun.reloadTimer`로 탄약·재장전 게이지 표시.
- **M10 audio**: 새 탄 생성(`fired.bullets.length>0`)·`hits` 발생을 트리거로 발사음/피탄음.

---

## 9. 열린 결정(구현 시 확정 — 명세 불변 범위)
- `MUZZLE_OFFSET`/`HIT_RADIUS`/`BULLET_SPEED`/`BULLET_LIFE` 정확값은 플레이 감각으로 튜닝(상수 한 곳 §3).
- 탄에 기체 속도 가산 여부(현재 비가산 권고).
- 탄 풀: 공용 단일 배열(권고) vs 플레이어별 분리.
- 명중 판정 정밀화(거리 구 → 선분-구 교차) 도입 여부 — 터널링 관측 시.
- 지형 충돌 시 탄 소멸 적용 여부(권고: 적용 — 엄폐물 의미 부여). margin 0 사용.
