# 설계 — M8 전투 상태: 체력/충돌/승패 (src/combat.js 순수 로직)

> 상태: 설계 완료(구현 대기) · 작성: 2026-06-07
> 범위: **순수** `src/combat.js`(플레이어 체력/생존 + 무기 명중 데미지 적용 + 지형·수면 충돌 즉사 + 단판 승패 판정, THREE 비의존, Vitest 대상)만. **명중 "판정"과 데미지 "값"은 M5 gun(`stepBullets` hits, damage:1) / M6 missile(`stepMissiles` hits, damage:50)이 이미 산출** — M8은 그 `hits`를 "소비"해 실제 HP를 깎고 사망·승패를 결정한다. **지형/수면 충돌 "질의"는 M3 terrain(`terrainCollision`)이 제공** — M8은 각 기체에 대해 호출해 즉사 처리한다. 사망 후 입력/조종 정지·결과창·재대결은 main(렌더 루프)·M11. 폭발 이펙트·효과음은 렌더(M4 패밀리)·M10. 체력바 HUD는 M9.
> SSoT: `mds/spec/seed.md`. 전투 규칙: "각 기체 체력 100에서 시작, 0 이하가 되면 사망"·"기관총 1발 명중당 체력 -1"·"유도미사일 명중 시 체력 -50"·"지형(섬·산·다리) 또는 수면(y=0)에 충돌하면 폭발과 함께 즉사"·"한 명이 죽으면 승패 결과창 표시 → 재대결 버튼으로 단판 재시작". 좌표/경계는 M1 정합(+Y up, 수면 y=0).

---

## 1. 목표와 비범위

### 목표 (이번 M8에서 만든다 — 순수 로직)
- 플레이어별 **전투 상태**: `createPlayer()` → `{ hp:100, alive:true }`. 세션 묶음 `createCombat({p1,p2})` → `{ players:[p0,p1], state:'fighting', winner:null }`.
- **데미지 적용** `applyHits(combat, hits)` → gun·missile이 산출한 `hits`(각 `{ target, owner, damage, ... }`)로 피격 플레이어 `hp` 감소(0 바닥 클램프), `hp<=0`이면 `alive=false`. 새 combat(불변) 반환.
- **충돌 즉사** `checkTerrainCrash(combat, planes, terrainFn, margin)` → 각 생존 기체가 `terrainFn`(=terrain.terrainCollision) 충돌 시 `hp=0, alive=false`. 새 combat(불변) 반환.
- **승패 판정** `resolve(combat)` → 한 명이라도 `alive===false`면 `state='over'`, `winner=상대 index`(둘 다 죽으면 `winner='draw'`). 단판. 새 combat(불변) 반환.
- **통합 스텝(권장)** `stepCombat(combat, { hits, planes, terrainFn, margin })` → `applyHits → checkTerrainCrash → resolve`를 한 번에 수행한 새 combat. main이 한 줄로 쓰기 좋은 형태.

### 비범위 (타 마일스톤)
- **명중 판정·데미지 값**: M5 gun / M6 missile. combat은 `hits`를 **받아서 소비**만 한다(명중 거리·콘·자기명중 제외는 무기가 이미 처리 — `t.owner === owner` 제외, `t.alive===false` 무시까지 무기 내부에서 끝남).
- **지형/수면 충돌 "질의"**: M3 terrain(`terrainCollision(x,y,z,margin)`). combat은 이 함수를 **호출**해 즉사로 변환만 한다(높이 계산·맵 데이터는 terrain 소유).
- **사망 후 입력/조종 정지·무기/비행 step 스킵**: **main 책임**(combat은 권고만). `state==='over'`이면 main이 stepFlight/stepGun/stepMissiles 등을 건너뛴다(§6·§8).
- **결과창·재대결(단판 재시작)**: M11 + main. `winner`/`state`를 읽어 UI를 띄우고, 재대결 시 `createCombat`/`createPlane`을 새로 만든다.
- **체력바·사망 표시 HUD**: M9. combat은 `hp`/`alive` 상태만 노출.
- **폭발 이펙트·격추/충돌 효과음**: 렌더(M4 패밀리)·M10. combat은 `{hp,alive,state,winner}` 숫자/문자/불값만 입출력.

