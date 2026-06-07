// audio.js (M10) — 절차적 Web Audio 사운드 (엔진 + 효과음 + BGM)
//
// 에셋 0(전부 절차적 합성). AudioContext는 사용자 제스처(첫 키/시작) 시 resume()에서 생성.
// 그래프: engine(osc→lowpass→engineGain) / SFX(1회성 노드→sfxGain) / BGM(osc→musicGain)
//   → masterGain → destination. 음소거는 masterGain.
// 테스트 위해 AudioContextCtor 주입 가능(DI). resume 전 모든 호출 no-op 안전.
// 설계노트: mds/design/m10-audio.md

export const ENGINE_FREQ_MIN = 70;     // 엔진 험 최저 주파수(Hz)
export const ENGINE_FREQ_MAX = 200;    // 최고
export const LOCK_BEEP_INTERVAL = 0.4; // 피락온 경고 beep 주기(s)
export const GUN_MIN_INTERVAL = 0.05;  // 기관총 연사 게이팅 최소 간격(s)

// 속도 → 엔진 피치(순수, 70~200Hz 선형 clamp).
export function speedToEnginePitch(speed, maxSpeed = 210) {
  const t = Math.max(0, Math.min(1, speed / maxSpeed));
  return ENGINE_FREQ_MIN + t * (ENGINE_FREQ_MAX - ENGINE_FREQ_MIN);
}

export function createAudio(opts = {}) {
  const { AudioContextCtor, bgmUrl, maxSpeed = 210 } = opts;

  let ctx = null;
  let master = null, sfxBus = null, musicBus = null, engineGain = null, engineOsc = null;
  let muted = false;
  let lastGunTime = -Infinity;
  let lockOn = false;
  let beepTimer = 0;

  function resolveCtor() {
    if (AudioContextCtor) return AudioContextCtor;
    if (typeof window !== 'undefined') return window.AudioContext || window.webkitAudioContext || null;
    return null;
  }

  function now() { return ctx ? ctx.currentTime : 0; }

  function buildGraph() {
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.9;
    sfxBus.connect(master);

    musicBus = ctx.createGain();
    musicBus.gain.value = 0.25;
    musicBus.connect(master);

    // 엔진 베드: sawtooth → lowpass → engineGain
    engineGain = ctx.createGain();
    engineGain.gain.value = 0.12;
    engineGain.connect(master);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    lp.connect(engineGain);
    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = ENGINE_FREQ_MIN;
    engineOsc.connect(lp);
    engineOsc.start();

    // BGM: 절차적 지속 osc(낮은 볼륨). bgmUrl 미주입 시 fetch 안 함.
    const bgmOsc = ctx.createOscillator();
    bgmOsc.type = 'triangle';
    bgmOsc.frequency.value = 110;
    const bgmGain = ctx.createGain();
    bgmGain.gain.value = 0.5;
    bgmOsc.connect(bgmGain);
    bgmGain.connect(musicBus);
    bgmOsc.start();
  }

  function resume() {
    const Ctor = resolveCtor();
    if (!Ctor) return;
    if (!ctx) { ctx = new Ctor(); buildGraph(); }
    if (ctx.resume) ctx.resume();
  }

  function suspend() {
    if (ctx && ctx.suspend) ctx.suspend();
  }

  function applyMute() {
    if (!master) return;
    master.gain.setTargetAtTime(muted ? 0 : 1, now(), 0.01);
  }
  function setMuted(v) { muted = !!v; applyMute(); }
  function toggleMute() { setMuted(!muted); }

  // 짧은 화이트노이즈 버퍼 소스 생성(게인 엔벨로프 포함). lowpass 옵션.
  function noiseBurst(durSec, gainVal, cutoff) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * durSec));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainVal, now());
    g.gain.exponentialRampToValueAtTime(0.001, now() + durSec);
    let tail = g;
    if (cutoff) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cutoff;
      src.connect(f); f.connect(g);
    } else {
      src.connect(g);
    }
    tail.connect(sfxBus);
    src.start();
    return src;
  }

  function gunShot() {
    if (!ctx || muted) return;
    if (now() - lastGunTime < GUN_MIN_INTERVAL) return;  // 연사 게이팅
    lastGunTime = now();
    noiseBurst(0.04, 0.5, 1800);
  }

  function missileFire() {
    if (!ctx || muted) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(900, now());
    osc.frequency.exponentialRampToValueAtTime(120, now() + 0.5);  // 하강 whoosh
    g.gain.setValueAtTime(0.4, now());
    g.gain.exponentialRampToValueAtTime(0.001, now() + 0.5);
    osc.connect(g); g.connect(sfxBus);
    osc.start();
    if (osc.stop) osc.stop(now() + 0.55);
  }

  function explosion(big = false) {
    if (!ctx || muted) return;
    const dur = big ? 0.8 : 0.4;
    const cutoff = big ? 400 : 900;   // big은 더 묵직(저역)
    noiseBurst(dur, big ? 0.9 : 0.6, cutoff);
  }

  // 격추(체력 0/추락) 전용 — 길고 묵직한 붐 + 하강 톤(드라마틱).
  function death() {
    if (!ctx || muted) return;
    noiseBurst(1.4, 1.0, 300);          // 긴 저역 붐
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(400, now());
    osc.frequency.exponentialRampToValueAtTime(40, now() + 1.2);  // 추락하듯 하강
    g.gain.setValueAtTime(0.5, now());
    g.gain.exponentialRampToValueAtTime(0.001, now() + 1.3);
    osc.connect(g); g.connect(sfxBus);
    osc.start();
    if (osc.stop) osc.stop(now() + 1.35);
  }

  function lockWarn(on) { lockOn = !!on; if (!on) beepTimer = 0; }

  function beep() {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 880;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, now());
    g.gain.exponentialRampToValueAtTime(0.001, now() + 0.12);
    osc.connect(g); g.connect(sfxBus);
    osc.start();
    if (osc.stop) osc.stop(now() + 0.13);
  }

  function update(state, dt) {
    if (!ctx) return;
    // 엔진 피치/게인
    const speed = state?.speed ?? 0;
    engineOsc.frequency.setTargetAtTime(speedToEnginePitch(speed, maxSpeed), now(), 0.08);
    // 피락온 경고 beep 게이팅
    if (lockOn && !muted) {
      beepTimer += dt;
      while (beepTimer >= LOCK_BEEP_INTERVAL) {
        beep();
        beepTimer -= LOCK_BEEP_INTERVAL;
      }
    }
  }

  return {
    resume, suspend, update,
    gunShot, missileFire, lockWarn, explosion, death,
    setMuted, toggleMute,
    get muted() { return muted; },
    get _ctx() { return ctx; },
  };
}
