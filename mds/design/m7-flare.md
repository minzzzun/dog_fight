# 설계 — M7 플레어 (src/weapons/flare.js 순수 로직)

> 상태: 설계 완료(구현 대기) · 작성: 2026-06-07
> 범위: **순수** `src/weapons/flare.js`(플레이어별 디스펜서 상태 + 플레어 전개·수명·잔량·쿨다운 관리, THREE 비의존, Vitest 대상)만. **디코이 회피 판정(미사일이 빗나감)은 M6 `missile.js`의 `stepMissiles`가 이미 수행** — M7은 그 `stepMissiles`가 소비하는 **`flares` 목록을 생성·수명관리**하는 쪽이다. 플레어 메시·전개 이펙트·효과음은 렌더(M4 패밀리)·사운드(M10). 플레어 잔량 HUD는 M9.
> SSoT: `mds/spec/seed.md`. 플레어 규칙: "총 3발, 전개 시 일정 시간/반경 내의 유도미사일이 빗나가게(디코이) 함, 전개에 쿨다운 적용". 전투 수치 표(seed §전투 수치): 보유 3발 · 디코이 지속 ~3초 · 디코이 반경 일정 · 쿨다운 ~5초. 좌표/경계는 M1 정합(+Y up, 수면 y=0, `forward=(0,0,-1)` at zero attitude).

---

## 1. 목표와 비범위

### 목표 (이번 M7에서 만든다 — 순수 로직)
- 플레이어별 **디스펜서 상태**: `createFlareDispenser()` → `{ ammo, cooldown }`.
- **전개 스텝** `stepFlareDispenser(state, ctx, dt)` → `{ state(새 상태), flare(생성된 flare 또는 null) }`.
  - 입력: `ctx.deploy`(플레어 키 엣지 bool), `ctx.owner`(플레이어 index 0/1), `ctx.pos`(기체 위치 `{x,y,z}`), `ctx.vel?`(선택 — 전개 초기 속도 산출용), `dt`.
  - 조건(`cooldown<=0 && ammo>0 && deploy`) 충족 시 flare 1발 생성, `ammo--`, `cooldown=FLARE_COOLDOWN`. 매 스텝 `cooldown`을 `dt`만큼 감소.
- **플레어 수명 스텝** `stepFlares(flares, dt)` → 생존 `flares`(`life-=dt`, `life<=0` 제거, 선택적 위치 적분).
  - 이 결과 배열을 `missile.stepMissiles(missiles, dt, targets, flares, terrain?)`가 그대로 소비해 디코이 회피를 판정한다.

### 비범위 (타 마일스톤)
- **디코이 회피 판정**(미사일이 flare에 끌려 기체를 빗나감, `decoyed`, `FLARE_DECOY_RADIUS`): **M6 `missile.js`** 가 이미 수행(`stepMissiles`/`aimPoint`). M7은 flare를 **생성·수명관리**만 하고, missile이 그 목록을 **읽어** 판정한다. flare는 미사일을 건드리지 않는다.
- **HP 감소·사망·폭발·충돌**: M8 `combat.js`. 플레어는 HP와 무관(데미지 없음). flare는 지형/수면 충돌로 죽지 않는다(공중 디코이 — 수명으로만 소멸; §9 열린 결정).
- **플레어 메시·전개 이펙트(불꽃/연기)·전개음**: 렌더(M4 패밀리)·사운드(M10). flare는 `{x,y,z}`/숫자/배열/bool만 입출력.
- **플레어 잔량·쿨다운 HUD 표시**: M9. flare는 `ammo`/`cooldown` 상태만 노출.
- **키 입력**(플레어 엣지): M2 `input.js`가 이미 `flare`(엣지 1회 bool)를 제공. main이 `ctx.deploy = p1.flare`로 전달.

---

## 2. 파일 변경 요약

| 파일 | 변경 | 비고 |
|---|---|---|
| `src/weapons/flare.js` | **신규** — 상수 + `createFlareDispenser`/`stepFlareDispenser`/`stepFlares` | THREE 비의존. Vitest 대상 |
| `src/weapons/flare.test.js` | **신규** — 순수 단위 테스트(전개·3발 제한·쿨다운·수명 감소/만료·flare 형태·missile 디코이 통합·결정론/불변) | 콜로케이트(`gun.test.js`/`missile.test.js`와 동일 위치) |
| `src/main.js` | **추후 결선(M7 통합)** — 양 플레이어 `dispenser1/2` 보유, `input.flare`→`deploy`, 생성 flare를 공용 `flares` 배열에 합류, 매 프레임 `stepFlares` 후 `stepMissiles(..., flares, ...)`에 전달 | 본 설계의 직접 산출물 아님(현재 `flares = []` 빈 목록 line 97) |