---

## 2. 파일 변경 요약

| 파일 | 변경 | 비고 |
|---|---|---|
| `src/combat.js` | **신규** — 상수 + `createPlayer`/`createCombat`/`applyHits`/`checkTerrainCrash`/`resolve`/`stepCombat` | THREE 비의존. Vitest 대상 |
| `src/combat.test.js` | **신규** — 순수 단위 테스트(데미지 -1/-50/0클램프/사망·다중hit누적·지형/수면 즉사·승패·draw·state 전이·죽은 뒤 hit 무영향·결정론/불변) | 콜로케이트(`gun.test.js`/`missile.test.js`/`flight.test.js`와 동일 위치) |
| `src/main.js` | **추후 결선(M8 통합)** — `combat = createCombat(...)` 보유, gun/missile의 `stepped.hits`+`steppedM.hits`를 합쳐 `applyHits`, planes로 `checkTerrainCrash`, `resolve`, `state==='over'`면 step 스킵 + 결과창 트리거 | 본 설계의 직접 산출물 아님(현재 line 200·237 hits **무시 중**) |

> 순수 모듈 규약: `import * as THREE` 금지. 위치/기체는 plain `{x,y,z}`로 다룬다(flight/gun/missile 관례 일치). combat은 `terrainCollision`을 **직접 import하지 않고** `terrainFn` 인자로 주입받는다(순수성·테스트 용이 — 가짜 함수로 충돌 시나리오를 결정론적으로 구성). main 결선 시에만 `terrain.terrainCollision`을 넘긴다.

---

## 3. 상수 (seed 수치 — 출발점, 일부 고정)

```js
// 체력 (seed: "각 기체 체력 100에서 시작, 0 이하가 되면 사망")
export const MAX_HP = 100;          // 시작 체력 — seed 고정

// 충돌 즉사 시 margin 기본값(terrain.CRASH_MARGIN과 정합).
//  combat은 terrain을 import하지 않으므로(순수), main이 호출 시 margin을 명시 전달하는 것을 권장.
//  미전달 시의 안전 기본값으로만 사용(terrain 기본 CRASH_MARGIN=3과 동일).
export const CRASH_MARGIN = 3;
```

> 수치 근거:
> - **`MAX_HP=100`**: seed "각 100". 기관총 -1(100발), 미사일 -50(2발). 미사일 2발(=100)로 풀피 격추 가능 — 한 발 빗나가면 기관총으로 마무리하는 도그파이트 밸런스.
> - **`CRASH_MARGIN=3`**: terrain.js의 `CRASH_MARGIN`(기체 반경 근사, line 47)과 같은 값. 다만 combat은 terrain을 import하지 않으므로(주입형) **단일 진실은 terrain 쪽**이고, main 결선 시 `terrain.CRASH_MARGIN`을 명시 전달하는 것을 권장(§6). 이 상수는 인자 미전달 시의 fallback일 뿐 — 두 값이 어긋나지 않도록 main에서 terrain 상수를 넘기는 흐름을 표준으로 한다.
> - **데미지 값(1/50)은 combat 상수가 아니다** — gun.GUN_DAMAGE(=1)·missile.MISSILE_DAMAGE(=50)가 단일 진실이며, combat은 `hit.damage`를 그대로 읽는다(중복 정의 금지). hit에 damage가 없을 때의 fallback 정도만 고려(§5.3).

---

## 4. 상태 구조

### 4.1 플레이어 상태 — `createPlayer()`
```js
export function createPlayer() {
  return {
    hp: MAX_HP,        // 체력(100 시작, 0 이하 → 사망)
    alive: true,       // 생존 상태
    cause: null,       // 사망 원인: null | 'hit' | 'crash' (HUD/결과창/이펙트 분기용)
  };
}
```
- ONTOLOGY `plane.hp`/`plane.alive`와 정합. `cause`는 ONTOLOGY엔 없지만 결과창 문구("격추됨" vs "추락")·폭발 이펙트 분기에 유용해 추가(읽지 않아도 정합 안 깨짐).
- 호출마다 독립된 새 객체(공유 참조 금지).

