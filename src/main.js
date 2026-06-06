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
import { createHud } from './render/hud.js';
import { createPlane, stepFlight } from './flight.js';
import { createInput, onKeyDown, onKeyUp, readInputs } from './input.js';
import { createGun, stepGun, stepBullets } from './weapons/gun.js';
import { terrainCollision } from './terrain.js';

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
const hud = createHud();   // 분할 HUD(탄약/재장전; M9에서 확장)

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

  const { p1, p2 } = readInputs(input);   // 프레임당 1회 (엣지 입력 1회만 소비)
  plane1 = stepFlight(plane1, p1, dt);
  plane2 = stepFlight(plane2, p2, dt);

  // ── 기관총: 발사(stepGun) → 공용 풀에 합류 → 이동·명중·소멸(stepBullets) ──
  const fire1 = stepGun(gun1, { firing: p1.gun, shooter: { ...plane1, owner: 0 } }, dt);
  gun1 = fire1.gun;
  const fire2 = stepGun(gun2, { firing: p2.gun, shooter: { ...plane2, owner: 1 } }, dt);
  gun2 = fire2.gun;
  if (fire1.bullets.length) bullets.push(...fire1.bullets);
  if (fire2.bullets.length) bullets.push(...fire2.bullets);

  const targets = [
    { owner: 0, x: plane1.x, y: plane1.y, z: plane1.z },
    { owner: 1, x: plane2.x, y: plane2.y, z: plane2.z },
  ];
  const stepped = stepBullets(bullets, dt, targets, bulletTerrain);
  bullets = stepped.bullets;
  // hits는 M8 combat에서 HP 적용 — 지금은 무시(필요 시 디버그 로그).
  // if (stepped.hits.length) console.log('hit', stepped.hits);

  applyPlaneTransform(meshP1, plane1);
  applyPlaneTransform(meshP2, plane2);
  syncBullets(bulletPool, bullets);   // 탄 트레이서 렌더 동기화
  hud.update(gun1, gun2);             // 탄약/재장전 표시

  applyChase(cameraL, plane1);   // 좌 = P1
  applyChase(cameraR, plane2);   // 우 = P2

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
