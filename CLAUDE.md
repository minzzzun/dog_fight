# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **2인 로컬 분할화면 공중전(도그파이트) 게임** — 한 화면을 좌(P1)/우(P2) 2뷰포트로 나눠 각자 비행기를 3인칭 추격 시점으로 조종하고, 기관총·유도미사일·플레어로 상대를 격추하는 아케이드 WebGL 게임. 고정 설계맵(바다·섬·산·다리) 위에서 단판 대결한다.

---

## ⚠️ 작업 진입 규약 (반드시 먼저)

무엇이든 작업하기 전에 **이 순서**를 따른다:

1. **`CLAUDE.md`** (이 문서) — 전체 규칙·명령·스타일 확인
2. **`mds/INDEX.md`** — 문서 목차에서 관련 항목 탐색
3. **관련 `.md` 문서** (`mds/spec/`, `mds/design/`, `mds/done/`) — 해당 기능의 명세·설계·완료 노트 확인
4. 그 후 작업 진행

명세의 단일 진실 원천(SSoT)은 **`mds/spec/seed.md`**. 구현은 그 ACCEPTANCE_CRITERIA를 충족해야 한다.

## 개발 방식

- **SDD**: `mds/spec/seed.md`의 명세를 기준으로 개발. 명세와 충돌하면 명세 우선.
- **TDD**: 기능마다 `기획 → 테스트 설계 → 구현 → 단위 테스트 통과` 사이클. 순수 로직은 반드시 Vitest 테스트를 먼저/함께 작성.
- **기능 단위 커밋**: 기능 하나를 완성(테스트 그린)할 때마다 `git add` + `git commit`.
- **문서화**: 새 기능 설계는 `mds/design/<feature>.md`, 완료 노트는 `mds/done/`에 남기고 `mds/INDEX.md`를 갱신.

## 명령어

```bash
npm install        # 의존성 설치 (three, vite, vitest)
npm run dev        # Vite 개발 서버 (localhost:5173) — 분할화면 2P 대결 수동 확인
npm run build      # 프로덕션 번들 → dist/
npm test           # Vitest 단위 테스트 전체 실행
npm test -- <파일>  # 특정 테스트 파일만 실행 (예: npm test -- flight)
npm run test:watch # watch 모드 (TDD 중 사용)
```

## 아키텍처

게임 로직을 **테스트 가능한 순수 단위**와 **THREE 렌더 레이어**로 분리한다.

**순수 로직 (Three.js 비의존 · Vitest 단위 테스트 대상):**
- `src/flight.js` — 비행 모델: `step(dt, input)` → 위치/자세(quaternion 또는 yaw/pitch/roll) 적분, 아케이드 자동 수평 안정, 부스터/감속 속도 조절, 월드 경계 경고/강제 선회
- `src/input.js` — 2P 키 매핑(좌/우 분리) → 정규화된 입력 상태 객체 생성
- `src/terrain.js` — 고정 설계맵: `heightAt(x,z)`(바다·섬·산·다리), 지형/수면 충돌 질의 (결정론적 순수 함수)
- `src/weapons/gun.js` — 기관총: 탄 생성/이동/수명·사거리·명중 판정, 탄창/재장전, 데미지(-1)
- `src/weapons/missile.js` — 유도미사일: 락온(사거리/콘/시간) 판정, 유도 비행(선회율 제한), 데미지(-50), 플레어 회피 판정
- `src/weapons/flare.js` — 플레어: 전개·수명·반경 내 디코이, 잔량/쿨다운
- `src/combat.js` — 전투 상태: 체력(각 100), 지형/수면 충돌 즉사, 무기 명중 적용, 승패 판정

**렌더/통합 (Three.js 의존 · 수동·통합 검증):**
- `src/render/scene.js` — Scene/조명/스카이/바다, 분할화면 2뷰포트 + 각 뷰 3인칭 추격 카메라
- `src/render/planeMesh.js` — 기체 메시(색상 주입), 무기 발사 위치/락 콘 시각화
- `src/render/terrainMesh.js` — 고정맵 렌더(섬·산·다리·해수면)
- `src/render/hud.js` — 분할 HUD: 체력·탄약·미사일/플레어 잔량·락온·이탈 경고
- `src/audio.js` — Web Audio: 엔진음(루프) + 효과음(기관총·미사일발사·락온경고·폭발) + 음악 (절차적/샘플)
- `src/main.js` — 전체 결선 + 렌더 루프(분할 2뷰포트 렌더, 추격 카메라를 각 기체에 부착), 시작화면(색 선택)·결과창(재대결)

> 순수 로직은 `import * as THREE` 하지 않는다. {x,y,z} 같은 평범한 객체/숫자/배열만 입출력해 노드 환경에서 그대로 테스트한다. THREE 변환·메시·뷰포트는 렌더 레이어에서만.

## 코딩 스타일 (CGs 패밀리 관례)

- ES 모듈, camelCase 변수/함수, **UPPER_SNAKE 상수**, `_`접두 임시 벡터
- **2-space 들여쓰기, 한국어 주석**
- 렌더 루프: `requestAnimationFrame` + `Math.min(clock.getDelta(), 0.05)` 클램프
- 분할화면: `renderer.setScissorTest(true)` + 좌/우 `setViewport`/`setScissor`로 두 번 렌더
- 셰이더가 필요하면 인라인 GLSL `#version 300 es`

## 핵심 게임 규칙 (요약 — 상세는 `mds/spec/seed.md`)

- 분할화면 2P 로컬 대결: 좌=P1, 우=P2, 각 뷰 3인칭 추격 카메라
- 비행: 아케이드(자동 수평 안정·스톨 없음), 기본속도 일정 + 부스터/감속 키로 조절
- 월드 경계: 이탈 경고 → 더 나가면 보이지 않는 벽처럼 기체 강제 선회(경계 사망 없음)
- 체력 각 100, 0이면 사망. 지형/수면 충돌 시 폭발 즉사
- 기관총: 홀드 연사 ~12발/s, 탄창 100, 소진 시 재장전 3초, 명중당 -1
- 유도미사일: 2발, 명중 -50, 락온 2초·락 콘 ~15°, 최소~150m/최대~1200m 사거리, 플레어로 회피
- 플레어: 3발, 전개 후 일정 시간/반경 내 유도미사일 디코이, 쿨다운 ~5s
- 색 선택: 6색 중 각자 선택, **같은 색 불가**
- 대결 형식: 한 명 죽으면 결과창 → **재대결 버튼**(단판)
