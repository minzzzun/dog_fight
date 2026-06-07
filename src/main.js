// M4 — 렌더 결선: 비행 + 입력 + 추격 카메라 (분할 2뷰포트)
//
// 단일 WebGLRenderer + 단일 캔버스로 좌(P1)/우(P2) 두 번 그린다.
// 공유 Scene 1개를 두 카메라가 각자 추격 시점으로 렌더한다.
//   - 입력: createInput + window keydown/keyup → readInputs(프레임당 1회)
//   - 비행: stepFlight(불변 반환) → applyPlaneTransform(메시 자세)
//   - 카메라: chaseCameraPose(자세 추종형 3인칭) → 각 카메라에 적용
// 무기/지형(섬·산)/HUD는 이후 마일스톤.
import * as THREE from 'three';
import { splitViewports } from './render/viewport.js';
import { buildPlane, applyPlaneTransform } from './render/planeMesh.js';
import { chaseCameraPose } from './render/chaseCamera.js';
import { buildTerrain } from './render/terrainMesh.js';
import { createBulletPool, syncBullets } from './render/bulletMesh.js';
import { createMissilePool, syncMissiles } from './render/missileMesh.js';
import { createFlarePool, syncFlares } from './render/flareMesh.js';
import { createMarker } from './render/marker.js';
import { createExplosionPool, spawnExplosion, stepExplosions } from './render/explosion.js';
import { createLockReticle } from './render/lockReticle.js';
import { createHud } from './render/hud.js';
import { targetIndicator } from './radar.js';
import { createPlane, stepFlight } from './flight.js';
import { createInput, onKeyDown, onKeyUp, readInputs } from './input.js';
import { createGun, stepGun, stepBullets } from './weapons/gun.js';
import { createMissileLauncher, stepLock, stepMissiles } from './weapons/missile.js';
import { createFlareDispenser, stepFlareDispenser, stepFlares } from './weapons/flare.js';
import { forwardOf } from './flight.js';
import { terrainCollision } from './terrain.js';
import { createCombat, stepCombat, CRASH_MARGIN } from './combat.js';

// ══════════════════════════════════════════════════════════════
// 상수
// ══════════════════════════════════════════════════════════════
const FOV = 75;
const NEAR = 0.1;
const FAR = 5000;
const DELTA_CLAMP = 0.05;          // 렌더 루프 delta clamp (CGs 관례)
const SKY_COLOR = 0x87ceeb;        // 하늘색

// ══════════════════════════════════════════════════════════════
// Three.js 초기화 — 단일 렌더러 / 단일 캔버스
// ══════════════════════════════════════════════════════════════
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// 공유 씬 + 하늘 배경
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY_COLOR);
scene.fog = new THREE.Fog(SKY_COLOR, 1500, 4500);

// ══════════════════════════════════════════════════════════════
// 조명 (최소 1쌍)
// ══════════════════════════════════════════════════════════════
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x335577, 1.0);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(200, 400, 100);
scene.add(dirLight);

// ══════════════════════════════════════════════════════════════
// 지형 — 고정 설계맵(섬·산·고산·다리). 단일 표면(바다=저지대 물색)이라 별도
//   해수면 평면 없음 → z-fighting 원천 제거. 공유 scene에 add해 두 카메라 노출.
// ══════════════════════════════════════════════════════════════
const terrain = buildTerrain();
scene.add(terrain);

// ══════════════════════════════════════════════════════════════
// 비행 상태 + 기체 메시 — 서로 마주보게 스폰(z를 ±300으로 벌림)
//   forward 규약상 yaw=0 → -Z. P1은 yaw=π(기수 +Z, 상대 쪽),
//   P2는 yaw=0(기수 -Z, 상대 쪽)으로 두면 양쪽 화면에 상대가 정면으로 보인다.
//   x를 ±100으로 살짝 어긋나게 두면 정면충돌 없이 스쳐 지나간다.
// ══════════════════════════════════════════════════════════════
let plane1 = createPlane({ x: -100, y: 300, z:  300, yaw: Math.PI }); // 기수 +Z
let plane2 = createPlane({ x:  100, y: 300, z: -300, yaw: 0 });       // 기수 -Z

const meshP1 = buildPlane(0x2266ff);  // P1 파랑
const meshP2 = buildPlane(0xff3322);  // P2 빨강
scene.add(meshP1);
scene.add(meshP2);

// ══════════════════════════════════════════════════════════════
// 기관총 (M5) — 플레이어별 총기 상태 + 공용 탄 풀(배열·렌더 인스턴스)
//   gun1/gun2: 순수 상태기계(stepGun). bullets: owner로 소속 구분하는 공용 배열.
//   명중당 HP 차감은 M8 combat 범위 — 여기선 발사·탄·명중판정·트레이서까지.
// ══════════════════════════════════════════════════════════════
let gun1 = createGun();
let gun2 = createGun();
let bullets = [];
const bulletPool = createBulletPool(scene);

