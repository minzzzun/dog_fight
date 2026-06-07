# M11 완료 — 시작화면(색 선택) + 결과창/재대결

## 구현

- `src/colors.js` (신규, 순수): `PLANE_COLORS` 6색({id,name,hex}), `colorById`, `canStart(c1,c2)`(둘 다 선택+상이).
- `src/render/marker.js`: `setColor(hex)` 추가(빔/다이아 색 갱신).
- `index.html`/`src/style.css`: 시작 오버레이(P1/P2 색 스와치 6개, 중복 비활성, 시작 버튼) + 결과 오버레이(승자 + 재대결/색다시).
- `src/main.js` 대규모 리팩터:
  - 영속(renderer/scene/지형/조명/카메라/풀/마커/HUD/오디오/입력) vs 매치별 재생성(plane·메시·gun/launcher/disp·발사체·combat) 분리.
  - `startMatch(c1hex,c2hex)`: 기체/메시(buildPlane 색)/무기/combat 리셋, 마커 setColor+표시, sessionState='fighting', audio.resume.
  - 상태기계 `sessionState ∈ select|fighting|result`. 'fighting'에서만 stepFight(입력·비행·무기·전투). select/result는 렌더만(기본 카메라). plane null 가드.
  - 시작화면: 스와치 클릭 selected[2], 상대 선택색 disabled, canStart 시 시작 버튼 활성. 결과: showResult(winner) → 재대결(같은 색 startMatch)/색다시(showStartScreen+clearMatch).

## 테스트

- `src/colors.test.js`(13) — 팔레트 6색·hex·유일·기존색 포함, colorById, canStart 중복불가.
- 전체: **396 passed**. build 성공.

## 검증

- 단위 테스트 그린. 수동: 색 선택 중복불가→시작, 대결, 격추→결과창 재대결/색다시, 색·마커·HUD·사운드 정상.

## 설계

- [design/m11-start-result.md](../design/m11-start-result.md)
