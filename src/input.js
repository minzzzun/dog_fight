// ══════════════════════════════════════════════════════════════
// input.js — 2P 키 매핑 → 정규화 입력 (순수 로직, M2)
// DOM 이벤트(keydown/keyup) 부착·preventDefault는 main.js 담당.
// 여기선 상태/매핑/판정만. THREE·DOM 비의존.
// 키 코드는 KeyboardEvent.code 기준(키보드 레이아웃 무관).
// ══════════════════════════════════════════════════════════════

// 플레이어별 동작 → KeyboardEvent.code (값은 항상 배열: 대체 키 허용)
export const KEYMAP = {
  p1: {
    pitchUp:   ['KeyW'],       // 기수 위 (피치 +)
    pitchDown: ['KeyS'],       // 기수 아래 (피치 -)
    rollLeft:  ['KeyA'],       // 좌 뱅크 (롤 -)
    rollRight: ['KeyD'],       // 우 뱅크 (롤 +)
    boost:     ['ShiftLeft'],  // 부스터
    brake:     ['KeyQ'],       // 감속
    gun:       ['KeyE'],       // 기관총 (홀드 연사)
    missile:   ['KeyR'],       // 미사일 (엣지)
    flare:     ['KeyF'],       // 플레어 (엣지)
  },
  p2: {
    pitchUp:   ['ArrowUp'],
    pitchDown: ['ArrowDown'],
    rollLeft:  ['ArrowLeft'],
    rollRight: ['ArrowRight'],
    boost:     ['ShiftRight'],
    brake:     ['Slash'],                 // '/'
    gun:       ['Period'],                // '.'
    missile:   ['Comma'],                 // ','
    flare:     ['ControlRight', 'KeyM'],  // RightCtrl 또는 M (둘 다 허용)
  },
};

// 매핑된 모든 code의 평탄 집합 (매핑 여부 빠른 판정용)
const ALL_MAPPED = new Set([
  ...Object.values(KEYMAP.p1).flat(),
  ...Object.values(KEYMAP.p2).flat(),
]);

// code → 엣지 동작 역인덱스 ({ player, action }) — onKeyDown에서 pending 세팅용
const EDGE_INDEX = new Map();
for (const player of ['p1', 'p2']) {
  for (const action of ['missile', 'flare']) {
    for (const code of KEYMAP[player][action]) {
      EDGE_INDEX.set(code, { player, action });
    }
  }
}

// 상태 생성: down Set(P1/P2 공용, code 고유) + 플레이어별 엣지 pending
export function createInput() {
  return {
    down: new Set(),
    pending: {
      p1: { missile: false, flare: false },
      p2: { missile: false, flare: false },
    },
  };
}

function has(state, codes) {
  return codes.some((c) => state.down.has(c));
}

// keydown 처리. 매핑된 키면 true(=main이 preventDefault), 아니면 false.
//  - 처음 눌린(rising-edge) 미사일/플레어 키는 해당 플레이어 pending=true.
//  - 이미 down인 키(키 리피트)면 엣지를 다시 세우지 않음.
export function onKeyDown(state, code) {
  if (!ALL_MAPPED.has(code)) return false;
  const wasDown = state.down.has(code);
  state.down.add(code);
  if (!wasDown) {
    const edge = EDGE_INDEX.get(code);
    if (edge) state.pending[edge.player][edge.action] = true;
  }
  return true;
}

// keyup 처리. down에서 제거. 매핑된 키면 true 반환(대칭성·preventDefault용).
export function onKeyUp(state, code) {
  state.down.delete(code);
  return ALL_MAPPED.has(code);
}

// 한 플레이어 분 정규화 입력 추출. 엣지는 읽으며 소비(pending→false).
function readPlayer(state, player) {
  const km = KEYMAP[player];
  const pending = state.pending[player];
  const out = {
    pitch: (has(state, km.pitchUp) ? 1 : 0) - (has(state, km.pitchDown) ? 1 : 0),
    roll:  (has(state, km.rollRight) ? 1 : 0) - (has(state, km.rollLeft) ? 1 : 0),
    boost: has(state, km.boost),
    brake: has(state, km.brake),
    gun:   has(state, km.gun),
    missile: pending.missile,
    flare:   pending.flare,
  };
  pending.missile = false;
  pending.flare = false;
  return out;
}

// 현재 상태 → 양 플레이어 정규화 입력. missile/flare 엣지는 소비됨.
export function readInputs(state) {
  return {
    p1: readPlayer(state, 'p1'),
    p2: readPlayer(state, 'p2'),
  };
}
