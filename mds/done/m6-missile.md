# M6 완료 — 유도미사일(락온·유도·플레어회피 준비)

## 구현

- `src/weapons/missile.js` (신규, 순수): 상수(MISSILE_AMMO 2/LOCK_TIME 2/LOCK_CONE≈0.262/MIN_RANGE 150/MAX_RANGE 1200/MISSILE_SPEED 250/MAX_TURN_RATE 2.2/MISSILE_LIFE 8/HIT_RADIUS 18/MUZZLE_OFFSET 10/MISSILE_DAMAGE 50/FLARE_DECOY_RADIUS 80). `canLock`(정면 콘 cos+사거리²), `createMissileLauncher`, `stepLock(launcher,{tryLock,shooter,target},dt)→{launcher,fired}`(엔벨로프 누적 2s→locked, 이탈 리셋, **수동 발사**: locked+엣지+ammo>0), `stepMissiles(missiles,dt,targets,flares,terrain?)→{missiles,hits}`(turnToward 선회율 제한 유도·수명/지형/명중 소멸·플레어 디코이 결정론), `turnToward`(로드리게스 분기로 180° 안전). 불변·결정론.
- `src/render/missileMesh.js` (신규): 원뿔 InstancedMesh 풀, 속도방향 회전, 소유자색.
- `src/render/hud.js`: `update(p1,p2)`({gun,launcher}) 일반화 — 미사일 잔량🚀·락온 %/🔒 추가, 탄약 유지.
- `src/main.js`: launcher1/2, 공용 missiles, flares=[](M7), 렌더루프 stepLock→발사→stepMissiles→syncMissiles→hud. hits 무시(M8).

## 테스트

- `src/weapons/missile.test.js`(51) — canLock(콘/사거리), 락온 2s 누적/리셋, 발사 2발 제한, 유도 선회율 제한·수렴, 명중 데미지50, 플레어 디코이, 수명/지형 소멸, 결정론/불변, turnToward.
- 전체: **258 passed**. build 성공.

## 검증

- 단위 테스트 그린. 수동: 정면 2초 락온→R/, 발사→유도 추적, 2발 제한.

## 연결

- M7 flares 공급→디코이 활성, M8 hits damage:50→HP, M9 HUD 락온/잔량.

## 설계

- [design/m6-missile.md](../design/m6-missile.md)
