# 설계 — audio.js 사운드 시스템 (엔진음 + 효과음 + 음악) (M10)

> 2P 도그파이트용 Web Audio 사운드. **절차적 합성 우선**(에셋 의존 0)으로 엔진 험 + 효과음(기관총·미사일발사·락온경고·폭발) + 음악(BGM)을 낸다.
> `src/audio.js`는 **THREE 비의존**(AudioContext/DOM만 의존 → 렌더 레이어 취급). 결선은 `main.js`가 담당.
> 참고 구현: `driving_game/src/render/audio.js`(createAudio·resume·update·suspend·절차적 노이즈 버스트·DI 패턴), `driving_game/mds/design/audio.md`.

---

## 목표 / 범위

- **엔진음**: 절차적 오실레이터 기반 저주파 험(hum). **2P 공용 1개 엔진 베드**로 단순화하되, 두 기체의 평균(또는 최대) 속도/부스터에 따라 피치를 미세 변조. (각 기체별 독립 엔진은 분할화면 특성상 좌우 패닝 이득이 적어 과설계 → 공용 1개 권고.)
- **효과음(절차적)**: 기관총(짧은 노이즈 버스트, 연사 게이팅) / 미사일 발사(주파수 스윕 whoosh) / 락온 경고(짧은 beep 반복) / 폭발(저역 강조 노이즈 붐). 모두 즉석 합성 → 에셋 0.
- **음악(BGM)**: 기본은 **절차적 루프**(베이스 + 간단 아르페지오, 저음량) 권고. 에셋 의존을 0으로 유지. (선택) CC 라이선스 샘플로 교체 가능하게 `bgmUrl` 주입 훅을 남기되, 부재/실패 시 절차적 루프로 graceful fallback.
- **자동재생 정책**: `AudioContext`는 **첫 사용자 제스처**(시작화면 click 또는 첫 keydown) 시점에 생성/`resume()`. driving_game과 동일.
- **음소거**: `KeyM` 토글(전역 masterGain 0). seed의 P2 플레어 대안키가 `M`이지만 M11 시작화면에서 P2 플레어는 `RightCtrl`로 확정 권고(아래 "음소거 키 충돌" 참조).

> ⚠️ **에셋 정책**: M10은 **절차적 합성만으로 모든 사운드를 완결**한다(엔진·효과음·BGM 전부). driving_game처럼 외부 ogg를 받지 않는다 → 출처표기·라이선스 부담 없음. 샘플 교체는 선택적 후속 작업.

---

## audio.js — 공개 API

```js
// 의존성 주입: 테스트/모킹을 위해 AudioContext 생성자를 주입 가능하게 한다.
// 미주입 시 window.AudioContext || window.webkitAudioContext 사용.
export function createAudio(opts = {}) { ... }
//   opts = { AudioContextCtor?, bgmUrl?, maxSpeed? }
//   → {
//        resume(), suspend(),
//        update(state, dt),     // 매 프레임: 엔진 피치/게인 + 락온경고 게이팅 + BGM 유지
//        gunShot(),             // 기관총 1발(연사 시 발사 프레임마다 호출, 내부 레이트 게이팅)
//        missileFire(),         // 미사일 발사 whoosh 1회
//        lockWarn(on),          // 피락온 경고 on/off (on이면 beep 주기 재생, off면 중지)
//        explosion(big = false),// 폭발 붐(big=true 격추/추락, false 미사일 명중)
//        setMuted(bool), toggleMute(), get muted(),
//        get _ctx()             // 테스트용
//      }
```

| 메서드 | 책임 |
| --- | --- |
| `resume()` | 첫 호출 시 `AudioContext` 생성 + 그래프(masterGain/engineGain/sfxGain/musicGain) 구성 + 엔진 오실레이터 1회 `start()` + BGM 시작 + `ctx.resume()`. 이후 호출은 **idempotent**(그래프/소스 재생성 X, `ctx.resume()`만). 사용자 제스처에서만 호출. |
| `update(state, dt)` | 매 프레임. `state`에서 엔진 피치/게인 갱신(`speedToEnginePitch`), 락온 경고 beep 주기 누적 재생, BGM 유지. ctx 미생성/음소거면 no-op. |
| `gunShot()` | 기관총 1발 노이즈 버스트. **내부 발사 레이트 게이팅**(min 간격) — main이 발사 프레임마다 호출해도 과밀 방지. 음소거/미시작 no-op. |
| `missileFire()` | 미사일 발사 whoosh(주파수 하강 스윕) 1회. |
| `lockWarn(on)` | `on=true`면 경고 활성(다음 `update`들에서 일정 주기로 beep), `on=false`면 비활성. 상태 플래그만 토글(실제 beep는 update가 발생). |
| `explosion(big)` | 폭발 붐 1회. `big`이면 진폭·길이·저역 강조 ↑. |
| `setMuted` / `toggleMute` / `muted` | masterGain 0/정상, 플래그 유지·getter 제공. |
| `suspend()` | `ctx.suspend()`(시간 정지, 그래프 유지). 결과창/탭 비활성 시 사용 가능(선택). |