### 4.2 세션 상태 — `createCombat(opts?)`
```js
export function createCombat() {
  return {
    players: [createPlayer(), createPlayer()],  // index 0=P1(좌), 1=P2(우)
    state: 'fighting',                          // 'fighting' | 'over'
    winner: null,                               // null(진행중) | 0 | 1 | 'draw'
  };
}
```
- **players를 배열로 보유** — `hit.target`/즉사 대상이 owner index(0/1)이므로 `players[index]`로 O(1) 접근. seed ONTOLOGY의 `player.index`(0/1)와 정합.
- `state`: seed ONTOLOGY는 `session.state`로 `'select'|'fighting'|'result'`를 정의하지만, **그건 main/M11이 관리하는 전체 게임 상태**다. combat의 `state`는 **전투 자체의 진행/종료**만 표현하므로 `'fighting'|'over'`로 둔다(혼동 방지). main이 combat.state==='over'를 보고 자신의 세션 상태를 `'result'`로 전이(§8).
- `winner`: 본 설계는 **승자 index 또는 'draw'**로 둔다(없으면 `null`). seed ONTOLOGY는 `session.winner: number(없으면 -1)`라 동시사망 표현이 없는데, draw 케이스를 명시하기 위해 combat 내부는 `'draw'` 문자열을 쓰고, **main 결선에서 필요하면 -1로 매핑**한다(§8·§9). 단일 승자만 다루면 index로 충분.

> 호환 옵션: `createCombat({ p1, p2 })`처럼 외부에서 만든 플레이어를 주입할 수도 있게 시그니처를 열어둘 수 있으나(시드 작업지시의 표현), 기본은 인자 없이 표준 100/100으로 시작. 색·소속 등은 combat 책임 아님(렌더/main).

---

## 5. API 시그니처와 동작 (모두 불변·결정론)

### 5.1 `createPlayer()` / `createCombat()`
§4 참조. 100/100·둘 다 생존·`state:'fighting'`·`winner:null`.

### 5.2 거리/충돌 보조 — 없음
combat은 거리 계산을 하지 않는다(명중은 무기가 끝냄, 충돌은 terrainFn이 끝냄). 순수하게 hp 산술 + 분기만.

### 5.3 `applyHits(combat, hits) → combat` — 명중 데미지 적용

```js
// hits = [{ target, owner, damage, position? }, ...]
//   target: 피격 플레이어 식별 — gun/missile은 "target 후보 객체"({owner,x,y,z,alive})를 넣어준다.
//            → target.owner 로 index를 얻는다(아래 resolveIndex 참조).
//   owner : 가해 플레이어 index(자기명중은 무기에서 이미 제외됨 → 여기선 추가 검사 불필요).
//   damage: gun=1, missile=50 (hit이 그대로 실어 보냄). 누락 시 0 취급(안전).
export function applyHits(combat, hits) {
  // 이미 종료된 전투면 더 손대지 않음(누적 방지·결정론)
  if (combat.state === 'over') return combat;
  if (!hits || hits.length === 0) return combat;

  const players = combat.players.map((p) => ({ ...p }));  // 깊은 1단 복사(불변)

  for (const h of hits) {
    const idx = resolveIndex(h.target);     // target 객체/숫자 → 0|1
    if (idx == null) continue;              // 식별 불가 hit 무시
    const p = players[idx];
    if (!p.alive) continue;                 // 이미 죽은 기체엔 누적 안 함(죽은 뒤 hit 무영향)
    const dmg = h.damage || 0;
    p.hp = Math.max(0, p.hp - dmg);         // 0 바닥 클램프
    if (p.hp <= 0) { p.alive = false; p.cause = p.cause ?? 'hit'; }
  }

  return { ...combat, players };
}
```
설계 포인트:
- **`hit.target` 해석** — gun.stepBullets/missile.stepMissiles는 `hits.push({ target: hit, owner, damage, position })`로 **target에 후보 기체 객체**(`{owner,x,y,z,alive}`)를 넣는다(gun.js line 143·missile.js line 266). 따라서 `resolveIndex`는 `target.owner`를 읽어 index로 변환한다. 숫자(index)가 직접 와도 받도록 유연 처리:
  ```js
  function resolveIndex(target) {
    if (typeof target === 'number') return (target === 0 || target === 1) ? target : null;
    if (target && typeof target.owner === 'number') return target.owner;
    return null;
  }
  ```
  > 시드 작업지시는 "hits 배열(각 {target(owner 인덱스), damage})"라 표현하지만, **실제 무기가 산출하는 형태는 `target=객체`**다(코드 확인필). 양쪽을 모두 받게 하면 무기 변경에도 안전하고 테스트도 두 형태로 쓸 수 있다.
