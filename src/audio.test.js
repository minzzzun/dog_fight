// audio.js 사운드 시스템 테스트 (M10) — TDD RED 단계
// 설계노트: mds/design/m10-audio.md
//
// 가정한 export 시그니처(설계노트 "공개 API" + §단위 테스트 설계 가이드 기준):
//   - export function createAudio(opts = {}) => {
//       resume(), suspend(),
//       update(state, dt),       // state: { speed, anyAlive? }
//       gunShot(), missileFire(), lockWarn(on), explosion(big = false),
//       setMuted(bool), toggleMute(), get muted(), get _ctx()
//     }
//     opts = { AudioContextCtor?, bgmUrl?, maxSpeed? }
//   - export function speedToEnginePitch(speed, maxSpeed = 210)
//   - export const ENGINE_FREQ_MIN  // = 70
//   - export const ENGINE_FREQ_MAX  // = 200
//   - export const LOCK_BEEP_INTERVAL  // 락온 경고 beep 주기(s), ≈ 0.4
//   - export const GUN_MIN_INTERVAL    // 연사 게이팅 최소 간격(s), ≈ 0.05
//
// 환경: vitest 기본(node) 환경이라 window/DOM/Web Audio가 없다.
//   → 가짜 AudioContext(AudioContextCtor)를 주입해 모킹한다.
//   → M10은 절차적 합성 전면 채택이라(에셋 0) 엔진/효과음/BGM이 모두
//     resume() 시점에 동기로 준비된다(엔진 osc start, BGM osc start).
//     bgmUrl 미주입 시 fetch/decodeAudioData를 타지 않는다.
//
// Mock 노드는 connect/start/stop + AudioParam(frequency/gain/detune/Q)을 가지며,
//   AudioParam은 setTargetAtTime/setValueAtTime/exponentialRampToValueAtTime/
//   linearRampToValueAtTime 스파이를 가진 { value } 객체.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createAudio,
  speedToEnginePitch,
  ENGINE_FREQ_MIN,
  ENGINE_FREQ_MAX,
  LOCK_BEEP_INTERVAL,
  GUN_MIN_INTERVAL,
} from './audio.js';

// 보류 중인 microtask/Promise 체인을 충분히 비운다(bgmUrl 비동기 경로 대비).
async function flushPromises() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

// ── 가짜 Web Audio 노드/컨텍스트 ───────────────────────────────

// AudioParam 모킹: { value } + 스케줄링 메서드 스파이
function makeParam(initial = 0) {
  return {
    value: initial,
    setTargetAtTime: vi.fn(function (target) {
      this._lastTarget = target;
    }),
    setValueAtTime: vi.fn(function (v) {
      this.value = v;
    }),
    exponentialRampToValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
}

class FakeGainNode {
  constructor() {
    this.gain = makeParam(1);
    this.connect = vi.fn();
    this.disconnect = vi.fn();
  }
}

class FakeOscillatorNode {
  constructor() {
    this.type = 'sine';
    this.frequency = makeParam(440);
    this.detune = makeParam(0);
    this.connect = vi.fn();
    this.disconnect = vi.fn();
    this.start = vi.fn();
    this.stop = vi.fn();
  }
}

class FakeBufferSourceNode {
  constructor() {
    this.buffer = null;
    this.loop = false;
    this.playbackRate = makeParam(1);
    this.connect = vi.fn();
    this.disconnect = vi.fn();
    this.start = vi.fn();
    this.stop = vi.fn();
  }
}

class FakeBiquadFilterNode {
  constructor() {
    this.type = 'lowpass';
    this.frequency = makeParam(350);
    this.Q = makeParam(1);
    this.gain = makeParam(0);
    this.connect = vi.fn();
    this.disconnect = vi.fn();
  }
}

class FakeAudioBuffer {
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this._data = new Float32Array(length);
  }
  getChannelData() {
    return this._data;
  }
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.state = 'suspended';
    this.destination = { _isDestination: true };

    this.createGain = vi.fn(() => new FakeGainNode());
    this.createOscillator = vi.fn(() => new FakeOscillatorNode());
    this.createBufferSource = vi.fn(() => new FakeBufferSourceNode());
    this.createBuffer = vi.fn((ch, len, sr) => new FakeAudioBuffer(ch, len, sr));
    this.createBiquadFilter = vi.fn(() => new FakeBiquadFilterNode());
    this.decodeAudioData = vi.fn(async () => new FakeAudioBuffer(2, 400000, 44100));
    this.resume = vi.fn(async () => {
      this.state = 'running';
    });
    this.suspend = vi.fn(async () => {
      this.state = 'suspended';
    });
  }
}