> 순수 모듈 규약: `import * as THREE` 금지. 위치는 plain `{x,y,z}`로 다룬다(gun.js/missile.js 관례 일치). missile과 달리 flare는 `forwardOf`/방향 계산이 **필수는 아니다**(전개 위치는 기체 위치 그대로가 기본; 약간 뒤/아래로 떨구려면 §5.2.1 옵션). missile이 기대하는 flare 형태(`{x,y,z,life,radius}`)와 **정합 필수**.

---

## 3. 상수 (seed 수치 — 출발점, 튜닝 가능)

```js
// missile의 디코이 반경과 정합 — 단일 진실로 missile에서 import (중복 정의 금지)
import { FLARE_DECOY_RADIUS } from './missile.js';

// 보유/쿨다운 (seed: 3발, 쿨다운 ~5초, 디코이 지속 ~3초)
export const FLARE_AMMO     = 3;                 // 플레이어당 보유 플레어 수(시작 3)
export const FLARE_COOLDOWN = 5;                 // 전개 쿨다운(초) — 연속 전개 방지
export const FLARE_LIFE     = 3;                 // 디코이 유효 지속(초) — life<=0이면 디코이 무효(missile이 무시)

// 디코이 반경 — missile.FLARE_DECOY_RADIUS와 정합(missile이 max(FLARE_DECOY_RADIUS, flare.radius)로 결합)
export const FLARE_RADIUS   = FLARE_DECOY_RADIUS; // = 80(m). flare.radius로 각 flare에 부여 → missile이 디코이 트리거에 사용

// (선택) 전개 시 약간 뒤/아래로 떨어지는 초기 속도(시각/감각용) — 미사용 시 0 처리
export const FLARE_DROP_SPEED = 25;              // 전개 직후 낙하/후방 분리 속도(m/s). 0이면 고정 위치
```

> 수치 근거:
> - **`FLARE_AMMO=3`**: seed "총 3발".
> - **`FLARE_COOLDOWN=5`**: seed "쿨다운 ~5초". 잔량 3발이라도 한 번에 쏟아붓지 못하게(5초 간격) → 자원 운용 긴장감.
> - **`FLARE_LIFE=3`**: seed "디코이 지속 ~3초". 이 시간 동안만 `life>0`이라 missile이 디코이 대상으로 인식. 만료(`life<=0`)되면 `stepFlares`가 제거하고, 잔존 시점에도 missile이 `life>0`만 트리거하므로 자연히 무효(이중 안전).
> - **`FLARE_RADIUS=FLARE_DECOY_RADIUS(=80)`**: **반드시 missile에서 import**. missile의 `aimPoint`가 `dist2 <= max(FLARE_DECOY_RADIUS, flare.radius)²`로 트리거하므로(§missile §5.4), flare가 같은 값을 `radius`로 실어 보내면 의미가 일치한다. 별도 숫자를 하드코딩하면 두 모듈이 어긋날 수 있어 import로 단일화.
> - **`FLARE_DROP_SPEED`**: 시각적으로 "기체에서 분리돼 뒤/아래로 흩날리는" 느낌을 주기 위한 선택값. 디코이 판정엔 영향 없음(반경이 충분히 큼). **확률·난수는 쓰지 않는다**(결정론).

---

## 4. 상태/플레어 구조

### 4.1 디스펜서 상태 — `createFlareDispenser()`
```js
export function createFlareDispenser() {
  return {
    ammo: FLARE_AMMO,   // 남은 플레어 수(시작 3)
    cooldown: 0,        // 전개 쿨다운 잔여(초). 0 이하여야 전개 가능
  };
}
```
- 플레이어마다 1개 생성(`dispenser1 = createFlareDispenser()`, `dispenser2 = ...`). gun(`createGun`)·missile(`createMissileLauncher`)과 동형(플레이어별 무기 상태기계).
- 호출마다 독립된 새 객체(공유 참조 금지) — 한 플레이어의 잔량 변화가 다른 플레이어에 새지 않는다.
- `flaresInFlight`는 디스펜서가 직접 보유하지 않는다 — **flare 풀은 main이 공용 배열로 보관**(gun의 bullets·missile의 missiles 관례 일치)하고 `stepFlares`로 일괄 수명관리. 디스펜서는 발사 카운트(`ammo`)와 쿨다운만 책임.

