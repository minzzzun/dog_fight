# M0 완료 — 프로젝트 스캐폴드 + 분할 2뷰포트 렌더

## 구현

- `package.json` — three ^0.184 / vite ^8 / vitest ^3.2.4, scripts(dev/build/preview/test/test:watch).
- `index.html` — 전체화면 canvas + module script(시작 오버레이는 M11).
- `src/style.css` — body margin 0, canvas 풀스크린.
- `src/render/viewport.js` (순수) — `splitViewports(width,height)` → [좌{0,0,floor(w/2),h}, 우{floor(w/2),0,w-floor(w/2),h}]. 폭 합=width(틈/겹침 0), Three 좌하단 원점.
- `src/main.js` — 단일 WebGLRenderer + 공유 Scene + 카메라 2개(P1/P2). 렌더 루프에서 splitViewports로 좌/우 setScissorTest+setViewport+setScissor 후 각 카메라 render. 플레이스홀더(하늘+바다 평면+기체 콘/박스, 추격 카메라), delta clamp, 리사이즈.

## 테스트

- `tests/smoke.test.js`(2), `tests/viewport.test.js`(39) — splitViewports 좌/우·폭합·홀짝 경계·y/h 규약.
- 전체: **41 passed**. `npm install`/`npm run build` 성공.

## 검증

- 단위 테스트 그린. 수동: 좌/우 분할(틈 없음), 하늘+바다, 양쪽 기체 렌더, 리사이즈 정상.

## 연결

- main 렌더 루프 플레이스홀더 자리에 M1 비행·M2 입력 결선. splitViewports는 M9 HUD 재사용.

## 설계

- [design/m0-scaffold.md](../design/m0-scaffold.md)
