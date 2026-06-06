# M4 완료 — 렌더 결선(비행+입력+추격 카메라, 분할 2뷰포트)

## 구현

- `src/render/chaseCamera.js` (신규, 순수) — `chaseCameraPose(plane)`→{position,lookAt,up}, 상수 CHASE_DIST=22/CHASE_HEIGHT=8/LOOK_AHEAD=30. position=p−f·DIST+u·HEIGHT, lookAt=p+f·LOOK_AHEAD, up=u (forwardOf/upOf 사용).
- `src/render/planeMesh.js` (신규) — `buildPlane(color)`(콘 동체+박스 주익, 기수 -Z), `applyPlaneTransform(mesh, plane)`(Matrix4.lookAt(pos,pos+forward,up)→quaternion).
- `src/main.js` — createInput + window keydown/keyup(매핑 시 preventDefault). plane1/plane2 마주보기 스폰, buildPlane 두 메시. 렌더루프: dt clamp → readInputs 1회 → stepFlight ×2 → applyPlaneTransform ×2 → 카메라 chaseCameraPose 적용(좌=p1/우=p2) → renderViews. M0 플레이스홀더 회전 제거, 경계 GridHelper.

## 조향 수정(사용자 피드백)

- `flight.js` upOf/rightOf의 롤 적용을 `-roll`로 — D/→ 우뱅크 시 up이 +X로 기울어 **우선회(yaw 감소)와 시각 일치**. (이전: 우선회하나 좌로 기울어 좌우 반대로 느껴짐.) 테스트는 upOf 상대비교라 무영향(141 그린 유지).

## 테스트

- `src/render/chaseCamera.test.js`(19). 전체: **141 passed**. build 성공.

## 검증

- 단위 테스트 그린. 수동 확인 완료: WASD/화살표 2P 조종, 추격 카메라 자세 추종, 뱅크=선회 방향 일치(D=우), 상대 기체 가시.

## 연결

- M5 무기 발사 위치=forwardOf/planeMesh 재사용. M3 지형 메시는 바다 위에 얹음. M9 HUD.

## 설계

- [design/m4-render.md](../design/m4-render.md)