### 4.2 플레어(flare) 구조 — `stepFlareDispenser`가 전개 시 생성
```js
{
  x, y, z,          // 위치 {x,y,z} (개별 number 평탄 보관 — flight/gun/missile 관례)
  life,             // 디코이 유효 잔여 시간(초). FLARE_LIFE에서 시작, 0 이하 → 제거. missile은 life>0만 디코이 트리거
  radius,           // 디코이 유효 반경(m) = FLARE_RADIUS. missile이 max(FLARE_DECOY_RADIUS, radius)로 결합
  owner,            // 전개 플레이어 index(0/1). HUD/이펙트/디버그용(디코이 판정엔 미사용 — 누구 미사일이든 빗나감)
  // (선택) vx, vy, vz — FLARE_DROP_SPEED 사용 시 초기 속도. 미사용이면 생략 또는 0
}
```
- **missile 정합 필수**: missile.js의 `stepMissiles`/`aimPoint`/`nearestFlare`가 읽는 필드는 `fl.x`, `fl.y`, `fl.z`, `fl.life`, `fl.radius`(optional). 위 구조가 이를 **모두 만족**한다. missile.test.js의 디코이 케이스가 사용하는 형태(`{ x, y, z, radius, life }`, line 407·417·430·439)와 동일.
- ONTOLOGY(`flare.position`/`flare.life`/`flare.radius`)와 정합. `owner`는 ONTOLOGY엔 없지만 HUD/이펙트 편의로 추가(missile이 무시하므로 정합 깨지 않음).

---

## 5. API 시그니처와 동작

### 5.1 `createFlareDispenser() → { ammo, cooldown }`
§4.1 참조. 가득 찬 잔량(3)·쿨다운 0(즉시 전개 가능).

### 5.2 `stepFlareDispenser(state, ctx, dt) → { state, flare }` — 전개·잔량·쿨다운 1스텝

```js
// ctx = { deploy: bool(플레어 키 엣지), owner: 0|1, pos: {x,y,z}, vel?: {x,y,z} }
export function stepFlareDispenser(state, ctx, dt) {
  const next = { ...state };
  let flare = null;

  // (a) 쿨다운 감소(매 스텝). 음수로 내려가도 무방(전개 가능 판정은 <=0)
  if (next.cooldown > 0) next.cooldown = Math.max(0, next.cooldown - dt);

  // (b) 전개 가능: 쿨다운 끝 && 잔량 있음 && 키 엣지
  if (ctx.deploy && next.cooldown <= 0 && next.ammo > 0) {
    flare = spawnFlare(ctx.owner, ctx.pos, ctx.vel);
    next.ammo -= 1;
    next.cooldown = FLARE_COOLDOWN;   // 쿨다운 재설정(연속 전개 방지)
  }

  return { state: next, flare };
}
```
설계 포인트:
- **전개 조건 3중**: `deploy`(키 엣지) AND `cooldown<=0` AND `ammo>0`. 하나라도 어긋나면 미전개·잔량/쿨다운 변동 없음(쿨다운 감소 (a)는 별개로 진행).
- **쿨다운 모델**: gun의 `fireCooldown`과 유사하되, flare는 carry 누적이 불필요(전개가 드물고 정확한 발사율을 맞출 필요 없음) → `Math.max(0, ...)`로 0 바닥 클램프해 단순화·표시 안정. seed "전개에 쿨다운 적용".
- **엣지 입력**: `ctx.deploy`는 input.js `pending.flare`(1프레임 엣지). 키를 누르고 있어도 1회만 전개되고, 다음 전개는 쿨다운(5초) 경과 + 새 엣지가 필요.
- **불변**: 인자 `state`를 변형하지 않고 `next`(새 객체) 반환. 같은 `(state, ctx, dt)` → 같은 결과(결정론).