> 순수 매핑 함수(`speedToEnginePitch`)는 named export로 따로 빼서 단위 테스트 대상화한다.

---

## 오디오 그래프 구조

```
[engineOsc(sawtooth/triangle)] → [engineLP(lowpass)] → [engineGain] ┐
[효과음 노드(1회성: gun/missile/lock/explosion)] → [sfxGain] ───────┤→ [masterGain] → ctx.destination
[bgm 노드(절차적 루프 osc들 또는 buffer)] → [musicGain] ────────────┘
```

- **masterGain**: 음소거/전역 볼륨. 음소거 = gain 0(노드 연결 유지, 토글 즉시 반영, `setTargetAtTime(target, t, 0.01)`).
- **engineGain**: 엔진 베드 게인(≈0.12, 험은 배경음이라 낮게). on/off 페이드는 `setTargetAtTime`.
- **engineLP**: lowpass(cutoff ≈ 600~1200Hz) — sawtooth의 거친 고역을 깎아 "험"답게(driving_game sawtooth "시끄럽다" 교훈 반영).
- **sfxGain**: 효과음 버스(≈0.5). 효과음 1회성 노드는 여기에 연결 후 `start()`(자동 GC).
- **musicGain**: BGM 버스(≈0.18, 효과음보다 확실히 낮게). 음악 on/off·볼륨 조절 포인트.

---

## 엔진음 합성 — 속도 → 피치 매핑 (순수 함수)

```js
// 기체 속도(m/s)를 엔진 오실레이터 주파수(Hz)로 선형 매핑.
// 저속(거의 정지/감속)은 저음 럼블, 부스터는 고음. 경계 밖은 clamp.
// 2P 공용 엔진은 두 기체 속도의 대표값(max 또는 평균)을 넣는다.
export const ENGINE_FREQ_MIN = 70;   // 저속 럼블(Hz)
export const ENGINE_FREQ_MAX = 200;  // 부스터 고음(Hz)
export function speedToEnginePitch(speed, maxSpeed = 210) {
  const t = Math.min(1, Math.max(0, speed / maxSpeed)); // 0~1 clamp
  return ENGINE_FREQ_MIN + t * (ENGINE_FREQ_MAX - ENGINE_FREQ_MIN);
}
```

- 단조 증가, 양 끝 clamp(음수/초과 안전). `maxSpeed`는 `flight.js`의 `MAX_SPEED`(210)와 정합되게 주입 권고.
- 적용: `engineOsc.frequency.setTargetAtTime(target, ctx.currentTime, 0.05)`로 부드럽게(프레임 점프 글리치 방지).
- 엔진은 **항상 켜진 베드**(살아있는 기체가 있는 동안). `update`에서 게인은 보통 고정(`ENGINE_GAIN_ON`), 양 기체 사망 시 0으로 페이드 가능(선택).
- 합성 디테일(선택): `engineOsc`(sawtooth) 위에 저음 sub osc(주파수 ½) 1개를 섞으면 더 묵직. 핵심은 "배경에서 낮게".

---

## 효과음 합성 (절차적 — 노드 그래프)

### 기관총 `gunShot()` — 노이즈 버스트 + 게이팅
- 짧은(≈25~40ms) 화이트노이즈 버퍼 즉석 생성(`ctx.createBuffer(1,n,sr)` + `Math.random()*2-1`).
- `AudioBufferSourceNode` → bandpass/highpass(거친 "타타타" 질감, cutoff ≈ 1.5kHz) → 빠른 감쇠 gain(`setValueAtTime(amp)` → `setTargetAtTime(0, t, 0.01)`) → `sfxGain`.
- **연사 게이팅**: 내부 `lastGunTime` 보관, `ctx.currentTime - lastGunTime < GUN_MIN_INTERVAL`(≈0.05s)면 skip. 기관총 FIRE_RATE=12발/s라 호출마다 내면 과밀·클리핑 → 게이팅으로 솎아 "드르륵" 유지하되 부담 ↓.
- 진폭은 낮게(≈0.25) — 연사라 누적 음량 큼.