// 생성된 노드 헬퍼: spy.mock.results에서 노드 인스턴스 배열 추출
function nodesOf(spy) {
  return spy.mock.results.map((r) => r.value);
}

// 모든 gain 노드의 setTargetAtTime/setValueAtTime 타깃 인자들을 평탄화
function gainTargets(ctx) {
  return nodesOf(ctx.createGain).flatMap((g) => [
    ...g.gain.setTargetAtTime.mock.calls.map((c) => c[0]),
    ...g.gain.setValueAtTime.mock.calls.map((c) => c[0]),
  ]);
}

// fetch stub: bgmUrl 비동기 경로 테스트용
function fakeOkResponse() {
  return {
    ok: true,
    arrayBuffer: vi.fn(async () => new ArrayBuffer(8)),
  };
}

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => fakeOkResponse());
});

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.fetch;
});

// ─────────────────────────────────────────────────────────────
// 1) speedToEnginePitch 순수 함수
// ─────────────────────────────────────────────────────────────
describe('speedToEnginePitch', () => {
  it('speed=0 → ENGINE_FREQ_MIN, speed=maxSpeed → ENGINE_FREQ_MAX', () => {
    expect(speedToEnginePitch(0, 210)).toBeCloseTo(ENGINE_FREQ_MIN, 6);
    expect(speedToEnginePitch(210, 210)).toBeCloseTo(ENGINE_FREQ_MAX, 6);
  });

  it('단조 증가 (50 < 120 < 210)', () => {
    const a = speedToEnginePitch(50, 210);
    const b = speedToEnginePitch(120, 210);
    const c = speedToEnginePitch(210, 210);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });

  it('음수는 MIN으로 clamp, maxSpeed 초과는 MAX로 clamp', () => {
    expect(speedToEnginePitch(-50, 210)).toBeCloseTo(ENGINE_FREQ_MIN, 6);
    expect(speedToEnginePitch(99999, 210)).toBeCloseTo(ENGINE_FREQ_MAX, 6);
  });

  it('모든 결과가 [ENGINE_FREQ_MIN, ENGINE_FREQ_MAX] 범위 안', () => {
    for (const s of [-100, 0, 30, 105, 210, 5000]) {
      const f = speedToEnginePitch(s, 210);
      expect(f).toBeGreaterThanOrEqual(ENGINE_FREQ_MIN);
      expect(f).toBeLessThanOrEqual(ENGINE_FREQ_MAX);
    }
  });

  it('설계 주파수 범위 상수(70~200Hz)', () => {
    expect(ENGINE_FREQ_MIN).toBeCloseTo(70, 6);
    expect(ENGINE_FREQ_MAX).toBeCloseTo(200, 6);
  });

  it('maxSpeed 인자 반영 — 절반 속도는 두 주파수 중간 근처', () => {
    const mid = speedToEnginePitch(105, 210);
    expect(mid).toBeCloseTo((ENGINE_FREQ_MIN + ENGINE_FREQ_MAX) / 2, 6);
  });

  it('결정론 — 같은 입력은 같은 출력', () => {
    expect(speedToEnginePitch(137, 210)).toBe(speedToEnginePitch(137, 210));
  });

  it('maxSpeed 기본값(210)으로 flight.js MAX_SPEED와 정합', () => {
    expect(speedToEnginePitch(210)).toBeCloseTo(ENGINE_FREQ_MAX, 6);
  });
});