#### 5.2.1 전개 위치/속도 — `spawnFlare(owner, pos, vel)`
```js
function spawnFlare(owner, pos, vel) {
  const flare = {
    x: pos.x, y: pos.y, z: pos.z,   // 기본: 기체 현재 위치에서 전개
    life: FLARE_LIFE,
    radius: FLARE_RADIUS,
    owner,
  };
  // (선택) 약간 뒤/아래로 분리되는 초기 속도: vel(기체 진행방향) 반대 + 하강
  if (FLARE_DROP_SPEED > 0 && vel) {
    const L = Math.hypot(vel.x, vel.y, vel.z) || 1;
    flare.vx = -vel.x / L * FLARE_DROP_SPEED;        // 진행 반대(뒤)로
    flare.vy = -vel.y / L * FLARE_DROP_SPEED - 9.8;  // 약간 아래로(중력 흉내, 시각용)
    flare.vz = -vel.z / L * FLARE_DROP_SPEED;
  }
  return flare;
}
```
- **기본은 기체 위치 그대로**(`pos`). missile 디코이 반경(80m)이 충분히 커서 정확한 사출점이 디코이 성패를 좌우하지 않는다 → 단순화.
- `vel` 미제공 또는 `FLARE_DROP_SPEED===0`이면 **고정 위치 flare**(vx/vy/vz 생략). 디코이 판정엔 영향 없음.
- main 결선 시 `ctx.vel`은 기체 속도로 `forwardOf(plane)·plane.speed` 또는 별도 속도벡터를 넘긴다(flight state엔 명시 속도벡터가 없어 `forwardOf*speed`로 산출 가능 — render 결선 시 택일). **순수 모듈 자체는 vel을 선택 인자로만 받는다.**

### 5.3 `stepFlares(flares, dt) → flares(생존)` — 수명관리 1스텝

```js
export function stepFlares(flares, dt) {
  const alive = [];
  for (const fl of flares) {
    const life = fl.life - dt;
    if (life <= 0) continue;                 // (a) 디코이 지속 만료 → 제거(missile이 더는 트리거 안 함)
    // (b) (선택) 위치 적분 — 초기 속도 있으면 천천히 낙하/이동
    const next = { ...fl, life };
    if (fl.vx !== undefined) {
      next.x = fl.x + fl.vx * dt;
      next.y = fl.y + fl.vy * dt;
      next.z = fl.z + fl.vz * dt;
    }
    alive.push(next);                        // (c) 생존 → 갱신 flare(불변: 새 객체)
  }
  return alive;
}
```
설계 포인트:
- **수명 차감·만료 제거**가 핵심. gun.stepBullets / missile.stepMissiles의 "이동→수명→소멸" 패턴 중 flare는 **수명만 필수**(명중·지형 판정 없음 — flare는 디코이용 표적일 뿐 충돌체가 아님).
- **반환 형태**: gun/missile은 `{ bullets, hits }` 등 객체를 반환하지만, flare는 부산물(hits)이 없으므로 **생존 배열만** 반환(단순·일관). main은 `flares = stepFlares(flares, dt)`로 교체.
- **선택적 위치 적분**: `vx`가 있으면(=`FLARE_DROP_SPEED` 사용) 천천히 낙하·후방 이동. 없으면 위치 고정. 어느 쪽이든 missile은 `{x,y,z,life,radius}`만 읽으므로 디코이 정합 유지.
- **불변·결정론**: 원본 배열·flare 객체 비변형, 새 배열/새 객체 반환. 같은 `(flares, dt)` → 같은 결과(난수 없음).
- **수면/지형 충돌로 죽이지 않음**(현재): flare는 공중 디코이라 수명으로만 소멸. 필요 시 terrain 인자 추가 가능(§9 열린 결정).

---

## 6. 책임 경계

| 책임 | 담당 |
|---|---|
| 플레어 전개 트리거(키 엣지 + 쿨다운 + 잔량) | **flare (M7)** — `stepFlareDispenser` |
| 잔량 3발 차감, 쿨다운 5초 재설정·감소 | **flare (M7)** |
| 전개 위치·(선택)초기 속도 부여 | **flare (M7)** — `spawnFlare` |
| 플레어 수명(3초) 차감·만료 제거·(선택)위치 적분 | **flare (M7)** — `stepFlares` |
| 디코이 **회피 판정**(미사일이 flare에 끌려 기체를 빗나감, `decoyed`) | **missile (M6)** — `stepMissiles`/`aimPoint`(flares 소비) |
| 디코이 반경 의미(`FLARE_DECOY_RADIUS`/`flare.radius` 결합) | **missile (M6)** 가 판정, flare는 `radius`만 정합되게 실어 보냄 |
| HP 차감·사망·폭발·충돌 즉사 | combat (M8) — 플레어는 HP 무관 |
| 플레어 메시·전개 이펙트·전개음 | render/audio (M4 패밀리·M10) |
| 플레어 잔량·쿨다운 HUD | HUD (M9) |
| `input.flare`(엣지 bool) → `ctx.deploy` 전달, 생성 flare를 공용 배열에 합류 | input(M2) + main 결선 |

