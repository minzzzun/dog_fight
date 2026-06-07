# M13~M15 — 포스트 런치 추가 (미사일 연기·근접 록온 보정·낮밤 사이클)

게임 완성(M12) 이후 사용자 요청 3건을 구현. 전체 테스트 412 그린, 프로덕션 빌드 통과.

## M13 — 미사일 연기 트레일
- 신규 `src/render/missileTrail.js` — 회백색 퍼프 풀(`createMissileTrailPool`/`emitMissileTrail`/`stepMissileTrail`).
  - 저체력 `smoke`와 달리 떠오르지 않고 제자리에서 커지며 옅어짐(로켓 배기 잔류운). 수명 0.9s, 풀 256.
- `main.js`: 풀 생성 + 매 프레임 `stepMissileTrail`, `stepFight`에서 살아있는 미사일마다 꼬리(속도 반대 5m)에서 퍼프 방출.

## M14 — 근접 록온 보정 + 조준 보조(aim assist)
> 의도: 둘 다 가속/감속을 무제한으로 쓰는 근접전에서 조준이 어렵다 → 록온 완화 + 근접 시 기수를 서로 향하게 보조.
- **록온 보정(순수 로직 `weapons/missile.js`)**
  - `MIN_RANGE` 150 → **40**(근접 도그파이트 허용).
  - 거리비례 락 콘 추가: `effectiveLockCone(dist)` — `NEAR_RANGE(=40)` 이하 `LOCK_CONE_NEAR(45°)`, `FAR_RANGE(500)` 이상 `LOCK_CONE(15°)`, 사이 선형 보간. `canLock`이 이 콘을 사용.
  - 근접에서 서로 빠르게 스쳐도 넓은 콘으로 락을 유지·재획득하기 쉬워짐.
  - 테스트 갱신: `MIN_RANGE` 상수, 근거리(<MIN)→false/근접(100m)→true, 신규 `effectiveLockCone`·근접 콘 확대 describe. missile 테스트 51→61.
- **조준 보조(순수 로직 `flight.js`)**
  - `aimAssist(q, pos, target, dt, range, cone, rate)` — 상대가 `range` 이내 AND 기수 콘 `cone` 안일 때, 기수를 상대 방향으로 최소 회전축(forward×desired)으로 부드럽게 당김. 기본값 `ASSIST_RANGE(700m)`/`ASSIST_CONE(80°)`/`ASSIST_RATE(1.0)`.
  - 보정량 = 거리 비례(가까울수록 강함, `rate` 상한), 한 스텝에 목표각 초과 회전 금지(과회전 방지). 플레이어 조작(PITCH_RATE 1.2 등)보다 약해 "자동조준"이 아닌 "보조".
  - **장거리 보조(재교전 유도)**: 마지막 록온 이후 `NO_LOCK_ASSIST_TIME(30s, main.js)` 동안 아무도 록온을 못 잡으면 — 서로 멀리 떨어져 근접 보조도 못 받는 상황 — 거리·콘 제한을 풀어(`range=Infinity`, `cone=π`, `rate=ASSIST_LONG_RATE 0.6`) 양 기체를 천천히 서로 향하게 한다. 록온 발생 시 타이머 리셋. 정후방(180°) 회전축 퇴화는 폴백 축(up×forward)으로 처리.
  - `stepFlight(state, input, dt, assistTarget, assistOpts)` 로 결선. `main.js`가 살아있는 상대 위치 + (장거리일 때) opts를 넘김.
  - 테스트: 범위·콘 안→각 감소, 범위 밖/후방→보조 없음, null→불변, 큰 dt 과회전 방지, 무제한·전방향 모드(먼 상대/정후방/stepFlight 결선). flight 테스트 22→31.
  - (속도 게이지 HUD는 사용자 피드백으로 폐기 — 조준 보조로 대체.)