- **자기명중 제외 재검사 불필요** — gun(`t.owner===b.owner continue`)·missile(`t.owner===m.owner continue`)이 이미 제외. combat은 신뢰하고 그대로 적용(중복 검사 비도입; 방어적으로 `h.owner === idx`면 skip하는 가드는 §9 선택).
- **죽은 기체 누적 차단** — `!p.alive`면 skip. 같은 프레임에 여러 탄이 동시에 들어와 이미 0이 된 뒤의 hit은 무시(체력 음수 방지 + "죽은 뒤 추가 hit 무영향" 요구 충족). 단, **같은 프레임 안에서 죽기 직전의 누적은 정상 반영**(hit 순서대로 차감하다 0 도달 시 그 시점부터 alive=false).
- **0 클램프** — `Math.max(0, hp-dmg)`로 hp가 음수가 되지 않음(미사일 50 두 방 = 정확히 0; HUD 음수 표시 방지).
- **불변** — players를 `map(p=>({...p}))`로 1단 복사 후 변형, 새 combat 반환. 인자 combat·players 비변형.
- **여기서 resolve를 부르지 않음** — applyHits는 hp/alive만 갱신. 승패 전이는 `resolve`(또는 `stepCombat`)가 마지막에 한 번. (단계 분리로 테스트 단순화.)

### 5.4 `checkTerrainCrash(combat, planes, terrainFn, margin?) → combat` — 충돌 즉사

```js
// planes = [{ x,y,z }, { x,y,z }] — index 0/1 기체 현재 위치(main의 plane1/plane2).
// terrainFn = (x,y,z,margin)=>bool  — terrain.terrainCollision 주입(순수성).
export function checkTerrainCrash(combat, planes, terrainFn, margin = CRASH_MARGIN) {
  if (combat.state === 'over') return combat;
  if (typeof terrainFn !== 'function' || !planes) return combat;

  const players = combat.players.map((p) => ({ ...p }));
  let changed = false;

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const pl = planes[i];
    if (!p.alive || !pl) continue;                  // 죽었거나 위치 없으면 skip
    if (terrainFn(pl.x, pl.y, pl.z, margin)) {       // 지형/수면 충돌 → 즉사
      p.hp = 0;
      p.alive = false;
      p.cause = 'crash';
      changed = true;
    }
  }

  return changed ? { ...combat, players } : combat;  // 변화 없으면 원본 그대로(불변·동일성 유지)
}
```
설계 포인트:
- **즉사** — 충돌이면 hp를 깎는 게 아니라 즉시 `hp=0, alive=false, cause='crash'`(seed "폭발과 함께 즉사"). 데미지 누적 아님.
- **terrainFn 주입** — combat은 terrain을 import하지 않는다. 테스트에선 `(x,y,z)=> y<=0`(수면) 같은 가짜 함수로 결정론적 시나리오 구성. main은 `terrain.terrainCollision`을 그대로 넘김(시그니처 `(x,y,z,margin)` 정합 — terrain.js line 98).
- **수면 포함** — terrain.terrainCollision이 `y-margin<=0`(수면)과 `y-margin<=heightAt`(지형)을 모두 true로 주므로(terrain.js line 99~100), 별도 수면 분기 불필요. combat은 "충돌이면 즉사"만.
- **변화 없으면 원본 반환** — 충돌이 하나도 없으면 `combat` 그대로 반환(불필요한 새 객체 방지 + main에서 동일성 비교 가능). 충돌 시에만 새 객체.
- **planes 형태** — `{x,y,z}`만 읽음(자세 무관 — 점 + margin 근사). main의 plane1/plane2를 그대로 `[plane1, plane2]`로 넘김.