핵심: **flare는 플레어를 "생성"하고 잔량·쿨다운·수명을 "관리"할 뿐, 미사일을 빗나가게 하는 "판정"은 하지 않는다.** 디코이 회피는 missile(M6)이 `flares` 목록을 읽어 단일 지점에서 판정한다(책임 분리: flare=자원/수명, missile=회피 효과, combat=HP). flare는 데미지가 없고 HP를 건드리지 않는다.

---

## 7. 단위 테스트 가이드 (`src/weapons/flare.test.js`)

### 상수 — seed 수치
- `FLARE_AMMO===3`, `FLARE_COOLDOWN===5`, `FLARE_LIFE===3`.
- `FLARE_RADIUS===FLARE_DECOY_RADIUS`(missile에서 import, ===80) — 디코이 정합의 핵심 검증.

### createFlareDispenser — 초기 상태
- `ammo===FLARE_AMMO(3)`, `cooldown===0`(즉시 전개 가능).
- 호출마다 독립된 새 객체(`a !== b`; `a.ammo=0` 해도 `b.ammo===3`).

### stepFlareDispenser — 전개·잔량·쿨다운
- **정상 전개**: `cooldown<=0` + `ammo>0` + `deploy:true` → `flare!==null`(생성), `ammo` 1 감소, `cooldown===FLARE_COOLDOWN`.
- **생성 flare 형태**: `flare`가 `{x,y,z}===ctx.pos`, `life===FLARE_LIFE`, `radius===FLARE_RADIUS`, `owner===ctx.owner`를 가진다(missile 정합).
- **쿨다운 중 미전개**: `cooldown>0` 상태에서 `deploy:true` → `flare===null`, `ammo` 불변. 쿨다운은 `dt`만큼 감소.
- **엣지 없으면 미전개**: `deploy:false` → 전개 없음(쿨다운만 감소).
- **잔량 0이면 미전개**: `ammo:0`에서 `deploy:true`·`cooldown<=0`이어도 `flare===null`.
- **3발 제한**: 쿨다운을 강제로 0으로 두고(또는 매 회 `FLARE_COOLDOWN` 경과시켜) 전개 3회 → 3개 생성·`ammo===0`, 4번째는 `flare===null`.
- **쿨다운 경과 후 재전개**: 전개 직후 `cooldown=5`; `dt`를 5초 이상 누적해 `cooldown<=0`이 된 뒤 새 엣지로 다시 전개 가능.
- **쿨다운 바닥 클램프**: 여러 스텝 dt 감소 후 `cooldown`이 음수로 안 내려가고 0에서 멈춘다.

### stepFlares — 수명 감소·만료 제거
- **수명 감소**: `life===FLARE_LIFE`인 flare → 1스텝 후 `life===FLARE_LIFE - dt`(생존, 위치는 고정 또는 적분).
- **만료 제거**: `life===dt`(또는 그 이하) flare → `stepFlares` 후 배열에서 제거(`length` 감소).
- **여러 flare 혼재**: 일부는 만료·일부는 생존 → 생존분만 반환, 개수 정확.
- **(선택) 위치 적분**: `vx`가 있는 flare → 1스텝 후 `x===x+vx*dt` 등. `vx` 없으면 위치 불변.
- **빈 배열**: `stepFlares([], dt)===[]`.

### missile 디코이와 호환 (통합 케이스 — 권장)
- **전개한 flare로 미사일이 빗나감**: `stepFlareDispenser`로 생성한 flare를 미사일 근처(<`FLARE_DECOY_RADIUS`)에 두고 `missile.stepMissiles([m], dt, [tgt], [flare])` 호출 → `hits.length===0`, 미사일 `decoyed===true`(평소라면 명중할 위치인데 빗나감). M7 산출물이 M6 디코이를 실제로 트리거함을 검증.
- **flare 형태 직접 정합**: 생성 flare가 `life>0`·`radius` 보유 → missile.test.js의 디코이 케이스 형태와 일치.
- **만료 flare는 디코이 무효**: `stepFlares`로 `life<=0`이 된 flare(제거되거나 잔존해도 `life<=0`)는 missile이 디코이로 트리거하지 않음(정상 명중) — 수명관리와 디코이 무효의 연결 검증.

