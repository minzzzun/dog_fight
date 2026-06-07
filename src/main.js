// main.js — 전체 결선 + 게임 흐름(시작화면 색선택 → 대결 → 결과/재대결)
//
// 분할 2뷰포트 단일 렌더러. sessionState: 'select' | 'fighting' | 'result'.
//   - 영속: renderer/scene/지형/조명/카메라/풀(탄·미사일·플레어·폭발)/마커/HUD/오디오/입력.
//   - 매치마다 재생성: 기체 상태·메시·무기(gun/launcher/disp)·발사체 배열·combat.
//   startMatch(c1,c2)로 (재)초기화. 'fighting'일 때만 입력/비행/무기/전투 step.
import * as THREE from 'three';
import { splitViewports } from './render/viewport.js';
import { buildPlane, applyPlaneTransform, setAfterburner } from './render/planeMesh.js';
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
import { createPlane, stepFlight, forwardOf, MAX_SPEED } from './flight.js';
import { createInput, onKeyDown, onKeyUp, readInputs } from './input.js';
import { createGun, stepGun, stepBullets } from './weapons/gun.js';
import { createMissileLauncher, stepLock, stepMissiles } from './weapons/missile.js';
import { createFlareDispenser, stepFlareDispenser, stepFlares } from './weapons/flare.js';
import { createAudio } from './audio.js';
import { terrainCollision } from './terrain.js';
import { createCombat, stepCombat, CRASH_MARGIN } from './combat.js';
import { PLANE_COLORS, colorById, canStart } from './colors.js';

// ══════════════════════════════════════════════════════════════ 상수
const FOV = 75, NEAR = 0.1, FAR = 5000, DELTA_CLAMP = 0.05;
const SKY_COLOR = 0x87ceeb;

// ══════════════════════════════════════════════════════════════ 영속 Three 초기화
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY_COLOR);
scene.fog = new THREE.Fog(SKY_COLOR, 1500, 4500);

scene.add(new THREE.HemisphereLight(0xffffff, 0x335577, 1.0));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(200, 400, 100);
scene.add(dirLight);

scene.add(buildTerrain());

// 영속 풀/마커/HUD/오디오/입력
const bulletPool = createBulletPool(scene);
const missilePool = createMissilePool(scene);
const flarePool = createFlarePool(scene);
const explosionPool = createExplosionPool(scene);
const markerP1 = createMarker(scene, 0x2266ff);
const markerP2 = createMarker(scene, 0xff3322);
markerP1.group.visible = false;
markerP2.group.visible = false;
const hud = createHud();
const lockReticle = createLockReticle();
const input = createInput();
const audio = createAudio({ maxSpeed: MAX_SPEED });

function makeCamera() {
  return new THREE.PerspectiveCamera(FOV, (window.innerWidth / 2) / window.innerHeight, NEAR, FAR);
}
const cameraL = makeCamera();
const cameraR = makeCamera();

const bulletTerrain = (x, y, z) => terrainCollision(x, y, z, 0);

// ══════════════════════════════════════════════════════════════ 매치 상태(재생성)
let sessionState = 'select';   // 'select' | 'fighting' | 'result'
let plane1 = null, plane2 = null, meshP1 = null, meshP2 = null;
let gun1, gun2, launcher1, launcher2, disp1, disp2;
let bullets = [], missiles = [], flares = [];
let combat = null;
let prevAlive = [true, true];
let abPhase = 0;
// 타격감/FOV — 플레이어별 화면 흔들림·히트마커 타이머·부스터 상태
const shake = [0, 0];        // 카메라 흔들림 세기(피격 시 증가, 매 프레임 감쇠)
const hitFlash = [0, 0];     // 히트마커(상대 명중) 잔여 시간
const boosting = [false, false];
const HITFLASH_TIME = 0.12, SHAKE_HIT = 1.2, SHAKE_DEATH = 5;
const BOOST_FOV = 90, FOV_LERP = 4;
let lastColors = [0x2266ff, 0xff3322];

function disposeMesh(mesh) {
  if (!mesh) return;
  scene.remove(mesh);
  mesh.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
}

