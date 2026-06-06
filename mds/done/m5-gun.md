# M5 완료 — 기관총 + 탄 트레이서 + 탄약 HUD

## 구현

- `src/weapons/gun.js` (신규, 순수): 상수(MAG_SIZE 100/RELOAD_TIME 3/FIRE_RATE 12/FIRE_INTERVAL/GUN_DAMAGE 1/BULLET_SPEED 600/BULLET_LIFE 2/BULLET_RANGE/HIT_RADIUS 12/MUZZLE_OFFSET 8). `createGun`, `stepGun(gun,{firing,shooter},dt)→{gun,bullets}`(연사·탄창·재장전·쿨다운, forwardOf로 발사), `stepBullets(bullets,dt,targets,terrain?)→{bullets,hits}`(이동·수명/사거리·지형 소멸·명중 HIT_RADIUS²·자기/alive=false 제외). 불변·결정론.
  - 연사율: 쿨다운 carry-over 모델(`+= FIRE_INTERVAL`)로 고정 fps에서 정확히 12발/s(테스트 통과).
- `src/render/bulletMesh.js` (신규): InstancedMesh 탄 풀(드로콜 1), 소유자색(P1 청록/P2 주황). `createBulletPool`/`syncBullets`.
- `src/render/hud.js` (신규, 최소): 좌/우 분할 하단 탄약/재장전 표시. `createHud().update(gun1,gun2)`. (M9에서 체력·미사일·플레어 확장)
- `src/main.js`: gun1/gun2 + 공용 bullets, 렌더루프 stepGun→stepBullets→syncBullets→hud.update. hits는 M8에서 HP 적용(현재 무시).

## 테스트

- `src/weapons/gun.test.js`(35) — 연사 간격·탄창소진/재장전·발사 위치/방향·탄 이동/수명/사거리·명중 반경/자기제외·지형 소멸·결정론/불변.
- 전체: **207 passed**. build 성공.

## 검증

- 단위 테스트 그린. 수동: E/. 연사, 트레이서, 100발→3초 재장전, 탄약 HUD 표시.

## 연결

- M6 미사일(같은 탄/타깃 구조), M8 hits로 HP 차감/사망, M9 HUD 확장.

## 설계

- [design/m5-gun.md](../design/m5-gun.md)
