# M12 완료 — 마감 / 통합 / ACCEPTANCE 검증

## 산출물

- `README.md` — 실행·조작·규칙·아키텍처·사운드·테스트.
- 경계 이탈 경고 HUD 추가(🧭) — AC "이탈 경고 HUD 표시" 충족(flight.warning → hud.bounds).

## ACCEPTANCE_CRITERIA 대조 (seed.md) — 전 항목 충족 ✅

- 분할화면 2뷰포트 3인칭 추격 — ✅ (viewport/chaseCamera/main)
- 2P 독립 조작 — ✅ (input KEYMAP, 충돌 없음)
- 아케이드 비행(자동 수평·부스터/감속) — ✅ (flight)
- 월드 경계 경고+강제 선회(사망 없음) — ✅ (flight.warning + hud 🧭)
- 기관총(연사·탄창100·재장전3s·명중-1·사거리) — ✅ (gun)
- 유도미사일(2발·-50·락온2s·콘15°·150~2000m·유도·소멸·0발 락온불가) — ✅ (missile)
- 플레어(3발·디코이·쿨다운, +시간 재장전) — ✅ (flare)
- 지형/수면 충돌 즉사 — ✅ (combat+terrain)
- 체력 0 사망 — ✅ (combat)
- 색 선택 중복불가 — ✅ (colors.canStart + 시작 UI)
- 결과창/재대결 — ✅ (main showResult/rematch)
- 고정 설계맵(바다·섬·산·고산·다리) — ✅ (terrain)
- HUD(체력바·탄약·미사일/플레어·락온·피락온·이탈경고) — ✅ (hud)
- 사운드(엔진·효과음·음악) — ✅ (audio, 절차적)
- 순수 로직 Vitest 단위 테스트 통과 — ✅ **396 passed**

## 추가 구현(범위 외 보강)

- 상대 방향 표시기(radar), 위치 마커(컬러 빔), 폭발/격추 이펙트, 록온 사각, 조준점, 미사일 가속 모델·박스+콘 메시, 코브라/애프터버너, 시간 재장전 표시, 사거리 2000.

## 검증

- `npm test` 396 그린, `npm run build` 성공(번들 ~553KB).

## 상태

**게임 완성.** M-S~M12 전 마일스톤 완료.