### 미사일 발사 `missileFire()` — whoosh(주파수 스윕)
- `OscillatorNode`(sawtooth) 또는 노이즈 + bandpass. 주파수를 **하강 스윕**(예 800Hz → 120Hz, `frequency.setValueAtTime` → `exponentialRampToValueAtTime`, ≈0.5s).
- gain 엔벨로프: 빠른 attack → 0.5s 감쇠. → `sfxGain`. (노이즈 베이스로 "쉬익" + osc로 "휘잉" 혼합 권고.)

### 락온 경고 `lockWarn(on)` + update beep
- `lockWarn(on)`은 플래그만 토글. 실제 beep는 `update`가 `LOCK_BEEP_INTERVAL`(≈0.4s)마다 1회 발생.
- 1 beep: 단음 `OscillatorNode`(square/sine, ≈900Hz, ≈80ms) + 짧은 gain 엔벨로프 → `sfxGain`. "삐… 삐…" 경고음.
- off로 바뀌면 누적 타이머 리셋, 더 이상 beep 안 함. (이미 발생한 1회성 beep 노드는 자연 종료.)

### 폭발 `explosion(big)` — 저역 강조 노이즈 붐
- 길게(small ≈0.6s / big ≈1.1s) 화이트노이즈 버퍼 → lowpass(cutoff ≈ big 300Hz / small 500Hz, 저역 강조) → gain 엔벨로프(즉시 큰 진폭 → 지수 감쇠) → `sfxGain`.
- `big=true`(격추·추락): 진폭·길이 ↑, lowpass cutoff ↓(더 묵직). + 짧은 저음 sine "쿵"(≈60Hz, 0.15s)을 겹치면 타격감 ↑(선택).

> 모든 1회성 효과음 노드는 `start()` 후 수명 끝나면 자동 GC(별도 stop/dispose 불필요). `sfxGain` 아래라 음소거가 일관 적용.

---

## 음악(BGM) — 절차적 루프 (권고) + 샘플 폴백 훅

### 기본: 절차적 루프
- 가벼운 절차적 배경음: 저음 베이스 osc(루프 코드 진행) + 간단 아르페지오. `musicGain`(≈0.18)으로 효과음보다 확실히 낮게.
- 구현 옵션 2가지(택1, 실행 단계 결정):
  1. **지속 osc + LFO 변조**(가장 단순): 2~3개 osc를 띄워 두고 detune/filter를 천천히 변조. 항상 재생, on/off는 `musicGain`.
  2. **스텝 시퀀서**: `update`에서 박자 타이머 누적 → 박마다 짧은 노트 노드 발생. 더 "곡"답지만 복잡.
- 권고: **옵션 1**(지속 osc + 느린 변조). 가장 적은 코드로 "배경 음악 있음"을 충족하고 항상 안전.

### 선택: CC 샘플 폴백 훅
- `opts.bgmUrl` 주입 시 `resume()`에서 `fetch → decodeAudioData → AudioBufferSourceNode(loop=true)` 시도.
- **부재/실패 시 절차적 루프로 fallback**(엔진/효과음은 절차적이라 영향 없음). 샘플 채택 시 출처/라이선스 표기는 README CREDITS에 추가(driving_game 선례).
- 기본 배포는 `bgmUrl` 미주입 → 절차적만. 에셋 0 유지.

---

## main.js 결선 지점 (현재 코드 기준)