// 매치 (재)초기화 — 색 hex 두 개로 기체/메시/무기/전투 리셋.
function startMatch(c1hex, c2hex) {
  lastColors = [c1hex, c2hex];
  plane1 = createPlane({ x: -100, y: 300, z: 300, yaw: Math.PI });  // 서로 마주봄
  plane2 = createPlane({ x: 100, y: 300, z: -300, yaw: 0 });

  disposeMesh(meshP1); disposeMesh(meshP2);
  meshP1 = buildPlane(c1hex); meshP2 = buildPlane(c2hex);
  scene.add(meshP1); scene.add(meshP2);

  markerP1.setColor(c1hex); markerP2.setColor(c2hex);
  markerP1.group.visible = true; markerP2.group.visible = true;

  gun1 = createGun(); gun2 = createGun();
  launcher1 = createMissileLauncher(); launcher2 = createMissileLauncher();
  disp1 = createFlareDispenser(); disp2 = createFlareDispenser();
  bullets = []; missiles = []; flares = [];
  combat = createCombat();
  prevAlive = [true, true];

  sessionState = 'fighting';
  audio.resume();
}

function clearMatch() {
  disposeMesh(meshP1); disposeMesh(meshP2);
  meshP1 = meshP2 = plane1 = plane2 = null;
  bullets = []; missiles = []; flares = [];
  markerP1.group.visible = false; markerP2.group.visible = false;
}

// ══════════════════════════════════════════════════════════════ 시작화면 UI
const startOverlay = document.getElementById('start-overlay');
const resultOverlay = document.getElementById('result-overlay');
const resultTitle = document.getElementById('result-title');
const startBtn = document.getElementById('start-btn');
const selected = [null, null];  // 각 플레이어가 고른 color id

function buildSwatches(containerId, playerIdx) {
  const box = document.getElementById(containerId);
  box.innerHTML = '';
  for (const c of PLANE_COLORS) {
    const sw = document.createElement('div');
    sw.className = 'swatch';
    sw.style.background = '#' + c.hex.toString(16).padStart(6, '0');
    sw.dataset.id = c.id;
    sw.addEventListener('click', () => {
      if (selected[1 - playerIdx] === c.id) return;  // 상대가 고른 색 불가
      selected[playerIdx] = c.id;
      refreshSwatches();
    });
    box.appendChild(sw);
  }
}

function refreshSwatches() {
  for (let p = 0; p < 2; p++) {
    const box = document.getElementById(p === 0 ? 'p1-colors' : 'p2-colors');
    for (const sw of box.children) {
      const id = sw.dataset.id;
      sw.classList.toggle('selected', selected[p] === id);
      sw.classList.toggle('disabled', selected[1 - p] === id);  // 상대 선택색 비활성
    }
  }
  startBtn.disabled = !canStart(selected[0], selected[1]);
}

function showStartScreen() {
  clearMatch();
  sessionState = 'select';
  resultOverlay.classList.add('hidden');
  startOverlay.classList.remove('hidden');
  refreshSwatches();
}

buildSwatches('p1-colors', 0);
buildSwatches('p2-colors', 1);
refreshSwatches();

startBtn.addEventListener('click', () => {
  if (!canStart(selected[0], selected[1])) return;
  startOverlay.classList.add('hidden');
  startMatch(colorById(selected[0]).hex, colorById(selected[1]).hex);
});

document.getElementById('rematch-btn').addEventListener('click', () => {
  resultOverlay.classList.add('hidden');
  startMatch(lastColors[0], lastColors[1]);  // 같은 색 재대결
});
document.getElementById('recolor-btn').addEventListener('click', showStartScreen);

function showResult(winner) {
  resultTitle.textContent = winner === 0 ? 'P1 승리' : winner === 1 ? 'P2 승리' : '무승부';
  resultOverlay.classList.remove('hidden');
  sessionState = 'result';
}