// ══════════════════════════════════════════════════════════════
// 유도미사일 (M6) — 플레이어별 런처(락온 상태기계) + 공용 미사일 풀
//   launcher1/2: 순수 상태기계(stepLock). missiles: owner로 소속 구분하는 공용 배열.
//   명중당 HP 차감은 M8 combat 범위 — 여기선 락온·발사·유도·명중판정·플레어회피까지.
// ══════════════════════════════════════════════════════════════
let launcher1 = createMissileLauncher();
let launcher2 = createMissileLauncher();
let missiles = [];
const missilePool = createMissilePool(scene);

// ══════════════════════════════════════════════════════════════
// 플레어 (M7) — 플레이어별 디스펜서(전개·잔량·쿨다운) + 공용 flare 풀
//   disp1/2: 순수 상태기계(stepFlareDispenser). flares: owner로 소속 구분하는 공용 배열.
//   stepMissiles가 이 flares를 읽어 디코이 회피를 판정(미사일이 플레어에 빗나감).
// ══════════════════════════════════════════════════════════════
let disp1 = createFlareDispenser();
let disp2 = createFlareDispenser();
let flares = [];
const flarePool = createFlarePool(scene);

// 기체 위치 마커(컬러 빔) — 상대를 멀리서도 찾기 쉽게. 색=기체 색.
const markerP1 = createMarker(scene, 0x2266ff);  // P1 파랑
const markerP2 = createMarker(scene, 0xff3322);  // P2 빨강

const hud = createHud();   // 분할 HUD(탄약/재장전 + 미사일 잔량/락온 + 체력; M9에서 체력바 폴리시)

// ══════════════════════════════════════════════════════════════
// 전투 상태 (M8) — 체력/충돌/승패. stepCombat이 hits·충돌을 소비해 HP/생사 갱신.
//   combat.state==='over'면 비행/무기/입력 step을 멈추고 결과 오버레이를 1회 띄운다.
// ══════════════════════════════════════════════════════════════
let combat = createCombat();
let resultShown = false;   // 결과 오버레이 1회 표시 가드
let prevAlive = [true, true];  // 사망 전이 감지(폭발용)

// 폭발 이펙트 풀 + 록온 사각 표시
const explosionPool = createExplosionPool(scene);
const lockReticle = createLockReticle();

// 결과 오버레이(최소) — DOM 풀스크린. winner: 0(P1승)/1(P2승)/'draw'(무승부).
//   재대결 버튼 동작은 M11. 지금은 새로고침 안내로 충분.
function showResult(winner) {
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;' +
    'justify-content:center;gap:14px;background:rgba(0,0,0,0.6);' +
    'color:#fff;font-family:system-ui,monospace;z-index:100;pointer-events:none';
  let msg;
  if (winner === 0) msg = 'P1 승리';
  else if (winner === 1) msg = 'P2 승리';
  else msg = '무승부';
  const title = document.createElement('div');
  title.style.cssText = 'font-size:48px;font-weight:800;text-shadow:0 2px 8px rgba(0,0,0,0.8)';
  title.textContent = msg;
  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:18px;opacity:0.85';
  hint.textContent = '(M11에서 재대결 버튼 — 지금은 새로고침으로 재시작)';
  overlay.appendChild(title);
  overlay.appendChild(hint);
  document.body.appendChild(overlay);
}

// 지형/수면 충돌로 탄 소멸시키는 래퍼(탄은 점 → margin 0).
const bulletTerrain = (x, y, z) => terrainCollision(x, y, z, 0);

// ══════════════════════════════════════════════════════════════
// 입력 결선 (DOM ↔ input.js)
//   매핑된 키만 preventDefault(화살표 스크롤·Space 등 방지).
// ══════════════════════════════════════════════════════════════
const input = createInput();