### 5.5 `resolve(combat) → combat` — 단판 승패 판정

```js
export function resolve(combat) {
  if (combat.state === 'over') return combat;       // 이미 끝났으면 그대로(멱등)

  const [a, b] = combat.players;
  const aDead = !a.alive;
  const bDead = !b.alive;
  if (!aDead && !bDead) return combat;              // 둘 다 생존 → 진행 유지

  // 한 명 이상 사망 → 전투 종료
  let winner;
  if (aDead && bDead) winner = 'draw';              // 동시 사망 → 무승부
  else if (aDead)     winner = 1;                   // P0 죽음 → P1 승
  else                winner = 0;                   // P1 죽음 → P0 승

  return { ...combat, state: 'over', winner };
}
```
설계 포인트:
- **단판** — 한 명이라도 죽으면 즉시 `state='over'`. 이후 step에서 멱등(이미 over면 그대로).
- **동시 사망 = draw** — 같은 프레임에 둘 다 0이 되면(예: 정면 충돌로 둘 다 crash, 또는 미사일 상호 명중) `winner='draw'`. seed는 단판만 규정하고 draw를 명시하지 않으나, 엣지를 무정의로 두면 승자 표시가 깨지므로 **draw로 명시**(§9 열린 결정 — main에서 -1 매핑 또는 "무승부" 결과창).
- **승자 index** — 죽은 쪽의 **상대**. seed "한 명이 죽으면 결과창(승패)".
- **불변·멱등** — over가 아닐 때만 새 객체. 같은 combat 두 번 resolve → 같은 결과.

### 5.6 `stepCombat(combat, ctx) → combat` — 통합 1스텝 (main 권장 진입점)

```js
// ctx = { hits, planes, terrainFn, margin }
//   hits     : gun.stepped.hits 와 missile.steppedM.hits 를 합친 배열(main이 concat).
//   planes   : [plane1, plane2] 현재 위치({x,y,z}).
//   terrainFn: terrain.terrainCollision (주입).
//   margin   : 충돌 margin(미전달 시 CRASH_MARGIN).
export function stepCombat(combat, ctx = {}) {
  if (combat.state === 'over') return combat;        // 종료 후엔 변동 없음(입력/충돌 무시)
  let next = applyHits(combat, ctx.hits);
  next = checkTerrainCrash(next, ctx.planes, ctx.terrainFn, ctx.margin);
  next = resolve(next);
  return next;
}
```
설계 포인트:
- **순서: 데미지 → 충돌 → 승패**. 데미지로 죽든 충돌로 죽든 마지막 `resolve`가 한 번 승패를 본다.
- **종료 후 no-op** — `state==='over'`면 곧장 반환(데미지·충돌 누적 안 함; "죽은 뒤 추가 hit 무영향" + 종료 후 안정성).
- main은 이 한 줄(`combat = stepCombat(combat, {...})`)만 호출하면 된다. 개별 함수는 테스트·세밀 제어용으로도 export(둘 다 제공).

---

## 6. main 결선 (M8 통합 — 본 설계의 후속 작업)

현재 `main.js`는 hits를 무시한다(line 200~201 `// hits는 M8 combat에서 HP 적용 — 지금은 무시`, line 237). 결선 절차:

1. **상태 보유** (상단, `let plane1 = ...` 근처):
   ```js
   import { createCombat, stepCombat } from './combat.js';
   let combat = createCombat();
   ```