// ─────────────────────────────────────────────────────────────
// 2) 음소거 토글
// ─────────────────────────────────────────────────────────────
describe('음소거 토글', () => {
  it('초기 상태는 음소거 아님', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    expect(audio.muted).toBe(false);
  });

  it('toggleMute() 두 번이면 원상복귀', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.toggleMute();
    expect(audio.muted).toBe(true);
    audio.toggleMute();
    expect(audio.muted).toBe(false);
  });

  it('setMuted(true) → muted getter true, setMuted(false) → 복귀', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.setMuted(true);
    expect(audio.muted).toBe(true);
    audio.setMuted(false);
    expect(audio.muted).toBe(false);
  });

  it('resume 후 setMuted(true) 시 masterGain 값이 0으로 향함', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.resume();
    const ctx = audio._ctx;
    audio.setMuted(true);
    expect(audio.muted).toBe(true);
    // masterGain이 0으로(value=0 또는 setTargetAtTime/setValueAtTime(0,...)) 향함
    const anyZeroed = nodesOf(ctx.createGain).some(
      (g) =>
        g.gain.value === 0 ||
        g.gain.setTargetAtTime.mock.calls.some((c) => c[0] === 0) ||
        g.gain.setValueAtTime.mock.calls.some((c) => c[0] === 0)
    );
    expect(anyZeroed).toBe(true);
  });

  it('음소거 해제 시 masterGain이 양수로 복원', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.resume();
    const ctx = audio._ctx;
    audio.setMuted(true);
    audio.setMuted(false);
    expect(audio.muted).toBe(false);
    const wentPositive = gainTargets(ctx).some((t) => t > 0);
    expect(wentPositive).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 3) resume idempotent / 시작 전 안전(no-op)
