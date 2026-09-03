# 병렬 번역 뷰 + 강조 동기화

작성 2026-07-22 · 상태: Phase 1 구현 완료(2026-07-23 점검으로 확인). 이 스펙의 Phase 2(highlights/align 하이라이트 동기화)는 미구현 — 현재 "문장 연결"은 align.json 기반의 별도 메커니즘이다.

## 문제

전체 번역이 원문을 **덮는 토글**이다. `setView("trans")`가 `pages-scroll`(원문)을
숨기고 `trans-scroll`(번역)을 대신 보여줘 한 번에 하나만 볼 수 있다. 원문과 번역을
나란히 대조하며 읽을 수 없다.

## 결정 (승인됨)

- **레이아웃**: 좌우 2단 · 연속 스크롤. 원문·번역이 페이지 단위로 좌우 짝을 이루고
  하나의 스크롤로 함께 내려간다. 페이지 경계에서 좌우 정렬.
- **강조 동기화**: 문장 정밀 매칭 + 폴백. 원문 강조 구절에 대응하는 번역 문장을 AI로
  정렬해 번역쪽에도 형광펜. 실패 시 페이지 레벨 표시로 폴백.

## 아키텍처

기존 `pages` 컨테이너를 2열로 확장한다(별도 병렬 뷰를 새로 만들지 않음). 각 페이지를
`page-row`로 감싸 `[원문 page-wrap | 번역 trans-cell]` 한 행으로 만든다.

- 원문의 lazy 렌더·textLayer·하이라이트·인용 핫스팟이 전부 그대로 동작(page-wrap 재사용).
- 스크롤 컨테이너가 `pages-scroll` 하나라 좌우 동기 스크롤이 공짜.
- 뷰 상태는 `pdf`(원문만) / `parallel`(원문+번역) 둘. 기존 `trans`(번역만) 뷰 제거.

## Phase 1 — 병렬 레이아웃

- **DOM**: `buildPages`가 각 페이지를 `page-row > (page-wrap, trans-cell)`로 생성.
  `trans-scroll`/`trans-doc` 제거. `pages-scroll` 위에 병렬 액션 바(`parallel-bar`) 추가.
- **CSS**: `.pages.parallel .page-row`를 flex 2단(`align-items:flex-start`)으로. 비병렬은
  `trans-cell{display:none}`이라 원문만 중앙. 번역 셀 폭은 `max-width` 상한 + flex.
- **스크롤 위치 계산**: `onPagesScroll`을 `getBoundingClientRect` 기반으로 교체
  (page-wrap이 row 안으로 들어가 offsetParent가 바뀌므로 offsetTop 사용 불가).
- **번역 실행**: 기존 `runTranslation`(페이지별·2워커·캐시) 재사용. 진행/시작/재개 UI를
  `parallel-bar`로 이동. 미번역 셀은 "대기", 실패는 "다시 시도".
- **토글**: `trans-btn`이 parallel on/off. 켤 때 인스펙터 자동 접기(폭 확보), 끄면 복원.

## Phase 2 — 강조 동기화 (별도 진행)

- 새 API `POST /api/papers/{pid}/highlights/align`: `{source_quote, page}` + 페이지 번역문
  → 번역문 내 대응 구절 verbatim 반환(없으면 null).
- 원문 강조는 즉시, 번역쪽 매칭은 백그라운드. 결과를 `highlights.json` item에 캐시.
  번역 재생성 시 해당 페이지 강조만 재정렬.
- 번역 셀은 markdown→HTML이라 좌표가 아닌 텍스트 노드 매칭 → `<mark>` 감싸기(원문의
  정규화 인덱스 기법 재사용). 실패 시 페이지 상단 강조 구절 배지로 폴백.
- 대상: 수동 강조 + AI 자동 핵심문장(`auto_hl`) 둘 다.

## 비목표

- Phase 1에서 강조 동기화는 다루지 않는다.
- 좁은 화면(<59rem)에서 병렬은 가로 스크롤/축소를 감수 — 우선순위 낮음.
