# M3 완료 — 고정 설계맵 지형(단일 표면)

## 구현

- `src/terrain.js` (신규, 순수): `FEATURES`(섬 4·산 3·고산 peak 2)·`BRIDGES`(능선 띠 2). `heightAt(x,z)`=봉우리 가우시안(σ=radius/2) max 다리(선분 최단거리). `terrainCollision(x,y,z,margin=CRASH_MARGIN)`(수면 y≤0 포함)·`isInsideTerrain`(지형만)·`heightToColorHex`·`MAX_TERRAIN_HEIGHT`. 월드 밖 0 수렴, 결정론. 스폰 구역은 봉우리 없음(즉사 방지).
- `src/render/terrainMesh.js` (신규): `buildTerrain()` 단일 PlaneGeometry(8000m·400분할) 정점 y=heightAt + vertexColors.
- `src/main.js`: buildTerrain 결선(기존 바다 평면·GridHelper 제거), 하늘/fog 유지.

## 깜빡임(z-fighting) 해결 — 단일 표면 방식

- 1차(반투명 해수면 y=0.3) → 사막 비침+물가 깜빡임. 2차(불투명 y=2)·3차(polygonOffset) 후에도 물가 잔깜빡임.
- **최종: 해수면 평면 제거**, 바다를 지형 메시 저지대(h<2) **물색(0x1e6fb0)**으로 표현. 두 면이 안 겹쳐 z-fighting 원천 제거. 지형을 8000m로 넓혀 물이 수평선(fog)까지.
- `heightToColorHex`: h<2 물 → h<6 모래 → 풀 → 진한 풀 → 바위 → 회색바위 → 설산. (테스트 부등호 단언 유지)

## 테스트

- `src/terrain.test.js`(31) — heightAt(섬>0/바다≈0/고산>산/단조/월드밖 안전/결정론), terrainCollision(공중 false·내부/수면 true·margin·스폰 안전), heightToColorHex 구간.
- 전체: **172 passed**. build 성공.

## 검증

- 단위 테스트 그린. 수동: 섬·산·설산·다리·바다 표시, 물가 깜빡임 완전 해소, 스폰 즉사 없음.

## 연결

- M8 충돌 즉사가 terrainCollision 사용. M5+ 무기.

## 설계

- [design/m3-terrain.md](../design/m3-terrain.md)
