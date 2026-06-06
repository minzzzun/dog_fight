// input.js 단위 테스트 (M2 — 2P 입력 매핑, 순수 로직)
//
// 가정한 API 시그니처 (설계노트 mds/design/m2-input.md §4 기준, 구현 전 TDD):
//   createInput()             → state { down:Set, pending:{p1,p2} }
//   onKeyDown(state, code)    → boolean (매핑된 키면 true; 미사일/플레어 rising-edge면 pending 세팅)
//   onKeyUp(state, code)      → boolean (매핑된 키면 true; down에서 제거)
//   readInputs(state)         → { p1, p2 }, 각 { pitch, roll, boost, brake, gun, missile, flare }
//   KEYMAP                    → { p1:{...}, p2:{...} } (값은 code 배열)
//
// held vs edge:
//   - pitch/roll/boost/brake/gun = held (매 프레임 현재 상태, 소비 안 함)
//   - missile/flare = edge (누른 순간 1회만 true, readInputs가 즉시 소비)
//
// P2 flare 코드: 설계가 ['ControlRight', 'KeyM'] 둘 다 매핑 → 본 테스트는 양쪽 모두 검증.
import { describe, it, expect } from 'vitest';
import { createInput, onKeyDown, onKeyUp, readInputs, KEYMAP } from './input.js';

describe('createInput 초기 상태', () => {
  it('모든 입력이 기본값(0/false)이고 엣지 미발생', () => {
    const s = createInput();
    const { p1, p2 } = readInputs(s);
    for (const p of [p1, p2]) {
      expect(p.pitch).toBe(0);
      expect(p.roll).toBe(0);
      expect(p.boost).toBe(false);
      expect(p.brake).toBe(false);
      expect(p.gun).toBe(false);
      expect(p.missile).toBe(false);
      expect(p.flare).toBe(false);
    }
  });
});

describe('onKeyDown 반환값 (매핑 여부 → preventDefault 신호)', () => {
  it('매핑된 코드는 true 반환', () => {
    const s = createInput();
    expect(onKeyDown(s, 'KeyW')).toBe(true);
    expect(onKeyDown(s, 'ArrowUp')).toBe(true);
  });
  it('매핑 안 된 코드는 false 반환', () => {
    const s = createInput();
    expect(onKeyDown(s, 'KeyZ')).toBe(false);
  });
  it('매핑 안 된 키는 readInputs 결과에 영향 없음', () => {
    const s = createInput();
    onKeyDown(s, 'KeyZ');
    const { p1, p2 } = readInputs(s);
    expect(p1.pitch).toBe(0);
    expect(p1.roll).toBe(0);
    expect(p2.pitch).toBe(0);
  });
});

describe('P1 held — pitch/roll 축', () => {
  it('KeyW → p1.pitch = +1', () => {
    const s = createInput();
    onKeyDown(s, 'KeyW');
    expect(readInputs(s).p1.pitch).toBe(1);
  });
  it('KeyS → p1.pitch = -1', () => {
    const s = createInput();
    onKeyDown(s, 'KeyS');
    expect(readInputs(s).p1.pitch).toBe(-1);
  });
  it('KeyW + KeyS 동시 → p1.pitch = 0', () => {
    const s = createInput();
    onKeyDown(s, 'KeyW');
    onKeyDown(s, 'KeyS');
    expect(readInputs(s).p1.pitch).toBe(0);
  });
  it('KeyD → p1.roll = +1', () => {
    const s = createInput();
    onKeyDown(s, 'KeyD');
    expect(readInputs(s).p1.roll).toBe(1);
  });
  it('KeyA → p1.roll = -1', () => {
    const s = createInput();
    onKeyDown(s, 'KeyA');
    expect(readInputs(s).p1.roll).toBe(-1);
  });
  it('KeyA + KeyD 동시 → p1.roll = 0', () => {
    const s = createInput();
    onKeyDown(s, 'KeyA');
    onKeyDown(s, 'KeyD');
    expect(readInputs(s).p1.roll).toBe(0);
  });
});