| 위치(현재 main.js) | 결선 내용 |
| --- | --- |
| import 추가 | `import { createAudio } from './audio.js';` + `import { MAX_SPEED } from './flight.js';` + 인스턴스 `const audio = createAudio({ maxSpeed: MAX_SPEED });` |
| 사용자 제스처 | **첫 keydown** 또는 M11 시작화면 click 시 `audio.resume();` 1회. 현재 main에는 시작 오버레이가 없으므로(165행 keydown 핸들러) keydown 핸들러 안에서 `audio.resume()` 호출(idempotent라 반복 안전). M11 시작화면 추가 시 그 click으로 옮기는 것이 정석. |
| keydown 핸들러(165행) | `if (e.code === 'KeyM') { audio.toggleMute(); return; }`를 onKeyDown 호출 전에 추가(음소거 토글). + 같은 핸들러에서 `audio.resume()`(첫 제스처). |
| 기관총 발사(244~245행) | `if (fire1.bullets.length) { bullets.push(...fire1.bullets); audio.gunShot(); }` / `fire2`도 동일. (발사된 탄 1개 이상 = 이번 프레임 격발 → gunShot. 내부 게이팅이 연사 과밀 처리.) |
| 미사일 발사(261~262행) | `if (lock1.fired) { missiles.push(lock1.fired); audio.missileFire(); }` / `lock2`도 동일. |
| 폭발 — 미사일 명중(293~295행) | 기존 `spawnExplosion(..., false)` 루프 안에서 `audio.explosion(false);` 호출(명중당 1회). |
| 폭발 — 격추/추락(305~310행) | 사망 전이 `if (prevAlive[i] && !combat.players[i].alive)` 블록에서 `spawnExplosion(..., true)` 직후 `audio.explosion(true);`. |
| 피락온 경고(332~333행) | 이미 계산하는 `lockedBy0`/`lockedBy1` 활용. 어느 한쪽이라도 락온 진행/완료면 경고 on: `const warn = (lockedBy0.locking || lockedBy0.locked || lockedBy1.locking || lockedBy1.locked); audio.lockWarn(warn);` (2P 공용 경고. 분할화면이라 어느 화면 경고든 같은 스피커.) |
| 매 프레임 엔진/경고/BGM(animate 말미, applyChase 부근) | `audio.update({ speed: Math.max(plane1.speed, plane2.speed), anyAlive: p0Alive || p1Alive }, dt);` — 엔진 피치(두 기체 중 빠른 쪽 기준), BGM 유지, 경고 beep 게이팅. **fighting 분기 밖**(또는 안)에서 매 프레임 호출하되, `combat.state==='over'`면 엔진 게인 0 페이드(선택). |
| 부스터(선택) | 별도 효과음 없이 엔진 피치 상승으로 표현(`update`의 speed에 부스터 반영됨). 추가 "whoosh" 원하면 부스터 엣지에서 1회 재생 훅 추가 가능(과설계 주의, 기본은 생략). |

> `audio.*`는 모두 ctx 미생성·음소거 시 no-op이라 시작 전(resume 전) 호출돼도 안전. 단 `update`는 일관성을 위해 매 프레임 항상 호출.

### 음소거 키 충돌
- seed 조작표에서 P2 플레어 대안키가 `RightCtrl (또는 M)`. **음소거를 `KeyM`에 두므로 P2 플레어는 `RightCtrl`로 확정** 권고(M11 입력 확정 시 정합). 충돌 시 M11과 조율.

---

## 단위 테스트 설계 가이드 (`src/audio.test.js`)
Web Audio 노드는 node/jsdom에서 직접 못 울린다 → **순수 매핑 + DI 모킹 + 노드 생성 호출 검증**에 집중. driving_game `audio.test` 패턴 답습.

1. **`speedToEnginePitch`(순수)**:
   - `speedToEnginePitch(0)` ≈ `ENGINE_FREQ_MIN`, `speedToEnginePitch(maxSpeed)` ≈ `ENGINE_FREQ_MAX`.
   - 단조 증가: `speedToEnginePitch(50) < speedToEnginePitch(120) < speedToEnginePitch(210)`.
   - 경계 clamp: 음수→MIN, 초과→MAX. 결과가 항상 `[MIN, MAX]` 범위.
   - `maxSpeed` 정합(절반 속도는 두 주파수 중간 근처).
   - 상수값(`ENGINE_FREQ_MIN`/`MAX`) 검증.
