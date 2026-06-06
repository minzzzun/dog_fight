# 📚 문서 목차 (INDEX)

> 작업 진입 규약: **CLAUDE.md → 이 INDEX → 관련 문서 → 진행**. 새 문서를 추가하면 여기에 한 줄로 등록한다.

## 명세 (spec) — SSoT
- [seed.md](spec/seed.md) — Ouroboros Seed 명세. GOAL·제약·ACCEPTANCE_CRITERIA·온톨로지·확정된 게임 디자인 결정·전투 수치·조작 바인딩.

## 설계 (design)
- [m0-scaffold.md](design/m0-scaffold.md) — 스캐폴드 + 분할 2뷰포트 렌더 설계.
- [m1-flight.md](design/m1-flight.md) — 아케이드 비행 모델(stepFlight) 설계.
- [m2-input.md](design/m2-input.md) — 2P 키 매핑(readInputs) 설계.

## 완료 노트 (done)
- [m0-scaffold.md](done/m0-scaffold.md) — M0 스캐폴드(Vite+Three+Vitest, splitViewports 분할 렌더), 41 테스트 그린.
- [m1-flight.md](done/m1-flight.md) — M1 아케이드 비행 모델(순수, 경계 강제선회), flight 테스트 42(전체 83 그린).
- [m2-input.md](done/m2-input.md) — M2 2P 키 매핑(순수, held/엣지), input 테스트 39(전체 122 그린).

## 진행 현황 (마일스톤)
| # | 마일스톤 | 상태 | 문서 |
|---|---|---|---|
| M-S | Ouroboros 인터뷰 → Seed 명세 | ✅ 완료 | [spec/seed.md](spec/seed.md) |
| M0 | 스캐폴드 (Vite+Three+Vitest, 분할 2뷰포트 렌더, 플레이스홀더 기체) | ✅ 완료 | [done/m0-scaffold.md](done/m0-scaffold.md) |
| M1 | flight.js 비행 모델(위치/자세·경계 경고/강제선회) + 테스트 | ✅ 완료 | [done/m1-flight.md](done/m1-flight.md) |
| M2 | input.js 2P 키 매핑 + 테스트 | ✅ 완료 | [done/m2-input.md](done/m2-input.md) |
| M3 | terrain.js 고정맵(heightAt/충돌질의) + 섬·산·다리·바다 렌더 | ⬜ 대기 | — |
| M4 | render(씬·분할 2추격카메라·기체 메시·스카이/바다) | ⬜ 대기 | — |
| M5 | weapons/gun.js 기관총(탄·재장전·데미지) + 테스트 | ⬜ 대기 | — |
| M6 | weapons/missile.js 유도미사일(락온·유도·데미지·플레어회피) + 테스트 | ⬜ 대기 | — |
| M7 | weapons/flare.js 플레어(전개·디코이) + 테스트 | ⬜ 대기 | — |
| M8 | combat.js 체력/사망/충돌(즉사·승패) + 테스트 | ⬜ 대기 | — |
| M9 | 분할 HUD(체력·탄약·미사일/플레어·락온·경계경고) | ⬜ 대기 | — |
| M10 | 사운드(엔진+효과음+음악) | ⬜ 대기 | — |
| M11 | 시작화면(색 선택 중복불가) + 결과창/재대결 | ⬜ 대기 | — |
| M12 | 마감/통합/ACCEPTANCE 검증 | ⬜ 대기 | — |