// ══════════════════════════════════════════════════════════════ 입력 결선
window.addEventListener('keydown', (e) => {
  audio.resume();
  if (e.code === 'Backquote') audio.toggleMute();  // ` 음소거 (M은 P2 플레어)
  if (onKeyDown(input, e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  if (onKeyUp(input, e.code)) e.preventDefault();
});

// ══════════════════════════════════════════════════════════════ 카메라/렌더 헬퍼
function applyChase(camera, plane) {
  const pose = chaseCameraPose(plane);
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  camera.up.set(pose.up.x, pose.up.y, pose.up.z);
  camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
}

// 부스터 시 FOV 확대(스피드감). 매 프레임 목표 FOV로 보간.
function applyFov(camera, boost, dt) {
  const target = boost ? BOOST_FOV : FOV;
  const k = Math.min(1, FOV_LERP * dt);
  camera.fov += (target - camera.fov) * k;
  camera.updateProjectionMatrix();
}

// 피격 화면 흔들림 — 카메라 위치를 세기만큼 랜덤 오프셋(applyChase 이후 호출).
function applyShake(camera, intensity) {
  if (intensity <= 0) return;
  camera.position.x += (Math.random() - 0.5) * intensity;
  camera.position.y += (Math.random() - 0.5) * intensity;
  camera.position.z += (Math.random() - 0.5) * intensity;
}

// 매치 전(select) 배경용 기본 카메라 — 지형 상공에서 내려다봄.
function defaultCamera(camera) {
  camera.up.set(0, 1, 0);
  camera.position.set(0, 700, 1400);
  camera.lookAt(0, 0, 0);
}

function renderViews() {
  const [vpL, vpR] = splitViewports(window.innerWidth, window.innerHeight);
  renderer.setScissorTest(true);
  renderer.setViewport(vpL.x, vpL.y, vpL.w, vpL.h);
  renderer.setScissor(vpL.x, vpL.y, vpL.w, vpL.h);
  renderer.render(scene, cameraL);
  renderer.setViewport(vpR.x, vpR.y, vpR.w, vpR.h);
  renderer.setScissor(vpR.x, vpR.y, vpR.w, vpR.h);
  renderer.render(scene, cameraR);
}

// ══════════════════════════════════════════════════════════════ 렌더 루프
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), DELTA_CLAMP);

  if (sessionState === 'fighting') stepFight(dt);

  stepExplosions(explosionPool, dt);

  // 타격감/FOV 타이머 감쇠
  shake[0] = Math.max(0, shake[0] - dt * 4);
  shake[1] = Math.max(0, shake[1] - dt * 4);
  hitFlash[0] = Math.max(0, hitFlash[0] - dt);
  hitFlash[1] = Math.max(0, hitFlash[1] - dt);

  if (plane1 && plane2) {
    applyPlaneTransform(meshP1, plane1);
    applyPlaneTransform(meshP2, plane2);
    syncBullets(bulletPool, bullets);
    syncMissiles(missilePool, missiles);
    syncFlares(flarePool, flares);
    markerP1.update(plane1.x, plane1.y, plane1.z);
    markerP2.update(plane2.x, plane2.y, plane2.z);

    const ind1 = targetIndicator(plane1, plane2);
    const ind2 = targetIndicator(plane2, plane1);
    const lockedBy0 = { locking: launcher2.lockTarget === 0 && launcher2.lockTimer > 0 && !launcher2.locked, locked: launcher2.lockTarget === 0 && launcher2.locked };
    const lockedBy1 = { locking: launcher1.lockTarget === 1 && launcher1.lockTimer > 0 && !launcher1.locked, locked: launcher1.lockTarget === 1 && launcher1.locked };
    hud.update(
      { gun: gun1, launcher: launcher1, dispenser: disp1, target: ind1, hp: combat.players[0].hp, lockedBy: lockedBy0, bounds: plane1.warning, speed: plane1.speed, alt: plane1.y, hitMarker: hitFlash[0] > 0 },
      { gun: gun2, launcher: launcher2, dispenser: disp2, target: ind2, hp: combat.players[1].hp, lockedBy: lockedBy1, bounds: plane2.warning, speed: plane2.speed, alt: plane2.y, hitMarker: hitFlash[1] > 0 },
      dt,
    );
    audio.lockWarn(lockedBy0.locked || lockedBy0.locking || lockedBy1.locked || lockedBy1.locking);
    audio.update({ speed: Math.max(plane1.speed, plane2.speed) }, dt);

    // 부스터 시 FOV 확대(스피드감) — 플레이어별 카메라
    applyFov(cameraL, boosting[0], dt);
    applyFov(cameraR, boosting[1], dt);

    applyChase(cameraL, plane1);
    applyChase(cameraR, plane2);
    applyShake(cameraL, shake[0]);   // 피격 흔들림
    applyShake(cameraR, shake[1]);
    cameraL.updateMatrixWorld(); cameraR.updateMatrixWorld();
    lockReticle.update(
      { camera: cameraL, target: plane2, launcher: launcher1 },
      { camera: cameraR, target: plane1, launcher: launcher2 },
      window.innerWidth, window.innerHeight,
    );
  } else {
    defaultCamera(cameraL);
    defaultCamera(cameraR);
  }

  renderViews();
}