2. **targets에 생존 반영** — 현재 `targets`는 `alive:true` 하드코딩(line 195·196). combat 상태를 반영해 죽은 기체를 무기 명중 후보에서 빼고, 죽은 기체는 발사·비행도 멈춘다:
   ```js
   const p0Alive = combat.players[0].alive;
   const p1Alive = combat.players[1].alive;
   // 생존 기체만 비행/무기 step (죽으면 그 자리에 추락/정지 — 렌더는 잔해 처리 가능)
   ```
   - `targets[i].alive = combat.players[i].alive`로 동기화 → gun/missile이 죽은 기체를 명중 후보에서 제외(이미 `t.alive===false` 무시 구현됨).
3. **hits 합쳐 전달** — gun과 missile의 hits를 모아 stepCombat:
   ```js
   const hits = [...stepped.hits, ...steppedM.hits];   // 기관총(-1) + 미사일(-50)
   combat = stepCombat(combat, {
     hits,
     planes: [plane1, plane2],
     terrainFn: terrainCollision,         // terrain.js (이미 import됨, line 26)
     margin: CRASH_MARGIN,                // terrain.CRASH_MARGIN import 권장(단일 진실)
   });
   ```
   - `stepped`/`steppedM`은 이미 main에 있음(line 198·235). hits 배열만 합치면 됨.
4. **종료 처리** — `combat.state==='over'`면:
   - 무기/비행 step 스킵(또는 입력 무시) — 사망 후 조종/발사 정지.
   - 결과창 트리거(M11): `showResult(combat.winner)` — 0/1/'draw'.
   - HUD에 체력 전달(M9): `hud.update`에 `combat.players[i].hp`/`alive` 추가 인자.

> **책임 경계 재확인**: combat은 "state==='over'를 알려줄" 뿐, **step을 실제로 스킵하는 건 main**이다(combat은 렌더 루프를 모름). combat의 stepCombat은 over면 no-op이라 호출해도 안전하지만, 불필요한 비행/무기 적분을 막는 건 main의 `if (combat.state !== 'over') { ...stepFlight... }` 가드.

---

## 7. 책임 경계

| 책임 | 담당 |
|---|---|
| 체력 100 보유·차감(0 클램프)·0이면 사망 | **combat (M8)** — `applyHits`/상태 |
| 지형/수면 충돌 시 즉사(hp=0, alive=false, cause='crash') | **combat (M8)** — `checkTerrainCrash`(terrainFn 호출) |
| 단판 승패 판정(상대 승 / 동시 draw)·state 전이(fighting→over) | **combat (M8)** — `resolve` |
| 명중 **판정**(거리/콘/자기명중 제외)·데미지 **값**(1/50) 산출 | **gun (M5) / missile (M6)** — `hits` 생성. combat은 소비만 |
| 지형/수면 충돌 **질의**(높이·margin) | **terrain (M3)** — `terrainCollision`. combat은 호출만 |
| 사망 후 입력/조종 정지·무기/비행 step 스킵 | **main** — `state==='over'` 가드 |
| 결과창·재대결(단판 재시작) | **M11 + main** — `winner`/`state` 소비, 재대결 시 `createCombat`/`createPlane` |
| 체력바·사망 표시 HUD | **HUD (M9)** — `hp`/`alive` 소비 |
| 폭발 이펙트·격추/충돌 효과음 | **render(M4 패밀리) / audio(M10)** — `cause`/사망 이벤트 소비 |

핵심: **combat은 hp 산술 + 즉사 + 승패만 한다.** "맞았는가"(무기)·"부딪혔는가"(terrain)·"그래서 멈출까/뭘 보여줄까"(main/HUD/M11)는 각자의 책임이다. combat은 명중/충돌의 **결과**만 받아 게임의 **생사·승부**로 환산한다.

---

## 8. 다른 마일스톤 영향