// ─────────────────────────────────────────────────────────────
describe('시작 전 안전 + resume idempotent', () => {
  it('ctx 생성 전 update/gunShot/missileFire/explosion/lockWarn 호출이 throw 안 함', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    expect(() => {
      audio.update({ speed: 120, anyAlive: true }, 0.016);
      audio.gunShot();
      audio.missileFire();
      audio.explosion(true);
      audio.explosion(false);
      audio.lockWarn(true);
      audio.lockWarn(false);
      audio.missileFlight(true);
      audio.missileFlight(false);
      audio.missileAlert(true);
      audio.missileAlert(false);
    }).not.toThrow();
  });

  it('missileFlight/missileAlert: resume 후 on/off + update가 throw 안 함', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.resume();
    expect(() => {
      audio.missileFlight(true); audio.missileFlight(false);
      audio.missileAlert(true);
      audio.update({ speed: 120 }, 0.3);   // 경보 beep 게이팅 경유
      audio.missileAlert(false);
    }).not.toThrow();
  });

  it('resume 전 호출은 AudioContext를 만들지 않음(no-op)', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.update({ speed: 120, anyAlive: true }, 0.016);
    audio.gunShot();
    audio.missileFire();
    expect(audio._ctx == null).toBe(true);
  });

  it('resume() 두 번 호출해도 throw하지 않음', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    expect(() => {
      audio.resume();
      audio.resume();
    }).not.toThrow();
  });

  it('resume() 2회여도 AudioContext는 1개, 엔진 osc start는 1회만', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.resume();
    audio.resume();
    const ctx = audio._ctx;
    expect(ctx).toBeTruthy();
    // 엔진 베드 osc는 그래프 구성 시 1회만 start (idempotent)
    const startedOscs = nodesOf(ctx.createOscillator).filter(
      (o) => o.start.mock.calls.length > 0
    );
    // 두 번째 resume에서 그래프/엔진을 재구성하지 않아야 함
    const totalEngineStarts = startedOscs.reduce(
      (n, o) => n + o.start.mock.calls.length,
      0
    );
    // 엔진 osc 하나가 정확히 1번 start (BGM osc는 별개로 더 있을 수 있어 ≥1 검사 + 재호출 없음)
    expect(ctx.resume).toHaveBeenCalledTimes(2); // resume()마다 ctx.resume()은 호출
    // 그래프 osc 총 start 횟수는 첫 resume에 한정 — 두 번째 resume이 더 만들지 않음
    const audio2 = createAudio({ AudioContextCtor: FakeAudioContext });
    audio2.resume();
    const ctx2 = audio2._ctx;
    const single = nodesOf(ctx2.createOscillator).reduce(
      (n, o) => n + o.start.mock.calls.length,
      0
    );
    expect(totalEngineStarts).toBe(single);
  });

  it('resume() 시 ctx.resume()이 호출됨', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.resume();
    expect(audio._ctx.resume).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// 4) 엔진 베드 (resume 시 osc start, update 시 피치 변조)
// ─────────────────────────────────────────────────────────────
describe('엔진 베드', () => {
  it('resume() 시 엔진 오실레이터가 생성되고 start됨', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.resume();
    const ctx = audio._ctx;
    expect(ctx.createOscillator).toHaveBeenCalled();
    const started = nodesOf(ctx.createOscillator).filter(
      (o) => o.start.mock.calls.length > 0
    );
    expect(started.length).toBeGreaterThanOrEqual(1);
  });

  it('update(state) → 엔진 osc frequency를 speedToEnginePitch 타깃으로 setTargetAtTime', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext, maxSpeed: 210 });
    audio.resume();
    const ctx = audio._ctx;
    const speed = 120;
    audio.update({ speed, anyAlive: true }, 0.016);

    const expected = speedToEnginePitch(speed, 210);
    const hit = nodesOf(ctx.createOscillator).some((o) =>
      o.frequency.setTargetAtTime.mock.calls.some(
        (c) => Math.abs(c[0] - expected) < 1e-3
      )
    );
    expect(hit).toBe(true);
  });

  it('update가 매 프레임 throw 없이 동작', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.resume();
    expect(() => {
      for (let i = 0; i < 5; i++) audio.update({ speed: 80 + i * 10, anyAlive: true }, 0.016);
    }).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────
// 5) 기관총 gunShot — 노드 생성 + 연사 게이팅
// ─────────────────────────────────────────────────────────────
describe('gunShot 연사 게이팅', () => {
  it('첫 호출은 노이즈 버퍼 + bufferSource 생성 후 start', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.resume();
    const ctx = audio._ctx;
    const srcBefore = ctx.createBufferSource.mock.calls.length;
    audio.gunShot();
    expect(ctx.createBuffer).toHaveBeenCalled();
    expect(ctx.createBufferSource.mock.calls.length).toBeGreaterThan(srcBefore);
    const src = ctx.createBufferSource.mock.results.at(-1).value;
    expect(src.start).toHaveBeenCalled();
  });

  it('GUN_MIN_INTERVAL 미만 간격 연속 호출 시 두 번째는 노드 skip', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.resume();
    const ctx = audio._ctx;
    ctx.currentTime = 0;
    audio.gunShot(); // 첫 발 발생
    const after1 = ctx.createBufferSource.mock.calls.length;
    ctx.currentTime = GUN_MIN_INTERVAL * 0.5; // 최소 간격 미만
    audio.gunShot(); // 게이팅으로 skip
    expect(ctx.createBufferSource.mock.calls.length).toBe(after1);
  });

  it('GUN_MIN_INTERVAL 경과 후 호출은 다시 노드 생성', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.resume();
    const ctx = audio._ctx;
    ctx.currentTime = 0;
    audio.gunShot();
    const after1 = ctx.createBufferSource.mock.calls.length;
    ctx.currentTime = GUN_MIN_INTERVAL * 2; // 충분히 경과
    audio.gunShot();
    expect(ctx.createBufferSource.mock.calls.length).toBeGreaterThan(after1);
  });

  it('음소거 상태에서 gunShot()은 소리 노드를 만들지 않음', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.resume();
    const ctx = audio._ctx;
    audio.setMuted(true);
    const before = ctx.createBufferSource.mock.calls.length;
    audio.gunShot();
    expect(ctx.createBufferSource.mock.calls.length).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────
// 6) 미사일 발사 missileFire — whoosh 노드 생성
// ─────────────────────────────────────────────────────────────
describe('missileFire', () => {
  it('호출 시 osc(또는 bufferSource) + gain 노드를 생성하고 start', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.resume();
    const ctx = audio._ctx;
    const oscBefore = ctx.createOscillator.mock.calls.length;
    const srcBefore = ctx.createBufferSource.mock.calls.length;
    const gainBefore = ctx.createGain.mock.calls.length;
    audio.missileFire();
    const madeSound =
      ctx.createOscillator.mock.calls.length > oscBefore ||
      ctx.createBufferSource.mock.calls.length > srcBefore;
    expect(madeSound).toBe(true);
    expect(ctx.createGain.mock.calls.length).toBeGreaterThan(gainBefore);
  });

  it('whoosh — 주파수 하강 스윕(exponentialRampToValueAtTime 사용)', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.resume();
    const ctx = audio._ctx;
    audio.missileFire();
    // 새로 만든 osc 중 하나가 주파수 ramp(스윕)를 사용
    const swept = nodesOf(ctx.createOscillator).some(
      (o) =>
        o.frequency.exponentialRampToValueAtTime.mock.calls.length > 0 ||
        o.frequency.linearRampToValueAtTime.mock.calls.length > 0
    );
    expect(swept).toBe(true);
  });

  it('음소거 상태에서 missileFire()는 소리 노드를 만들지 않음', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.resume();
    const ctx = audio._ctx;
    audio.setMuted(true);
    const oscBefore = ctx.createOscillator.mock.calls.length;
    const srcBefore = ctx.createBufferSource.mock.calls.length;
    audio.missileFire();
    expect(ctx.createOscillator.mock.calls.length).toBe(oscBefore);
    expect(ctx.createBufferSource.mock.calls.length).toBe(srcBefore);
  });
});

