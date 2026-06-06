// Vitest 러너 동작 확인용 스모크 테스트 (M0)
//
// 가정 시그니처(설계 mds/design/m0-scaffold.md §6):
//   splitViewports(width, height) — named export from 'src/render/viewport.js'
// driving_game/tests/smoke.test.js 관례를 따른다.
import { describe, it, expect } from 'vitest';
import { splitViewports } from '../src/render/viewport.js';

describe('M0 스모크', () => {
  it('Vitest가 동작한다', () => {
    expect(1 + 1).toBe(2);
  });

  it('viewport 모듈을 import 할 수 있다(splitViewports는 함수)', () => {
    expect(typeof splitViewports).toBe('function');
  });
});