- **M5 gun / M6 missile (hits 소비)**: 두 무기의 `hits`(`{target,owner,damage,position}`)를 **변경 없이 그대로 소비**. combat이 `target.owner`로 피격자를 식별하고 `damage`로 hp를 깎는다. 무기는 수정 불필요(이미 hits를 산출 완료). 단, main이 `targets[i].alive`를 combat 상태로 동기화하면, 죽은 기체는 무기 명중 후보에서 자동 제외(무기의 `t.alive===false` 무시 활용).
- **M3 terrain**: `terrainCollision(x,y,z,margin)`을 `terrainFn`으로 주입. terrain은 수정 불필요(이미 충돌 질의 제공). `CRASH_MARGIN`은 terrain을 단일 진실로 삼아 main이 넘긴다.
- **M9 HUD (체력바)**: `combat.players[i].hp`(0~100)로 체력바, `alive===false`로 격추 표시. 현재 `hud.update`는 gun/launcher/dispenser/target만 받으므로(main.js line 249~252) **hp/alive 인자 추가 필요**(M9 확장).
- **M11 결과창/재대결 (winner·state 소비)**: `combat.state==='over'`면 결과창 표시, `combat.winner`(0=P1승/1=P2승/'draw'=무승부)로 문구 결정. 재대결 버튼 → `combat = createCombat()` + 기체/무기 상태 재생성(`createPlane`/`createGun`/`createMissileLauncher`/`createFlareDispenser`) + `state`를 다시 'fighting'으로. seed "단판 재시작".
- **main 세션 상태**: seed ONTOLOGY `session.state('select'|'fighting'|'result')`·`session.winner(없으면 -1)`는 **main/M11이 관리**. combat의 `state('fighting'|'over')`/`winner(0|1|'draw')`를 main이 자기 세션으로 매핑(over→'result', 'draw'→-1 또는 무승부 처리). combat과 main 세션 상태를 혼동하지 말 것(§4.2·§9).
- **렌더(M4 패밀리)/audio(M10)**: `cause==='crash'`면 폭발 이펙트+추락음, `'hit'`(hp 0)면 격추 폭발음. combat은 상태만 노출, 트리거는 렌더/audio.

---

## 9. 열린 결정(구현 시 확정 — 명세 불변 범위)

- **동시 사망 처리**: 본 설계는 `winner='draw'`(무승부) 채택. 대안 — (a) 가해자 우선(미사일 owner가 마지막에 적용된 쪽 승) 같은 타이브레이크, (b) main에서 -1로 매핑해 "무승부" 결과창. seed가 draw를 명시하지 않으므로 main/M11과 합의해 확정. **확률·난수로 승자를 고르지 않는다**(결정론).
- **`createCombat` 인자**: 기본 무인자(100/100)로 시작. 외부 플레이어 주입(`{p1,p2}`)이나 시작 hp 커스텀이 필요하면 옵션 인자 추가(밸런스 튜닝용). seed는 100 고정.
- **`hit.target` 형태**: 무기가 실제로 넣는 **객체(`{owner,...}`)** 와 시드 표현(인덱스 숫자) 둘 다 `resolveIndex`로 수용. 무기 구현이 바뀌어 숫자만 넘기게 돼도 동작.
- **자기명중 방어 가드**: 무기가 이미 제외하므로 combat은 재검사 안 함(신뢰). 방어적으로 `h.owner === resolveIndex(h.target)`이면 skip하는 가드를 넣을지 선택(이중 안전 vs 단순화) — 본 설계는 미도입(단순화).
- **죽은 뒤 누적 차단 위치**: `applyHits`에서 `!p.alive` skip + `stepCombat`의 over no-op으로 이중 차단. "같은 프레임 동시 다발 hit으로 hp가 -로 가는" 것은 0 클램프로도 방지되지만, alive skip이 "죽은 기체에 격추 이펙트가 중복 트리거"되는 것까지 막는다.
- **충돌 margin 단일 진실**: terrain.CRASH_MARGIN을 main이 주입하는 흐름을 표준화(combat의 상수는 fallback). 두 값이 어긋나면 충돌 타이밍이 미세하게 달라질 수 있으므로 terrain 쪽을 신뢰.
- **추락 연출**: 충돌 즉사 후 기체를 즉시 멈출지(main이 step 스킵), 잠깐 추락 낙하 애니메이션을 줄지는 렌더(M4 패밀리)·main 결정. combat은 `alive=false` 시점만 제공.
