# M10 완료 — 사운드(절차적 Web Audio)

## 구현

- `src/audio.js` (신규): 에셋 0(전부 절차적). `createAudio({AudioContextCtor,bgmUrl,maxSpeed})` → resume/suspend/update/gunShot/missileFire/lockWarn/explosion/death/setMuted/toggleMute/muted/_ctx.
  - 그래프: engine(saw→lowpass→engineGain)/SFX 1회성 노드→sfxBus/BGM osc→musicBus → masterGain→destination. 음소거=masterGain.
  - `speedToEnginePitch(speed,maxSpeed=210)` 순수(70~200Hz). 엔진 피치 update 변조.
  - 효과음: 기관총=노이즈버스트(GUN_MIN_INTERVAL 연사 게이팅), 미사일=하강 whoosh, 폭발=노이즈 붐(big 묵직), **격추(death)=긴 저역붐+하강 톤**, 피락온=update 주기 beep(LOCK_BEEP_INTERVAL). 음소거 시 효과음 노드 미생성.
  - AudioContext는 resume()(첫 키)에서 생성·idempotent, resume 전 no-op 안전. BGM 절차적(bgmUrl 미주입 시 fetch 안 함).
- `src/main.js` 결선: 첫 keydown→resume, **음소거 = Backquote(`)**(M은 P2 플레어라 회피). 기관총 발사→gunShot, 미사일 발사→missileFire, 미사일 명중→explosion(false), 격추/추락→death, 피락온→lockWarn, 매 프레임 update(엔진).

## 테스트

- `src/audio.test.js`(41) — speedToEnginePitch 순수, mute 토글, resume idempotent/no-op, 엔진 피치, gunShot 게이팅, missileFire 스윕, explosion big/small, lockWarn beep 게이팅, suspend, BGM 절차적. mock AudioContext DI.
- 전체: **388 passed**. build 성공.

## 검증

- 단위 테스트 그린. 수동: 엔진음·기관총·미사일·폭발·격추음·피락온 beep·BGM·` 음소거 확인.

## 설계

- [design/m10-audio.md](../design/m10-audio.md)
