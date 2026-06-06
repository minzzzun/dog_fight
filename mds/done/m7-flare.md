# M7 완료 — 플레어(유도미사일 디코이)

## 구현

- `src/weapons/flare.js` (신규, 순수): 상수(FLARE_AMMO 3/FLARE_COOLDOWN 5/FLARE_LIFE 3/FLARE_RADIUS=missile.FLARE_DECOY_RADIUS/FLARE_DROP_SPEED). `createFlareDispenser()→{ammo,cooldown}`, `stepFlareDispenser(state,{deploy,owner,pos,vel?},dt)→{state,flare}`(deploy&&cooldown<=0&&ammo>0→flare{pos,life,radius,owner}·ammo--·cooldown=5), `stepFlares(flares,dt)→생존`(life 감소·만료 제거·위치 적분). 불변·결정론.
- `src/render/flareMesh.js` (신규): InstancedMesh 플레어 풀, 수명 페이드/스케일.
- `src/render/hud.js`: 플레어 잔량 ✦ 표시 추가.
- `src/main.js`: disp1/2 + 공용 flares, 렌더루프 stepFlareDispenser→stepFlares→**stepMissiles에 flares 전달(디코이 활성)**→syncFlares→hud.

## 테스트

- `src/weapons/flare.test.js`(24) — 전개/잔량/쿨다운, stepFlares 수명, flare 형태 정합, **missile 디코이 통합**(플레어로 미사일 빗나감), 결정론/불변.
- 전체: **290 passed**. build 성공.

## 검증

- 단위 테스트 그린. 수동: F/RCtrl 전개, ✦3 잔량·5s 쿨다운, 미사일이 플레어에 빗나감.

## 비고

- 무기 3종(기관총·미사일·플레어) 동작. HP 차감/사망은 M8.

## 설계

- [design/m7-flare.md](../design/m7-flare.md)
