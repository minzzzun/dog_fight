// M0 — 분할 2뷰포트 렌더 결선 (스캐폴드)
//
// 단일 WebGLRenderer + 단일 캔버스로 좌(P1)/우(P2) 두 번 그린다.
// 공유 Scene 1개를 두 카메라가 각자 시점으로 렌더한다.
// 게임 로직(비행/입력/무기)은 M1+. 여기선 플레이스홀더 기체 + 하늘/바다 배경만.
import * as THREE from 'three';
import { splitViewports } from './render/viewport.js';

// ══════════════════════════════════════════════════════════════
// 상수
// ══════════════════════════════════════════════════════════════
const FOV = 75;
const NEAR = 0.1;
const FAR = 5000;
const DELTA_CLAMP = 0.05;          // 렌더 루프 delta clamp (CGs 관례)
const SEA_SIZE = 8000;             // 바다 평면 한 변 길이(m)
const SKY_COLOR = 0x87ceeb;        // 하늘색
const SEA_COLOR = 0x1e6fb0;        // 바다색

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
// 배경 — 바다 평면 (y=0)
// ══════════════════════════════════════════════════════════════
const seaGeo = new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE);
const seaMat = new THREE.MeshStandardMaterial({
  color: SEA_COLOR,
  roughness: 0.4,
  metalness: 0.1,
});
const sea = new THREE.Mesh(seaGeo, seaMat);
sea.rotation.x = -Math.PI / 2;     // 수평면으로 눕힘
sea.position.y = 0;
scene.add(sea);

// ══════════════════════════════════════════════════════════════
// 플레이스홀더 기체 (P1 파랑 / P2 빨강)
//   - 콘(동체) + 박스(날개) 조합. 서로 다른 위치/색.
//   - +Z 가 기체 뒤쪽이 되도록 콘을 +Z 로 눕힌다(추격 카메라 배치 기준).
// ══════════════════════════════════════════════════════════════
function buildPlane(color) {
  const group = new THREE.Group();

  // 동체: 콘을 눕혀 기수가 -Z(전방)를 향하게 한다.
  const bodyGeo = new THREE.ConeGeometry(1.2, 6, 16);
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.rotation.x = -Math.PI / 2;  // 콘 축(+Y)을 -Z(전방)로 회전
  group.add(body);

  // 주익: 가로로 긴 얇은 박스.
  const wingGeo = new THREE.BoxGeometry(8, 0.3, 1.6);
  const wingMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2 });
  const wing = new THREE.Mesh(wingGeo, wingMat);
  wing.position.z = 0.5;
  group.add(wing);

  return group;
}

const planeP1 = buildPlane(0x2266ff);
planeP1.position.set(-40, 120, 0);
scene.add(planeP1);

const planeP2 = buildPlane(0xff3322);
planeP2.position.set(40, 120, 0);
scene.add(planeP2);

// ══════════════════════════════════════════════════════════════
// 카메라 2개 (P1/P2) — 기체 뒤·위 고정 오프셋 추격 흉내
//   aspect = 절반 폭 / 높이 (분할로 가로가 절반이 됨)
// ══════════════════════════════════════════════════════════════
const CHASE_OFFSET = new THREE.Vector3(0, 8, 20);  // 기체 뒤(+Z)·위(+Y)

function makeCamera() {
  const aspect = (window.innerWidth / 2) / window.innerHeight;
  return new THREE.PerspectiveCamera(FOV, aspect, NEAR, FAR);
}

const cameraL = makeCamera();
const cameraR = makeCamera();

// 카메라를 해당 기체 뒤·위에 두고 기체를 바라본다.
function placeChaseCamera(camera, plane) {
  camera.position.copy(plane.position).add(CHASE_OFFSET);
  camera.lookAt(plane.position);
}

placeChaseCamera(cameraL, planeP1);
placeChaseCamera(cameraR, planeP2);

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
// 렌더 루프
// ══════════════════════════════════════════════════════════════
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), DELTA_CLAMP);

  // M0: 움직임 확인용 살짝 회전(게임 로직 없음).
  planeP1.rotation.y += dt * 0.3;
  planeP2.rotation.y -= dt * 0.3;

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