## M15 — 낮밤 사이클 + 항법등
- 신규 순수 모듈 `src/daynight.js` + `daynight.test.js`(10).
  - `PHASE_DURATION=90`, 순서 `['day','evening','night','morning']`, `CYCLE=360`.
  - 밤 팔레트는 사용자 피드백으로 더 어둡게 조정(sky≈(0.01,0.018,0.05), hemi 0.10/dir 0.12).
  - `dayNightState(elapsed)` → `{ phase, phaseIndex, isNight, sky{r,g,b}, hemiIntensity, dirIntensity, dirColor{r,g,b} }`. 네 키프레임 팔레트를 단계 진행도로 선형 보간(부드러운 전환). 음수/초과 시간 래핑.
  - `isNight` = `dirIntensity < NIGHT_LIGHT_THRESHOLD(0.5)` — 저녁 후반~밤에 true.
- `render/planeMesh.js`: 항법등 그룹(`navlights`) 추가 — 좌현(x=-4) 적색·우현(x=+4) 녹색 발광구, 기본 off. `setNavLights(mesh, on)`.
- `main.js`: `worldTime` 누적(매치 시작 시 0=낮, fighting 중에만 진행). 매 프레임 `dayNightState`로 `scene.background`/`fog.color`/`hemiLight.intensity`/`dirLight.intensity·color` 적용, `isNight`면 양 기체 항법등 점등.

## 추가 폴리시 (후속 피드백)
- **미사일 비행음(`audio.js`)**: 루프 화이트노이즈→bandpass(700Hz)→`missileGain` 베드 추가. `missileFlight(on)`으로 공중 미사일 유무에 따라 게인 페이드(0↔0.16). `main.js`가 `missiles.length>0`로 매 프레임 토글. 비행기 격추/소멸로 미사일 0이면 자동 페이드아웃. 테스트: no-op 안전 + resume 후 on/off.
- **경기 타이머(`render/hud.js`)**: 화면 중앙 상단 `mm:ss`. `update(p1,p2,dt,matchTime)` 4번째 인자(=main `worldTime`)로 표시, `hideTimer()`로 시작화면 숨김. 대결 중 진행, 결과창에선 최종 시간 고정.
- **일시정지 메뉴(ESC)**: `sessionState`에 `'paused'` 추가. ESC로 `fighting`↔`paused` 토글. paused면 `animate`가 `stepFight`·`worldTime` 진행을 멈추고 렌더만 지속, `audio.suspend()`, 입력 무시(`input.down.clear()`). 오버레이(`index.html` `#pause-overlay`) 버튼: 재개/재시작(`startMatch`)/색변경(`showStartScreen`). 시작화면 키맵 안내는 기존 유지.
- **미사일 근접경보(`hud.js`+`audio.js`)**: 나를 추적 중(decoy 안 됨)인 적 미사일이 공중에 있으면(`m.target===i && !m.decoyed`) 각 절반에 🚀 회피 경고 깜빡임 + `audio.missileAlert(on)` 다급한 저음 beep(330 sawtooth, 0.22s 주기 — 락온 880 square와 구분). 테스트: no-op 안전 + resume 후 on/off+update.
- **AI 연습 모드(`ai.js` 신규 순수 + `ai.test.js` 12)**: `computeAIInput(self, target, {incoming, locked})` → 사람과 동일한 입력 스키마 산출(결정론·THREE 비의존). 전략: 뱅크/피치로 추격 정렬→정면·근거리면 기관총, 락 완료면 미사일, 미사일 추적 받으면 플레어, 뒤를 잡히면 풀뱅크+피치업 선회. `index.html`에 `#ai-toggle` 체크박스(켜면 P1만 색 선택, P2 자동색). `main.js`: `aiEnabled`면 `stepFight`에서 P2 입력 자리에 봇 입력 주입(상대=P1, incoming/locked는 직전 프레임 기준).

## 검증
- `npm test` → 15 파일 412 테스트 그린.
- `npm run build` → 정상 번들.
- 수동 확인 권장(`npm run dev`): 미사일 연기, 근접 락 용이성, 90초마다 시간대 전환·밤 항법등.