describe('P1 held — boost/brake/gun bool', () => {
  it('ShiftLeft → p1.boost = true', () => {
    const s = createInput();
    onKeyDown(s, 'ShiftLeft');
    expect(readInputs(s).p1.boost).toBe(true);
  });
  it('KeyQ → p1.brake = true', () => {
    const s = createInput();
    onKeyDown(s, 'KeyQ');
    expect(readInputs(s).p1.brake).toBe(true);
  });
  it('KeyE → p1.gun = true', () => {
    const s = createInput();
    onKeyDown(s, 'KeyE');
    expect(readInputs(s).p1.gun).toBe(true);
  });
  it('gun held는 소비되지 않음 (연속 readInputs 둘 다 true)', () => {
    const s = createInput();
    onKeyDown(s, 'KeyE');
    expect(readInputs(s).p1.gun).toBe(true);
    expect(readInputs(s).p1.gun).toBe(true);
  });
});

describe('P1 edge — missile/flare 1회 소비', () => {
  it('KeyR(미사일): 첫 read true, 두번째 read false', () => {
    const s = createInput();
    onKeyDown(s, 'KeyR');
    expect(readInputs(s).p1.missile).toBe(true);
    expect(readInputs(s).p1.missile).toBe(false); // 엣지 소비
  });
  it('KeyF(플레어): 첫 read true, 두번째 read false', () => {
    const s = createInput();
    onKeyDown(s, 'KeyF');
    expect(readInputs(s).p1.flare).toBe(true);
    expect(readInputs(s).p1.flare).toBe(false);
  });
  it('미사일: 소비 후 뗐다가 다시 누르면 재트리거', () => {
    const s = createInput();
    onKeyDown(s, 'KeyR');
    expect(readInputs(s).p1.missile).toBe(true);
    expect(readInputs(s).p1.missile).toBe(false);
    onKeyUp(s, 'KeyR');
    onKeyDown(s, 'KeyR');
    expect(readInputs(s).p1.missile).toBe(true);
  });
  it('플레어: 소비 후 뗐다가 다시 누르면 재트리거', () => {
    const s = createInput();
    onKeyDown(s, 'KeyF');
    expect(readInputs(s).p1.flare).toBe(true);
    expect(readInputs(s).p1.flare).toBe(false);
    onKeyUp(s, 'KeyF');
    onKeyDown(s, 'KeyF');
    expect(readInputs(s).p1.flare).toBe(true);
  });
});

describe('키 리피트 무시 (엣지 중복 트리거 방지)', () => {
  it('keyup 없이 missile onKeyDown 두 번 → 1회만 트리거', () => {
    const s = createInput();
    onKeyDown(s, 'KeyR');
    onKeyDown(s, 'KeyR'); // 리피트(이미 down) — 엣지 다시 세우지 않음
    expect(readInputs(s).p1.missile).toBe(true);
    expect(readInputs(s).p1.missile).toBe(false);
  });
  it('keyup 없이 flare onKeyDown 두 번 → 1회만 트리거', () => {
    const s = createInput();
    onKeyDown(s, 'KeyF');
    onKeyDown(s, 'KeyF');
    expect(readInputs(s).p1.flare).toBe(true);
    expect(readInputs(s).p1.flare).toBe(false);
  });
});

describe('onKeyUp — held 해제', () => {
  it('KeyW down→up 후 p1.pitch = 0', () => {
    const s = createInput();
    onKeyDown(s, 'KeyW');
    onKeyUp(s, 'KeyW');
    expect(readInputs(s).p1.pitch).toBe(0);
  });
  it('KeyE down→up 후 p1.gun = false', () => {
    const s = createInput();
    onKeyDown(s, 'KeyE');
    onKeyUp(s, 'KeyE');
    expect(readInputs(s).p1.gun).toBe(false);
  });
  it('ShiftLeft down→up 후 p1.boost = false', () => {
    const s = createInput();
    onKeyDown(s, 'ShiftLeft');
    onKeyUp(s, 'ShiftLeft');
    expect(readInputs(s).p1.boost).toBe(false);
  });
  it('매핑된 키 onKeyUp은 true 반환', () => {
    const s = createInput();
    onKeyDown(s, 'KeyW');
    expect(onKeyUp(s, 'KeyW')).toBe(true);
  });
  it('매핑 안 된 키 onKeyUp은 false 반환', () => {
    const s = createInput();
    expect(onKeyUp(s, 'KeyZ')).toBe(false);
  });
});

