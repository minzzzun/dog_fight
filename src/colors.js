// colors.js — 비행기 색 팔레트 (순수 데이터, THREE 비의존)
//
// 시작화면에서 각 플레이어가 6색 중 선택(두 명 같은 색 불가).
// hex는 숫자(0xRRGGBB) — buildPlane/marker 색 인자와 동일 형식.

export const PLANE_COLORS = [
  { id: 'red',    name: '빨강', hex: 0xff3322 },
  { id: 'blue',   name: '파랑', hex: 0x2266ff },
  { id: 'green',  name: '초록', hex: 0x33cc44 },
  { id: 'yellow', name: '노랑', hex: 0xffd633 },
  { id: 'orange', name: '주황', hex: 0xff8a1e },
  { id: 'white',  name: '흰',   hex: 0xf2f2f2 },
];

// id로 색 찾기(없으면 null).
export function colorById(id) {
  return PLANE_COLORS.find((c) => c.id === id) || null;
}

// 시작 가능 여부 — 두 색 모두 선택했고 서로 달라야 한다.
export function canStart(c1, c2) {
  return !!c1 && !!c2 && c1 !== c2;
}
