// daynight.js 단위 테스트 — 시간대 순환(낮→저녁→밤→아침) 순수 로직
import { describe, it, expect } from 'vitest';
import {
  PHASE_DURATION, PHASES, CYCLE, NIGHT_LIGHT_THRESHOLD, dayNightState,
} from './daynight.js';

describe('상수', () => {
  it('단계 90초, 4단계 순서, 한 바퀴 360초', () => {
    expect(PHASE_DURATION).toBe(90);
    expect(PHASES).toEqual(['day', 'evening', 'night', 'morning']);
    expect(CYCLE).toBe(360);
  });
});

describe('dayNightState — 단계 경계', () => {
  it('각 단계 시작 시점의 phase 이름', () => {
    expect(dayNightState(0).phase).toBe('day');
    expect(dayNightState(90).phase).toBe('evening');
    expect(dayNightState(180).phase).toBe('night');
    expect(dayNightState(270).phase).toBe('morning');
  });

  it('단계 시작 시점은 해당 키프레임 조명 세기와 일치', () => {
    expect(dayNightState(0).dirIntensity).toBeCloseTo(1.20, 5);   // 낮
    expect(dayNightState(180).dirIntensity).toBeCloseTo(0.12, 5); // 밤(더 어둡게)
  });

  it('phaseIndex가 0~3 순환', () => {
    expect(dayNightState(0).phaseIndex).toBe(0);
    expect(dayNightState(90).phaseIndex).toBe(1);
    expect(dayNightState(180).phaseIndex).toBe(2);
    expect(dayNightState(270).phaseIndex).toBe(3);
  });
});

describe('dayNightState — 밤 판정(항법등)', () => {
  it('낮엔 isNight=false, 밤엔 isNight=true', () => {
    expect(dayNightState(10).isNight).toBe(false);
    expect(dayNightState(185).isNight).toBe(true);
  });

  it('isNight는 조명 세기 < NIGHT_LIGHT_THRESHOLD 와 일치', () => {
    for (const t of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const s = dayNightState(t);
      expect(s.isNight).toBe(s.dirIntensity < NIGHT_LIGHT_THRESHOLD);
    }
  });
});

describe('dayNightState — 순환/안전', () => {
  it('한 바퀴(CYCLE) 후 t=0 과 동일', () => {
    expect(dayNightState(CYCLE)).toEqual(dayNightState(0));
    expect(dayNightState(CYCLE + 50)).toEqual(dayNightState(50));
  });

  it('음수 시간도 안전(래핑)', () => {
    expect(dayNightState(-10)).toEqual(dayNightState(CYCLE - 10));
  });

  it('sky RGB는 항상 0~1 범위', () => {
    for (let t = 0; t < CYCLE; t += 15) {
      const { sky } = dayNightState(t);
      for (const c of [sky.r, sky.g, sky.b]) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });

  it('결정론: 같은 입력 두 번 → 동일', () => {
    expect(dayNightState(123)).toEqual(dayNightState(123));
  });
});