describe('P2 매핑 정확성', () => {
  it('ArrowUp → p2.pitch = +1', () => {
    const s = createInput();
    onKeyDown(s, 'ArrowUp');
    expect(readInputs(s).p2.pitch).toBe(1);
  });
  it('ArrowDown → p2.pitch = -1', () => {
    const s = createInput();
    onKeyDown(s, 'ArrowDown');
    expect(readInputs(s).p2.pitch).toBe(-1);
  });
  it('ArrowLeft → p2.roll = -1', () => {
    const s = createInput();
    onKeyDown(s, 'ArrowLeft');
    expect(readInputs(s).p2.roll).toBe(-1);
  });
  it('ArrowRight → p2.roll = +1', () => {
    const s = createInput();
    onKeyDown(s, 'ArrowRight');
    expect(readInputs(s).p2.roll).toBe(1);
  });
  it('ShiftRight → p2.boost = true', () => {
    const s = createInput();
    onKeyDown(s, 'ShiftRight');
    expect(readInputs(s).p2.boost).toBe(true);
  });
  it('Slash → p2.brake = true', () => {
    const s = createInput();
    onKeyDown(s, 'Slash');
    expect(readInputs(s).p2.brake).toBe(true);
  });
  it('Period → p2.gun = true', () => {
    const s = createInput();
    onKeyDown(s, 'Period');
    expect(readInputs(s).p2.gun).toBe(true);
  });
  it('Comma → p2.missile 엣지(첫 true, 다음 false)', () => {
    const s = createInput();
    onKeyDown(s, 'Comma');
    expect(readInputs(s).p2.missile).toBe(true);
    expect(readInputs(s).p2.missile).toBe(false);
  });
});

describe('P2 flare 대체키 (설계: ControlRight 또는 KeyM 둘 다 매핑)', () => {
  it('ControlRight → p2.flare 엣지', () => {
    const s = createInput();
    onKeyDown(s, 'ControlRight');
    expect(readInputs(s).p2.flare).toBe(true);
    expect(readInputs(s).p2.flare).toBe(false);
  });
  it('KeyM → p2.flare 엣지', () => {
    const s = createInput();
    onKeyDown(s, 'KeyM');
    expect(readInputs(s).p2.flare).toBe(true);
    expect(readInputs(s).p2.flare).toBe(false);
  });
});

describe('P1/P2 독립', () => {
  it('P1 KeyW(+1) + P2 ArrowDown(-1) 동시 → 서로 간섭 없음', () => {
    const s = createInput();
    onKeyDown(s, 'KeyW');
    onKeyDown(s, 'ArrowDown');
    const { p1, p2 } = readInputs(s);
    expect(p1.pitch).toBe(1);
    expect(p2.pitch).toBe(-1);
  });
  it('P1 키만 눌러도 P2 출력은 기본값 유지', () => {
    const s = createInput();
    onKeyDown(s, 'KeyW');
    onKeyDown(s, 'KeyE');
    onKeyDown(s, 'KeyR');
    const { p2 } = readInputs(s);
    expect(p2.pitch).toBe(0);
    expect(p2.gun).toBe(false);
    expect(p2.missile).toBe(false);
  });
  it('P2 키만 눌러도 P1 출력은 기본값 유지', () => {
    const s = createInput();
    onKeyDown(s, 'ArrowRight');
    onKeyDown(s, 'Period');
    onKeyDown(s, 'Comma');
    const { p1 } = readInputs(s);
    expect(p1.roll).toBe(0);
    expect(p1.gun).toBe(false);
    expect(p1.missile).toBe(false);
  });
});

describe('KEYMAP 구조 (export 형태)', () => {
  it('p1/p2 키를 가지며 각 동작 값은 배열', () => {
    expect(KEYMAP).toHaveProperty('p1');
    expect(KEYMAP).toHaveProperty('p2');
    expect(Array.isArray(KEYMAP.p1.pitchUp)).toBe(true);
    expect(KEYMAP.p1.pitchUp).toContain('KeyW');
    expect(KEYMAP.p2.flare).toEqual(expect.arrayContaining(['ControlRight', 'KeyM']));
  });
});
