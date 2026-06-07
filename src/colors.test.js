import { describe, it, expect } from 'vitest';
import { PLANE_COLORS, colorById, canStart } from './colors.js';

describe('PLANE_COLORS 팔레트', () => {
  it('6색', () => {
    expect(PLANE_COLORS.length).toBe(6);
  });
  it('각 항목 {id,name,hex} + hex는 0~0xFFFFFF 정수', () => {
    for (const c of PLANE_COLORS) {
      expect(typeof c.id).toBe('string');
      expect(typeof c.name).toBe('string');
      expect(Number.isInteger(c.hex)).toBe(true);
      expect(c.hex).toBeGreaterThanOrEqual(0);
      expect(c.hex).toBeLessThanOrEqual(0xffffff);
    }
  });
  it('id 유일', () => {
    const ids = PLANE_COLORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('기존 기본색(파랑 0x2266ff / 빨강 0xff3322) 포함', () => {
    const hexes = PLANE_COLORS.map((c) => c.hex);
    expect(hexes).toContain(0x2266ff);
    expect(hexes).toContain(0xff3322);
  });
});

describe('colorById', () => {
  it('존재 id → 객체, 없으면 null', () => {
    expect(colorById('red').hex).toBe(0xff3322);
    expect(colorById('nope')).toBe(null);
  });
});

describe('canStart — 중복불가', () => {
  it('서로 다른 두 색 → true', () => {
    expect(canStart('red', 'blue')).toBe(true);
  });
  it('같은 색 → false', () => {
    expect(canStart('red', 'red')).toBe(false);
  });
  it('한쪽 미선택 → false', () => {
    expect(canStart('red', null)).toBe(false);
    expect(canStart(null, 'blue')).toBe(false);
    expect(canStart(null, null)).toBe(false);
  });
});