window.addEventListener('keydown', (e) => {
  if (onKeyDown(input, e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  if (onKeyUp(input, e.code)) e.preventDefault();
});

// ══════════════════════════════════════════════════════════════
// 카메라 2개 (P1/P2) — 자세 추종형 3인칭 추격
//   aspect = 절반 폭 / 높이 (분할로 가로가 절반이 됨)
// ══════════════════════════════════════════════════════════════
function makeCamera() {
  const aspect = (window.innerWidth / 2) / window.innerHeight;
  return new THREE.PerspectiveCamera(FOV, aspect, NEAR, FAR);
}

const cameraL = makeCamera();
const cameraR = makeCamera();

// 추격 카메라 포즈를 카메라에 적용.
//   camera.up은 lookAt 전에 설정해야 lookAt이 그 up으로 회전을 잡는다(롤 반영). 순서 중요.
function applyChase(camera, plane) {
  const pose = chaseCameraPose(plane);
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  camera.up.set(pose.up.x, pose.up.y, pose.up.z);
  camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
}

// ══════════════════════════════════════════════════════════════
// 분할 2뷰포트 렌더
// ══════════════════════════════════════════════════════════════
function renderViews() {
  // setSize 에 CSS 픽셀(innerWidth/Height)을 넘겼으므로 동일 좌표계로 계산.
  const [vpL, vpR] = splitViewports(window.innerWidth, window.innerHeight);
  renderer.setScissorTest(true);

  // 좌(P1)
  renderer.setViewport(vpL.x, vpL.y, vpL.w, vpL.h);
  renderer.setScissor(vpL.x, vpL.y, vpL.w, vpL.h);
  renderer.render(scene, cameraL);

  // 우(P2)
  renderer.setViewport(vpR.x, vpR.y, vpR.w, vpR.h);
  renderer.setScissor(vpR.x, vpR.y, vpR.w, vpR.h);
  renderer.render(scene, cameraR);
}

// ══════════════════════════════════════════════════════════════
// 렌더 루프 — 입력 → 비행 적분 → 메시 자세 → 추격 카메라 → 분할 렌더
// ══════════════════════════════════════════════════════════════
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), DELTA_CLAMP);

  // 전투 종료 후엔 비행/무기/입력 적분을 멈추고 렌더만 계속(사망 후 조종/발사 정지).
  const fighting = combat.state !== 'over';

  if (fighting) {
    const { p1, p2 } = readInputs(input);   // 프레임당 1회 (엣지 입력 1회만 소비)

    // 죽은 기체는 비행/발사 정지. 무기 명중 후보에서도 제외(targets.alive 동기화).
    const p0Alive = combat.players[0].alive;
    const p1Alive = combat.players[1].alive;

    if (p0Alive) plane1 = stepFlight(plane1, p1, dt);
    if (p1Alive) plane2 = stepFlight(plane2, p2, dt);

    // ── 기관총: 발사(stepGun) → 공용 풀에 합류 → 이동·명중·소멸(stepBullets) ──
    const fire1 = stepGun(gun1, { firing: p0Alive && p1.gun, shooter: { ...plane1, owner: 0 } }, dt);
    gun1 = fire1.gun;
    const fire2 = stepGun(gun2, { firing: p1Alive && p2.gun, shooter: { ...plane2, owner: 1 } }, dt);
    gun2 = fire2.gun;
    if (fire1.bullets.length) bullets.push(...fire1.bullets);
    if (fire2.bullets.length) bullets.push(...fire2.bullets);

    // 죽은 기체는 alive=false → 무기 명중 후보에서 제외(stepBullets/stepMissiles가 무시).
    const targets = [
      { owner: 0, x: plane1.x, y: plane1.y, z: plane1.z, alive: p0Alive },
      { owner: 1, x: plane2.x, y: plane2.y, z: plane2.z, alive: p1Alive },
    ];
    const stepped = stepBullets(bullets, dt, targets, bulletTerrain);
    bullets = stepped.bullets;

    // ── 유도미사일: 락온(stepLock) → 발사 시 공용 풀 합류 → 유도·명중·소멸(stepMissiles) ──
    //   각 플레이어의 target은 상대 기체. missile 엣지(p*.missile)를 tryLock으로 전달.
    const lock1 = stepLock(launcher1, { tryLock: p0Alive && p1.missile, shooter: { ...plane1, owner: 0 }, target: targets[1] }, dt);
    launcher1 = lock1.launcher;
    const lock2 = stepLock(launcher2, { tryLock: p1Alive && p2.missile, shooter: { ...plane2, owner: 1 }, target: targets[0] }, dt);
    launcher2 = lock2.launcher;
    if (lock1.fired) missiles.push(lock1.fired);
    if (lock2.fired) missiles.push(lock2.fired);

    // ── 플레어: 전개(stepFlareDispenser) → 공용 풀 합류 → 수명관리(stepFlares) ──
    //   flare 키 엣지(p*.flare)를 deploy로 전달. vel은 기수방향×속력(전개 분리감용).
    const f1 = forwardOf(plane1);
    const d1 = stepFlareDispenser(disp1, {
      deploy: p0Alive && p1.flare, owner: 0,
      pos: { x: plane1.x, y: plane1.y, z: plane1.z },
      vel: { x: f1.x * plane1.speed, y: f1.y * plane1.speed, z: f1.z * plane1.speed },
    }, dt);
    disp1 = d1.state;
    if (d1.flare) flares.push(d1.flare);

    const f2 = forwardOf(plane2);
    const d2 = stepFlareDispenser(disp2, {
      deploy: p1Alive && p2.flare, owner: 1,
      pos: { x: plane2.x, y: plane2.y, z: plane2.z },
      vel: { x: f2.x * plane2.speed, y: f2.y * plane2.speed, z: f2.z * plane2.speed },
    }, dt);
    disp2 = d2.state;
    if (d2.flare) flares.push(d2.flare);

    flares = stepFlares(flares, dt);

    // 채워진 flares를 stepMissiles가 소비 → 디코이 회피 판정.
    const steppedM = stepMissiles(missiles, dt, targets, flares, bulletTerrain);
    missiles = steppedM.missiles;

    // ── 전투(M8): 기관총(-1)·미사일(-50) hits 합쳐 HP 적용 + 지형/수면 충돌 즉사 + 승패 ──
    const hits = [...stepped.hits, ...steppedM.hits];
    // 미사일 명중 위치에 폭발 이펙트
    for (const h of steppedM.hits) {
      if (h.position) spawnExplosion(explosionPool, h.position.x, h.position.y, h.position.z, false);
    }
    combat = stepCombat(combat, {
      hits,
      planes: [plane1, plane2],
      terrainFn: (x, y, z) => terrainCollision(x, y, z, CRASH_MARGIN),
      margin: CRASH_MARGIN,
    });

    // 사망 전이(격추/추락) → 기체 위치에 큰 폭발
    const planes = [plane1, plane2];
    for (let i = 0; i < 2; i++) {
      if (prevAlive[i] && !combat.players[i].alive) {
        spawnExplosion(explosionPool, planes[i].x, planes[i].y, planes[i].z, true);
      }
      prevAlive[i] = combat.players[i].alive;
    }

    // 전투 종료 → 결과 오버레이 1회 표시.
    if (combat.state === 'over' && !resultShown) {
      resultShown = true;
      showResult(combat.winner);
    }
  }

  stepExplosions(explosionPool, dt);   // 폭발 이펙트 갱신(종료 후에도 잔여 재생)

  applyPlaneTransform(meshP1, plane1);
  applyPlaneTransform(meshP2, plane2);
  syncBullets(bulletPool, bullets);       // 탄 트레이서 렌더 동기화
  syncMissiles(missilePool, missiles);    // 미사일 메시 렌더 동기화
  syncFlares(flarePool, flares);          // 플레어 디코이 메시 렌더 동기화
  markerP1.update(plane1.x, plane1.y, plane1.z);  // 위치 마커(상대 식별용)
  markerP2.update(plane2.x, plane2.y, plane2.z);
  // 상대 방향 표시기 — 각 플레이어가 본 상대 기체 방위·거리
  const ind1 = targetIndicator(plane1, plane2);
  const ind2 = targetIndicator(plane2, plane1);
  // 피락온 경고 — 내가 상대 런처의 락 대상이고 진행/완료면 경고. (p0은 launcher2, p1은 launcher1)
  const lockedBy0 = { locking: launcher2.lockTarget === 0 && launcher2.lockTimer > 0 && !launcher2.locked, locked: launcher2.lockTarget === 0 && launcher2.locked };
  const lockedBy1 = { locking: launcher1.lockTarget === 1 && launcher1.lockTimer > 0 && !launcher1.locked, locked: launcher1.lockTarget === 1 && launcher1.locked };
  hud.update(                             // 체력 + 탄약/재장전 + 미사일 잔량/락온 + 플레어 + 상대 방향 + 피락온 경고
    { gun: gun1, launcher: launcher1, dispenser: disp1, target: ind1, hp: combat.players[0].hp, lockedBy: lockedBy0 },
    { gun: gun2, launcher: launcher2, dispenser: disp2, target: ind2, hp: combat.players[1].hp, lockedBy: lockedBy1 },
    dt,
  );

  applyChase(cameraL, plane1);   // 좌 = P1
  applyChase(cameraR, plane2);   // 우 = P2

  // 록온 사각 — 각 플레이어 카메라로 상대 위치 투영해 박스 표시(락온 중/완료)
  cameraL.updateMatrixWorld();
  cameraR.updateMatrixWorld();
  lockReticle.update(
    { camera: cameraL, target: plane2, launcher: launcher1 },
    { camera: cameraR, target: plane1, launcher: launcher2 },
    window.innerWidth, window.innerHeight,
  );

  renderViews();
}

// ══════════════════════════════════════════════════════════════
// 리사이즈 — 렌더러 크기 + 각 카메라 aspect 갱신
// ══════════════════════════════════════════════════════════════
function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  const aspect = (window.innerWidth / 2) / window.innerHeight;
  cameraL.aspect = aspect;
  cameraL.updateProjectionMatrix();
  cameraR.aspect = aspect;
  cameraR.updateProjectionMatrix();
}

window.addEventListener('resize', onResize);

animate();
