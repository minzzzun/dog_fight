# 📚 문서 목차 (INDEX)

> 작업 진입 규약: **CLAUDE.md → 이 INDEX → 관련 문서 → 진행**. 새 문서를 추가하면 여기에 한 줄로 등록한다.

## 명세 (spec) — SSoT
- [seed.md](spec/seed.md) — Ouroboros Seed 명세. GOAL·제약·ACCEPTANCE_CRITERIA·온톨로지·확정된 게임 디자인 결정·전투 수치·조작 바인딩.

## 설계 (design)
- [m0-scaffold.md](design/m0-scaffold.md) — 스캐폴드 + 분할 2뷰포트 렌더 설계.
- [m1-flight.md](design/m1-flight.md) — 아케이드 비행 모델(stepFlight) 설계.
- [m2-input.md](design/m2-input.md) — 2P 키 매핑(readInputs) 설계.
- [m3-terrain.md](design/m3-terrain.md) — 고정 설계맵 지형(heightAt·충돌·단일표면 렌더) 설계.
- [m4-render.md](design/m4-render.md) — 렌더 결선(추격 카메라·기체 자세·분할 2뷰포트) 설계.
- [m5-gun.md](design/m5-gun.md) — 기관총(탄창·재장전·탄 명중판정) 설계.

## 완료 노트 (done)
- [m0-scaffold.md](done/m0-scaffold.md) — M0 스캐폴드(Vite+Three+Vitest, splitViewports 분할 렌더), 41 테스트 그린.
- [m1-flight.md](done/m1-flight.md) — M1 아케이드 비행 모델(순수, 경계 강제선회), flight 테스트 42(전체 83 그린).
- [m2-input.md](done/m2-input.md) — M2 2P 키 매핑(순수, held/엣지), input 테스트 39(전체 122 그린).
- [m4-render.md](done/m4-render.md) — M4 렌더 결선(추격 카메라·기체 자세·2P 조종)+조향 뱅크 수정, chaseCamera 테스트 19(전체 141 그린).
- [m3-terrain.md](done/m3-terrain.md) — M3 고정 지형(섬·산·다리, 단일표면 바다 z-fighting 해소), terrain 테스트 31(전체 172 그린).
- [m5-gun.md](done/m5-gun.md) — M5 기관총(탄 트레이서·재장전·탄약 HUD), gun 테스트 35(전체 207 그린).

## 진행 현황 (마일스톤)
| # | 마일스톤 | 상태 | 문서 |
|---|---|---|---|
| M-S | Ouroboros 인터뷰 → Seed 명세 | ✅ 완료 | [spec/seed.md](spec/seed.md) |
| M0 | 스캐폴드 (Vite+Three+Vitest, 분할 2뷰포트 렌더, 플레이스홀더 기체) | ✅ 완료 | [done/m0-scaffold.md](done/m0-scaffold.md) |
| M1 | flight.js 비행 모델(위치/자세·경계 경고/강제선회) + 테스트 | ✅ 완료 | [done/m1-flight.md](done/m1-flight.md) |
| M2 | input.js 2P 키 매핑 + 테스트 | ✅ 완료 | [done/m2-input.md](done/m2-input.md) |
| M3 | terrain.js 고정맵(heightAt/충돌질의) + 섬·산·다리·바다 렌더 | ✅ 완료 | [done/m3-terrain.md](done/m3-terrain.md) |
| M4 | render(씬·분할 2추격카메라·기체 메시·스카이/바다) | ✅ 완료 | [done/m4-render.md](done/m4-render.md) |
| M5 | weapons/gun.js 기관총(탄·재장전·데미지) + 테스트 | ✅ 완료 | [done/m5-gun.md](done/m5-gun.md) |
| M6 | weapons/missile.js 유도미사일(락온·유도·데미지·플레어회피) + 테스트 | ⬜ 대기 | — |
| M7 | weapons/flare.js 플레어(전개·디코이) + 테스트 | ⬜ 대기 | — |
| M8 | combat.js 체력/사망/충돌(즉사·승패) + 테스트 | ⬜ 대기 | — |
| M9 | 분할 HUD(체력·탄약·미사일/플레어·락온·경계경고) | ⬜ 대기 | — |
| M10 | 사운드(엔진+효과음+음악) | ⬜ 대기 | — |
| M11 | 시작화면(색 선택 중복불가) + 결과창/재대결 | ⬜ 대기 | — |
| M12 | 마감/통합/ACCEPTANCE 검증 | ⬜ 대기 | — |
