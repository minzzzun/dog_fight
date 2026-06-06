// 분할 2뷰포트 사각형 계산 (순수 유틸 · THREE 비의존)
//
// 단일 캔버스를 좌(P1)/우(P2)로 나눠 각각 별도 카메라로 렌더할 때
// 쓰는 사각형을 계산한다. 좌표계는 Three 뷰포트 규약을 따른다:
//   - 원점은 좌하단(bottom-left), +y 위로.
//   - 좌·우 분할은 x로만 나누고 y는 0(바닥)부터 전체 높이를 쓴다.

/**
 * 단일 캔버스를 좌/우 2뷰포트로 분할한다.
 * @param {number} width  - 전체 폭(px)
 * @param {number} height - 전체 높이(px)
 * @returns {[{x:number,y:number,w:number,h:number},{x:number,y:number,w:number,h:number}]}
 *   [좌(P1), 우(P2)] 사각형. 두 폭의 합 = width (홀수 폭에서도 틈/겹침 없음).
 */
export function splitViewports(width, height) {
  // floor 로 좌측 폭을 정하고 우측은 나머지로 잡아 폭 합 = width 를 보장한다.
  const leftW = Math.floor(width / 2);
  const rightW = width - leftW;

  const left = { x: 0, y: 0, w: leftW, h: height };
  const right = { x: leftW, y: 0, w: rightW, h: height };

  return [left, right];
}
