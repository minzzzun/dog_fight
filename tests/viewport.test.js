// src/render/viewport.js 의 순수 유틸 splitViewports 단위 테스트 (M0)
//
// 가정 시그니처(설계 mds/design/m0-scaffold.md §6 "시그니처/반환 규약"):
//   export function splitViewports(width, height)
//     → [좌(P1), 우(P2)] 길이 2 배열, 각 원소 { x, y, w, h }
//   좌표계: Three 뷰포트 규약(좌하단 원점, +y 위). 좌·우는 x로만 분할.
//   좌(P1): { x: 0,               y: 0, w: floor(width/2),         h: height }
//   우(P2): { x: floor(width/2),  y: 0, w: width - floor(width/2), h: height }
//   → 두 폭의 합 = width (홀수 폭에서도 틈/겹침 0).
//
// THREE 비의존 순수 함수이므로 node 환경에서 그대로 테스트한다.
import { describe, it, expect } from 'vitest';
import { splitViewports } from '../src/render/viewport.js';

describe('splitViewports — 반환 형태', () => {
  it('길이 2 배열 [좌(P1), 우(P2)]를 반환한다', () => {
    const vps = splitViewports(800, 600);
    expect(Array.isArray(vps)).toBe(true);
    expect(vps).toHaveLength(2);
  });

  it('각 뷰포트는 {x, y, w, h} 키를 가진다', () => {
    const [left, right] = splitViewports(800, 600);
    for (const vp of [left, right]) {
      expect(vp).toHaveProperty('x');
      expect(vp).toHaveProperty('y');
      expect(vp).toHaveProperty('w');
      expect(vp).toHaveProperty('h');
    }
  });
});

describe('splitViewports — 짝수 폭(800x600)', () => {
  const [left, right] = splitViewports(800, 600);

  it('좌(P1) = {0, 0, 400, 600}', () => {
    expect(left).toEqual({ x: 0, y: 0, w: 400, h: 600 });
  });

  it('우(P2) = {400, 0, 400, 600}', () => {
    expect(right).toEqual({ x: 400, y: 0, w: 400, h: 600 });
  });
});

describe('splitViewports — 짝수 표준 해상도(1280x720)', () => {
  const [left, right] = splitViewports(1280, 720);

  it('좌 폭 = 우 폭 = 640', () => {
    expect(left.w).toBe(640);
    expect(right.w).toBe(640);
  });

  it('우.x = 좌.w = 640', () => {
    expect(right.x).toBe(640);
  });
});

describe('splitViewports — 홀수 폭 경계(801x600)', () => {
  const [left, right] = splitViewports(801, 600);

  it('좌.w = floor(801/2) = 400', () => {
    expect(left.w).toBe(400);
  });

  it('우.w = width - floor = 401', () => {
    expect(right.w).toBe(401);
  });

  it('우.x = floor(801/2) = 400 (좌.w 와 동일)', () => {
    expect(right.x).toBe(400);
    expect(right.x).toBe(left.w);
  });
});

describe('splitViewports — 홀수 폭 경계(1001x601)', () => {
  const [left, right] = splitViewports(1001, 601);

  it('좌.w = 500, 우.w = 501', () => {
    expect(left.w).toBe(500);
    expect(right.w).toBe(501);
  });

  it('폭 합 = width (500 + 501 = 1001)', () => {
    expect(left.w + right.w).toBe(1001);
  });

  it('y=0, h=601 규약(홀수 높이도 그대로 전달)', () => {
    expect(left.h).toBe(601);
    expect(right.h).toBe(601);
  });
});

describe('splitViewports — 틈/겹침 0 (폭 합 = width)', () => {
  // 짝수/홀수/소수형 등 다양한 폭에서 합 = width 를 보장한다.
  for (const width of [2, 800, 801, 1001, 1280, 1366, 1919, 1920, 2561]) {
    it(`width=${width}: 좌.w + 우.w === width`, () => {
      const [left, right] = splitViewports(width, 600);
      expect(left.w + right.w).toBe(width);
    });

    it(`width=${width}: 좌.x+좌.w === 우.x (경계 연속, 겹침/틈 없음)`, () => {
      const [left, right] = splitViewports(width, 600);
      expect(left.x + left.w).toBe(right.x);
    });
  }
});

describe('splitViewports — y/h 규약 (Three 좌하단 원점)', () => {
  const cases = [
    [800, 600],
    [801, 600],
    [1001, 601],
    [1280, 720],
  ];

  for (const [width, height] of cases) {
    it(`${width}x${height}: 두 뷰포트 모두 y===0`, () => {
      const [left, right] = splitViewports(width, height);
      expect(left.y).toBe(0);
      expect(right.y).toBe(0);
    });

    it(`${width}x${height}: 두 뷰포트 모두 h===height`, () => {
      const [left, right] = splitViewports(width, height);
      expect(left.h).toBe(height);
      expect(right.h).toBe(height);
    });
  }
});

describe('splitViewports — 좌측 원점', () => {
  it('좌(P1).x 는 항상 0', () => {
    for (const width of [800, 801, 1001, 1280]) {
      expect(splitViewports(width, 600)[0].x).toBe(0);
    }
  });
});