2. **음소거 토글**: mock `AudioContextCtor` 주입 → `toggleMute()` 2회면 원복, `muted` getter 반영, `setMuted(true)` 후 `gunShot()`/`explosion()`/`missileFire()`가 효과음 노드를 만들지 않음(혹은 masterGain 0 설정) 검증.
3. **resume idempotent**: `resume()` 2회 → `AudioContext` 1개만 생성, 엔진 osc `start`가 **1회만** 호출(그래프 한 번만 구성).
4. **gunShot 게이팅**: mock ctx의 `currentTime`을 고정/증가시키며 `gunShot()`을 짧은 간격으로 2회 → 두 번째는 노드 생성 skip(첫 호출만 `createBufferSource`/`createBuffer` 호출), 충분히 시간 경과 후 호출은 다시 생성됨.
5. **missileFire / explosion 노드 생성**: 호출 시 `createOscillator`(또는 `createBufferSource`) + `createGain`가 호출되고 `start`가 불리는지(인자/호출 횟수) 검증. `explosion(true)` vs `explosion(false)`가 다른 파라미터(길이/진폭/cutoff)를 쓰는지(예 gain `setValueAtTime` 인자 비교).
6. **lockWarn 게이팅**: `lockWarn(true)` 후 `update(state, dt)`를 `LOCK_BEEP_INTERVAL` 미만 누적 → beep 0회, 초과 누적 → beep 1회(노드 생성). `lockWarn(false)` 후 update는 beep 0회.
7. **update 엔진 변조**: `update({speed}, dt)`가 엔진 osc `frequency.setTargetAtTime`을 `speedToEnginePitch(speed)` 타깃으로 호출하는지.
8. **미생성/no-op 안전성**: `resume()` 전에 `update`/`gunShot`/`explosion`/`missileFire`/`lockWarn` 호출이 throw하지 않고 노드도 안 만듦.
9. **BGM**: `resume()` 시 musicGain 아래 BGM 노드(절차적 osc 또는 buffer)가 생성/`start`되는지. `bgmUrl` 미주입이면 절차적 경로를 타는지(샘플 fetch 호출 없음).

> **Mock AudioContext**: `createGain`/`createOscillator`/`createBuffer`/`createBufferSource`/`createBiquadFilter`/`decodeAudioData`/`currentTime`/`sampleRate`/`destination`/`resume`/`suspend`/`state` 스텁. 노드 목은 `connect`/`start`/`stop` + AudioParam(`frequency`/`gain`/`detune`)을 가지며, AudioParam은 `setTargetAtTime`/`setValueAtTime`/`exponentialRampToValueAtTime`/`linearRampToValueAtTime` 스파이를 가진 `{ value }` 객체. `bgmUrl` 비동기 경로 테스트 시 `fetch`/`decodeAudioData` stub + microtask flush(`await Promise.resolve()`).

---

## 영향 범위

| 파일 | 변경 | 비고 |
| --- | --- | --- |
| `src/audio.js` | **신규** | createAudio + 절차적 엔진/효과음/BGM + `speedToEnginePitch` named export. THREE 비의존 |
| `src/audio.test.js` | **신규** | 순수 매핑 + DI mock + 노드 생성/게이팅/idempotent/no-op 케이스 |
| `src/main.js` | **수정** | import, `audio.resume()`(첫 keydown), `KeyM` 음소거, gunShot/missileFire/explosion/lockWarn 결선, 매 프레임 `audio.update` |
| `mds/INDEX.md` | (커밋 단계 일괄) | 이 노트에서는 **수정하지 않음** |
| 에셋 | **없음** | M10은 절차적만 → ogg/라이선스/CREDITS 불필요. (선택 BGM 샘플 채택 시에만 README CREDITS 추가) |

---

## 비고 / 결정 사항
- **절차적 합성 전면 채택** → 에셋 0, 라이선스 부담 0, 항상 동작(폴백 불필요). driving_game은 엔진/변속에 ogg를 썼지만, 도그파이트 효과음(총·미사일·경고·폭발)은 절차적이 더 자연스럽고 연타에 강함.
- **2P 공용 엔진 1개** + 두 기체 속도 대표값으로 피치 변조 → 단순·충분. 분할화면이라 좌우 독립 엔진의 이득 적음.
- 엔진은 **배경 험**(낮은 게인 + lowpass)으로 깔고, 효과음/경고를 명확히 들리게 음량 위계: SFX > music > engine.
- 자동재생 정책: `AudioContext`는 첫 제스처(keydown / M11 시작 click)에서 생성·resume. 그 전 호출은 no-op.
- 음소거 `KeyM` → P2 플레어는 `RightCtrl`로 확정(M11 입력과 조율).
- 코딩 스타일: ES 모듈, camelCase, UPPER_SNAKE 상수, 2-space, 한국어 주석(CGs 관례). 순수 매핑(`speedToEnginePitch`)만 분리 테스트, 나머지는 DI mock.
