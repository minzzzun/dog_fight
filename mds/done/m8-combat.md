# M8 완료 — 전투(체력/충돌/승패)

## 구현

- `src/combat.js` (신규, 순수): 상수 MAX_HP 100/CRASH_MARGIN 3. `createPlayer`/`createCombat`, `applyHits(combat,hits)`(hit.target 객체/인덱스 수용, damage 차감·0클램프·사망 cause 'hit'), `checkTerrainCrash(combat,planes,terrainFn,margin)`(충돌 즉사 cause 'crash'), `resolve`(한 명 사망→상대 승, 동시→draw, state over), `stepCombat`(통합). 불변·결정론, over/죽은 뒤 no-op.
- `src/main.js`: combat 결선 — gun+missile hits 합쳐 stepCombat, planes 충돌 질의(CRASH_MARGIN), targets.alive 동기화, state over면 비행/무기/입력 정지 + 결과 오버레이 1회.
- `src/render/hud.js`: 체력 ❤️ 한 줄 추가(M9에서 체력바 폴리시).

## 테스트

- `src/combat.test.js`(48) — applyHits(−1/−50/누적/클램프/사망/객체·인덱스 target/죽은뒤 무영향), checkTerrainCrash(즉사/정합), resolve(승/무승부/전이), stepCombat 통합·결정론·불변.
- 전체: **338 passed**. build 성공.

## 검증

- 단위 테스트 그린. 수동: 기관총 −1·미사일 −50·지형/수면 즉사·hp0 사망→결과 오버레이·동시 무승부.

## 연결

- M9 체력바, M11 결과창 재대결(winner/state 사용).

## 설계

- [design/m8-combat.md](../design/m8-combat.md)
