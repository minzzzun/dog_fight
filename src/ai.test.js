// ai.js 단위 테스트 — AI 연습 봇 컨트롤러(순수 로직)
import { describe, it, expect } from 'vitest';
import { computeAIInput, AI_GUN_RANGE, AI_BOOST_DIST } from './ai.js';
import { createPlane } from './flight.js';

// 봇: 기본 자세(forward=(0,0,-1), up=(0,1,0), right=(1,0,0)), (0,300,0)
const bot = () => createPlane({ x: 0, y: 300, z: 0 });
const tgt = (o = {}) => ({ x: 0, y: 300, z: -300, alive: true, ...o });

describe('computeAIInput — 사격/방어', () => {
  it('상대 없음/죽음 → 전부 중립(무입력)', () => {
    expect(computeAIInput(bot(), null)).toEqual(
      { pitch: 0, roll: 0, boost: false, brake: false, gun: false, missile: false, flare: false });
    expect(computeAIInput(bot(), tgt({ alive: false })).gun).toBe(false);
  });

  it('정면·근거리 상대 → 기관총 발사', () => {
    const r = computeAIInput(bot(), tgt({ z: -200 }));   // 정면 200m
    expect(r.gun).toBe(true);
  });

  it('정면이라도 사거리 밖이면 기관총 안 쏨', () => {
    const r = computeAIInput(bot(), tgt({ z: -(AI_GUN_RANGE + 100) }));
    expect(r.gun).toBe(false);
  });

  it('락 완료(opts.locked) → 미사일 발사', () => {
    expect(computeAIInput(bot(), tgt(), { locked: true }).missile).toBe(true);
    expect(computeAIInput(bot(), tgt(), { locked: false }).missile).toBe(false);
  });

  it('미사일 추적 받는 중(opts.incoming) → 플레어 전개', () => {
    expect(computeAIInput(bot(), tgt(), { incoming: true }).flare).toBe(true);
    expect(computeAIInput(bot(), tgt(), { incoming: false }).flare).toBe(false);
  });
});

describe('computeAIInput — 조향', () => {
  it('상대가 우측 → 우뱅크(roll > 0)', () => {
    const r = computeAIInput(bot(), tgt({ x: 400, z: 0 }));
    expect(r.roll).toBeGreaterThan(0);
  });

  it('상대가 좌측 → 좌뱅크(roll < 0)', () => {
    const r = computeAIInput(bot(), tgt({ x: -400, z: 0 }));
    expect(r.roll).toBeLessThan(0);
  });

  it('상대가 위 → 기수 위(pitch > 0)', () => {
    const r = computeAIInput(bot(), tgt({ y: 700, z: 0 }));
    expect(r.pitch).toBeGreaterThan(0);
  });

  it('상대가 뒤 → 강하게 선회(피치 풀업 + 풀뱅크), 기관총 안 쏨', () => {
    const r = computeAIInput(bot(), tgt({ z: 400 }));   // 정후방
    expect(r.pitch).toBe(1);
    expect(Math.abs(r.roll)).toBe(1);
    expect(r.gun).toBe(false);
  });
});

describe('computeAIInput — 스로틀', () => {
  it('멀면 부스터', () => {
    expect(computeAIInput(bot(), tgt({ z: -(AI_BOOST_DIST + 200) })).boost).toBe(true);
  });

  it('아주 가깝고 정면이면 감속(오버슈트 방지)', () => {
    expect(computeAIInput(bot(), tgt({ z: -80 })).brake).toBe(true);
  });

  it('결정론: 같은 입력 두 번 → 동일', () => {
    const a = computeAIInput(bot(), tgt({ x: 100, z: -300 }), { locked: true });
    const b = computeAIInput(bot(), tgt({ x: 100, z: -300 }), { locked: true });
    expect(a).toEqual(b);
  });
});