// 한 프레임 전투 적분(입력→비행→무기→전투). 'fighting' 일 때만 호출.
function stepFight(dt) {
  const { p1, p2 } = readInputs(input);
  const a0 = combat.players[0].alive;
  const a1 = combat.players[1].alive;

  if (a0) plane1 = stepFlight(plane1, p1, dt);
  if (a1) plane2 = stepFlight(plane2, p2, dt);

  abPhase += dt;
  setAfterburner(meshP1, a0 && p1.boost, abPhase);
  setAfterburner(meshP2, a1 && p2.boost, abPhase);

  const fire1 = stepGun(gun1, { firing: a0 && p1.gun, shooter: { ...plane1, owner: 0 } }, dt);
  gun1 = fire1.gun;
  const fire2 = stepGun(gun2, { firing: a1 && p2.gun, shooter: { ...plane2, owner: 1 } }, dt);
  gun2 = fire2.gun;
  if (fire1.bullets.length) bullets.push(...fire1.bullets);
  if (fire2.bullets.length) bullets.push(...fire2.bullets);
  if (fire1.bullets.length || fire2.bullets.length) audio.gunShot();

  const targets = [
    { owner: 0, x: plane1.x, y: plane1.y, z: plane1.z, alive: a0 },
    { owner: 1, x: plane2.x, y: plane2.y, z: plane2.z, alive: a1 },
  ];
  const stepped = stepBullets(bullets, dt, targets, bulletTerrain);
  bullets = stepped.bullets;

  const lock1 = stepLock(launcher1, { tryLock: a0 && p1.missile, shooter: { ...plane1, owner: 0 }, target: targets[1] }, dt);
  launcher1 = lock1.launcher;
  const lock2 = stepLock(launcher2, { tryLock: a1 && p2.missile, shooter: { ...plane2, owner: 1 }, target: targets[0] }, dt);
  launcher2 = lock2.launcher;
  if (lock1.fired) missiles.push(lock1.fired);
  if (lock2.fired) missiles.push(lock2.fired);
  if (lock1.fired || lock2.fired) audio.missileFire();

  const f1 = forwardOf(plane1);
  const d1 = stepFlareDispenser(disp1, { deploy: a0 && p1.flare, owner: 0, pos: { x: plane1.x, y: plane1.y, z: plane1.z }, vel: { x: f1.x * plane1.speed, y: f1.y * plane1.speed, z: f1.z * plane1.speed } }, dt);
  disp1 = d1.state; if (d1.flare) flares.push(d1.flare);
  const f2 = forwardOf(plane2);
  const d2 = stepFlareDispenser(disp2, { deploy: a1 && p2.flare, owner: 1, pos: { x: plane2.x, y: plane2.y, z: plane2.z }, vel: { x: f2.x * plane2.speed, y: f2.y * plane2.speed, z: f2.z * plane2.speed } }, dt);
  disp2 = d2.state; if (d2.flare) flares.push(d2.flare);
  flares = stepFlares(flares, dt);

  const steppedM = stepMissiles(missiles, dt, targets, flares, bulletTerrain);
  missiles = steppedM.missiles;
  for (const h of steppedM.hits) {
    if (h.position) { spawnExplosion(explosionPool, h.position.x, h.position.y, h.position.z, false); audio.explosion(false); }
  }

  const hits = [...stepped.hits, ...steppedM.hits];
  // 타격감: 맞은 쪽 화면 흔들림(데미지 비례), 쏜 쪽 히트마커 플래시
  for (const h of hits) {
    const tgt = typeof h.target === 'object' ? h.target.owner : h.target;
    if (tgt === 0 || tgt === 1) shake[tgt] = Math.min(SHAKE_HIT * 3, shake[tgt] + (h.damage >= 50 ? SHAKE_HIT : SHAKE_HIT * 0.2));
    if (h.owner === 0 || h.owner === 1) hitFlash[h.owner] = HITFLASH_TIME;
  }
  boosting[0] = combat.players[0].alive && p1.boost;
  boosting[1] = combat.players[1].alive && p2.boost;

  combat = stepCombat(combat, {
    hits,
    planes: [plane1, plane2],
    terrainFn: (x, y, z) => terrainCollision(x, y, z, CRASH_MARGIN),
    margin: CRASH_MARGIN,
  });

  const planes = [plane1, plane2];
  for (let i = 0; i < 2; i++) {
    if (prevAlive[i] && !combat.players[i].alive) {
      spawnExplosion(explosionPool, planes[i].x, planes[i].y, planes[i].z, true);
      audio.death();
      shake[i] = SHAKE_DEATH;   // 격추 시 큰 흔들림
    }
    prevAlive[i] = combat.players[i].alive;
  }

  if (combat.state === 'over') showResult(combat.winner);
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  const aspect = (window.innerWidth / 2) / window.innerHeight;
  cameraL.aspect = aspect; cameraL.updateProjectionMatrix();
  cameraR.aspect = aspect; cameraR.updateProjectionMatrix();
});

animate();