### 결정론/불변
- 동일 `(state, ctx, dt)`로 두 번 `stepFlareDispenser` → 깊은 동등(`toEqual`). 인자 `state` 비변형(불변).
- 동일 `(flares, dt)`로 두 번 `stepFlares` → 동일 결과. 원본 배열·flare 객체 비변형 확인.

---

## 8. 다른 마일스톤 영향

- **M2 input**: `readPlayer`가 이미 `flare`(엣지 1회 bool)를 제공(`input.js` line 96·99). main이 `ctx.deploy = p1.flare`로 전달. 같은 엣지가 1회만 전개에 소비(쿨다운으로 연속 전개 차단).
- **M4 / 렌더**: 생성된 flare(`{x,y,z}`)로 플레어 메시·전개 이펙트(불꽃/연기 파티클)를 그린다. `bulletMesh.js`/`missileMesh.js`의 풀 동기화 패턴(`createFlarePool`/`syncFlares`)을 따른다(렌더 마일스톤 산출물). 시각은 디코이 판정과 무관.
- **M6 디코이 결선(핵심)**: main이 `flares` 공용 배열을 채운다.
  - 현재 `main.js` line 97 `const flares = []`(빈 목록, 디코이 미발생)을 **let**으로 바꾸고:
    1. `const d1 = stepFlareDispenser(dispenser1, { deploy: p1.flare, owner: 0, pos: plane1, vel: <opt> }, dt); dispenser1 = d1.state; if (d1.flare) flares.push(d1.flare);` (P2 동형).
    2. `flares = stepFlares(flares, dt);`
    3. 기존 `stepMissiles(missiles, dt, targets, flares, bulletTerrain)` 호출이 채워진 `flares`를 그대로 소비(이미 시그니처 일치 — 변경 불필요).
  - missile.js는 **수정 없음**(이미 `flares` 소비 구현 완료). M7은 그 입력만 공급.
- **M8 combat**: 영향 없음(플레어는 HP/사망과 무관). 단, 디코이로 미사일이 빗나가면 missile의 `hits`가 안 생겨 combat이 HP를 안 깎는다(간접 효과 — 회피 성공).
- **M9 HUD**: `dispenser.ammo`(플레어 잔량 3→2→1→0), `dispenser.cooldown`(쿨다운 게이지)을 표시. 현재 hud는 gun/launcher만 받으므로(`main.js` line 207~210) flare 잔량 인자 추가 필요(M9 확장).
- **M10 audio**: `flare`(전개 성공 = `stepFlareDispenser`가 flare 반환)→전개음(쉭/팝) 트리거. 쿨다운 중 시도(미전개)는 무음 또는 빈 클릭음(선택).

---

## 9. 열린 결정(구현 시 확정 — 명세 불변 범위)
- 상수 정확값(`FLARE_COOLDOWN`/`FLARE_LIFE`/`FLARE_DROP_SPEED`)은 플레이 감각으로 튜닝(상수 한 곳 §3). `FLARE_AMMO=3`은 seed 고정.
- `FLARE_RADIUS`: **missile.FLARE_DECOY_RADIUS import 채택**(§3) — 두 모듈 단일화. 별도 값을 주려면 flare가 더 큰 `radius`를 실어 missile의 `max(...)`로 확장 가능(난수 없음).
- 전개 위치: **기체 위치 그대로 채택**(§5.2.1). 약간 뒤/아래 분리(`FLARE_DROP_SPEED`)는 시각 옵션(디코이 무관). 사용 시 `stepFlares`가 위치 적분.
- `stepFlares` 반환: **생존 배열만**(부산물 없음). gun/missile의 `{...}` 객체 반환과 형태가 다르지만 flare는 hits가 없어 단순화. (일관성을 원하면 `{ flares }` 객체로 감쌀 수 있으나 본 설계는 배열 직접 반환.)
- 디코이된 미사일 재획득 여부·flare 충돌체 여부(지형/수면으로 flare 소멸)·flare 낙하 중력값 등은 현재 비도입(수명만으로 소멸). 필요 시 terrain 인자 추가(난수 없이) — §1 비범위.
- 쿨다운 carry: gun처럼 carry 누적 대신 **0 바닥 클램프**(전개가 드물어 정확 발사율 불필요).