// ─────────────────────────────────────────────────────────────
// 7) 폭발 explosion — 노이즈 붐 + big/small 파라미터 차이
// ─────────────────────────────────────────────────────────────
describe('explosion', () => {
  it('호출 시 노이즈 버퍼 + bufferSource + gain 생성 후 start', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.resume();
    const ctx = audio._ctx;
    const srcBefore = ctx.createBufferSource.mock.calls.length;
    audio.explosion(false);
    expect(ctx.createBuffer).toHaveBeenCalled();
    expect(ctx.createBufferSource.mock.calls.length).toBeGreaterThan(srcBefore);
    const src = ctx.createBufferSource.mock.results.at(-1).value;
    expect(src.start).toHaveBeenCalled();
  });

  it('explosion(true) vs explosion(false)가 다른 파라미터 사용(버퍼 길이 또는 cutoff)', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.resume();
    const ctx = audio._ctx;

    audio.explosion(false);
    const smallBufCalls = ctx.createBuffer.mock.calls.slice();
    const smallFilters = nodesOf(ctx.createBiquadFilter).slice();

    ctx.createBuffer.mockClear();
    audio.explosion(true);
    const bigBufCalls = ctx.createBuffer.mock.calls.slice();

    // small/big 둘 다 버퍼를 만들어야(붐 노이즈) 비교 가능
    expect(smallBufCalls.length).toBeGreaterThan(0);
    expect(bigBufCalls.length).toBeGreaterThan(0);

    // 버퍼 길이(샘플 수, createBuffer 2번째 인자) 또는 lowpass cutoff가 달라야 한다.
    const smallLen = smallBufCalls.at(-1)[1];
    const bigLen = bigBufCalls.at(-1)[1];
    const allFilters = nodesOf(ctx.createBiquadFilter);
    const cutoffs = allFilters.map(
      (f) =>
        f.frequency.value ??
        (f.frequency.setValueAtTime.mock.calls.at(-1)?.[0])
    );
    const lenDiffers = bigLen !== smallLen;
    const cutoffDiffers = new Set(cutoffs.filter((c) => c != null)).size > 1;
    expect(lenDiffers || cutoffDiffers).toBe(true);
    void smallFilters;
  });

  it('big=true 폭발이 small보다 길거나 같은 버퍼 길이(더 묵직/긺)', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.resume();
    const ctx = audio._ctx;

    ctx.createBuffer.mockClear();
    audio.explosion(false);
    const smallLen = ctx.createBuffer.mock.calls.at(-1)[1];

    ctx.createBuffer.mockClear();
    audio.explosion(true);
    const bigLen = ctx.createBuffer.mock.calls.at(-1)[1];

    expect(bigLen).toBeGreaterThanOrEqual(smallLen);
  });

  it('음소거 상태에서 explosion()은 소리 노드를 만들지 않음', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.resume();
    const ctx = audio._ctx;
    audio.setMuted(true);
    const before = ctx.createBufferSource.mock.calls.length;
    audio.explosion(true);
    expect(ctx.createBufferSource.mock.calls.length).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────
// 8) 락온 경고 lockWarn + update beep 게이팅
// ─────────────────────────────────────────────────────────────
describe('lockWarn + update beep 게이팅', () => {
  it('lockWarn(true) 후 update 누적이 LOCK_BEEP_INTERVAL 미만이면 beep 없음', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.resume();
    const ctx = audio._ctx;
    audio.lockWarn(true);
    const before = ctx.createOscillator.mock.calls.length;
    // 작은 dt로 interval 미만만 누적
    audio.update({ speed: 100, anyAlive: true }, LOCK_BEEP_INTERVAL * 0.3);
    expect(ctx.createOscillator.mock.calls.length).toBe(before);
  });

  it('lockWarn(true) 후 update 누적이 LOCK_BEEP_INTERVAL 초과면 beep 1회(osc 생성)', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.resume();
    const ctx = audio._ctx;
    audio.lockWarn(true);
    const before = ctx.createOscillator.mock.calls.length;
    audio.update({ speed: 100, anyAlive: true }, LOCK_BEEP_INTERVAL * 1.2);
    expect(ctx.createOscillator.mock.calls.length).toBeGreaterThan(before);
  });

  it('lockWarn(false)면 update를 충분히 돌려도 beep 없음', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.resume();
    const ctx = audio._ctx;
    audio.lockWarn(false);
    const before = ctx.createOscillator.mock.calls.length;
    for (let i = 0; i < 5; i++) {
      audio.update({ speed: 100, anyAlive: true }, LOCK_BEEP_INTERVAL);
    }
    expect(ctx.createOscillator.mock.calls.length).toBe(before);
  });

  it('lockWarn(true)로 여러 주기 누적 update → 주기적으로 beep 반복', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.resume();
    const ctx = audio._ctx;
    audio.lockWarn(true);
    const before = ctx.createOscillator.mock.calls.length;
    // 3주기 분량을 작은 step으로 누적
    for (let i = 0; i < 30; i++) {
      audio.update({ speed: 100, anyAlive: true }, LOCK_BEEP_INTERVAL * 0.3);
    }
    const beeps = ctx.createOscillator.mock.calls.length - before;
    expect(beeps).toBeGreaterThanOrEqual(2);
  });

  it('음소거 상태에서는 lockWarn(true)+update여도 beep 없음', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.resume();
    const ctx = audio._ctx;
    audio.setMuted(true);
    audio.lockWarn(true);
    const before = ctx.createOscillator.mock.calls.length;
    audio.update({ speed: 100, anyAlive: true }, LOCK_BEEP_INTERVAL * 1.5);
    expect(ctx.createOscillator.mock.calls.length).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────
// 9) suspend
// ─────────────────────────────────────────────────────────────
describe('suspend', () => {
  it('resume 후 suspend() → ctx.suspend() 호출', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.resume();
    audio.suspend();
    expect(audio._ctx.suspend).toHaveBeenCalled();
  });

  it('resume 전 suspend()는 throw하지 않음(no-op)', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    expect(() => audio.suspend()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────
// 10) BGM (절차적 — bgmUrl 미주입 시 fetch 안 탐)
// ─────────────────────────────────────────────────────────────
describe('BGM 절차적', () => {
  it('bgmUrl 미주입 시 resume()에서 fetch를 호출하지 않음(절차적 경로)', async () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.resume();
    await flushPromises();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('bgmUrl 미주입 시 musicGain 아래 BGM 노드(osc)가 start됨', () => {
    const audio = createAudio({ AudioContextCtor: FakeAudioContext });
    audio.resume();
    const ctx = audio._ctx;
    // 절차적 루프: 지속 osc 1개 이상 start. (엔진 osc 포함 총 start ≥ 2 기대)
    const totalStarts = nodesOf(ctx.createOscillator).reduce(
      (n, o) => n + o.start.mock.calls.length,
      0
    );
    expect(totalStarts).toBeGreaterThanOrEqual(2);
  });
});
