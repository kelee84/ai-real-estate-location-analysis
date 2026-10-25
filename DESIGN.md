---
name: "부동산 도우미 · AI SHERPA"
description: "AI SHERPA 영상의 브랜드를 적용한 Windows 부동산 상담 작업 화면"
colors:
  navy: "#182B3D"
  navy-deep: "#112234"
  ink: "#0B1624"
  ground: "#F7F1E1"
  paper: "#FFFFFF"
  blue: "#457FC9"
  accent: "#245B9E"
  light-blue: "#91B7E5"
  coral: "#F4715B"
  nav-active: "#D1E0F4"
  muted: "#52657A"
  line: "#D8DFE5"
  field-border: "#9AAABC"
  soft: "#EDF3FA"
  soft-hover: "#E2ECF8"
  selected: "#E6F0FC"
  selected-border: "#457FC9"
  selected-ink: "#214E80"
  coral-hover: "#EF806C"
  coral-ink: "#853524"
  focus: "#245B9E"
  success: "#24724E"
  success-bg: "#EAF5EF"
  warn: "#805622"
  warn-bg: "#FFF0D5"
  danger: "#AB382B"
  danger-bg: "#FFF1EE"
  nav-hover: "#24445F"
  nav-active-ink: "#182B3D"
  secondary-border: "#9AAABC"
  secondary-hover: "#EDF3FA"
typography:
  display:
    fontFamily: "'Manrope', 'Malgun Gothic', '맑은 고딕', sans-serif"
    fontSize: "29px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "'Manrope', 'Malgun Gothic', '맑은 고딕', sans-serif"
    fontSize: "25px"
    fontWeight: 600
    lineHeight: 1.55
    letterSpacing: "-0.03em"
  body:
    fontFamily: "'Manrope', 'Malgun Gothic', '맑은 고딕', sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "'Manrope', 'Malgun Gothic', '맑은 고딕', sans-serif"
    fontSize: "14px"
    fontWeight: 700
    lineHeight: 1.65
  supporting:
    fontFamily: "'Manrope', 'Malgun Gothic', '맑은 고딕', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.7
rounded:
  suggestion: "5px"
  field: "7px"
  control: "8px"
  toast: "10px"
  panel: "12px"
  dialog: "14px"
spacing:
  tight: "8px"
  control-gap: "12px"
  field-gap: "18px"
  compact-gutter: "24px"
  panel-inset: "28px"
  workspace-gutter: "42px"
components:
  button-primary:
    backgroundColor: "{colors.coral}"
    textColor: "{colors.navy}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "11px 20px"
  button-primary-hover:
    backgroundColor: "{colors.coral-hover}"
    textColor: "{colors.navy}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.navy}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "11px 20px"
  button-secondary-hover:
    backgroundColor: "{colors.secondary-hover}"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.accent}"
    padding: "6px 0"
  input-text:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "11px 12px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.nav-active}"
    rounded: "{rounded.control}"
    padding: "14px 10px"
  nav-item-active:
    backgroundColor: "{colors.nav-active}"
    textColor: "{colors.nav-active-ink}"
  suggestion-chip:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.suggestion}"
    padding: "6px 9px"
  form-panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "28px 29px 23px"
  transaction-choice:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
  transaction-choice-selected:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.selected-ink}"
---

# Design System: 부동산 도우미 · AI SHERPA

## Overview

**Creative North Star: "AI SHERPA 업무 안내"**

AI SHERPA 홍보영상의 네이비·크림 대비, 파란 연결선 로고와 코랄 강조를 한국어 업무 화면에 적용한다. 짙은 안내 영역, 밝은 작업면과 분명한 실행 버튼으로 입력할 곳과 다음 행동을 쉽게 찾게 한다.

Windows 설치형 Electron 앱의 실무 작업 화면(Operate)이다. 주소 입력 → 자료 조회와 분석 → 검토 → 저장의 기존 흐름과 입력 단계를 유지한다. 시각 기준은 구현된 program/src/web/style.css와 program/src/web/index.html을 따르며, 색의 정식 원본은 program/src/brand-theme.json이다.

**Key Characteristics:**

- 영상과 같은 네이비·크림·파랑·코랄의 역할 구분
- 원본 파란 S 연결선과 코랄 별 로고
- GUI의 Manrope·맑은 고딕 조합과 문서의 맑은 고딕
- 테두리와 간격으로 나눈 평평한 작업면
- 실제 단계·자료 없음·평가 보류를 구분하는 상태 표시

참조 영상은 사용자가 지정한 AI-SHERPA-홍보영상.mp4이며, 적용 이력과 원본 해시는 program/assets/brand-provenance.json에 남긴다. 이 기록은 2026-10-18에 구현된 브랜드를 반영한다. 화면별 구성은 .impeccable/surfaces/main.md에서 관리한다.

## Colors

네이비가 안내의 기준을 잡고, 크림과 흰색이 작업 내용을 밝게 받친다. 파랑은 연결·선택·텍스트 행동을, 코랄은 주 실행 행동과 원본 로고의 별을 강조한다. YAML의 이름은 화면에서 사용하는 CSS 변수와 일치한다.

### Primary

- **네이비 안내 — navy / navy-deep:** 고정 메뉴, 주요 제목과 깊은 토스트 배경.
- **크림 작업 바탕 — ground:** 상단 상태 영역과 전체 작업 배경.
- **코랄 실행 — coral / coral-hover:** 주요 버튼의 기본·호버 배경. 글자는 navy를 사용한다.

### Secondary

- **파란 연결 — blue / light-blue:** 원본 로고의 선·끝점, 현재 진행 단계, 메뉴 하단 보조 표기.
- **짙은 파란 행동 — accent / focus:** 텍스트 버튼, 입력 커서·체크박스와 키보드 포커스.
- **옅은 파란 선택 — nav-active / selected:** 선택 메뉴와 거래 유형. nav-active-ink / selected-ink가 해당 글자를 받친다.
- **네이비 메뉴 호버 — nav-hover:** 어두운 메뉴의 호버 배경.

### Neutral

- **먹색 본문 — ink:** 본문과 입력 내용.
- **흰 작업면 — paper:** 입력 폼·입력창·결과 목록·대화상자.
- **청회색 보조 — muted:** 설명, 날짜와 상태 문구.
- **청회색 구획 — line / field-border / secondary-border:** 패널, 입력창과 보조 버튼의 경계.
- **옅은 파란 작업면 — soft / soft-hover / secondary-hover:** 요청 예시·목록 호버·안내문 바탕.
- **선택 경계 — selected-border:** 선택한 거래 유형의 경계.

success / success-bg, warn / warn-bg, danger / danger-bg는 성공·대기·오류를 문구와 함께 표시한다. 출력 차트는 같은 색 원본에서 coralInk·blueDark·chartThird를 가져오며, 선 모양과 마커도 함께 구분한다. 화면의 코랄 실행 버튼을 성과나 가격 상승의 신호로 사용하지 않는다.

**The Brand Source Rule.** 색의 정식 원본은 program/src/brand-theme.json이며 program/src/brand-theme.cjs가 화면과 출력물에 연결한다. 이 문서의 토큰과 program/src/web/brand.css는 구현값을 기록한 사본으로 같은 값을 유지한다.

**The Evidence State Rule.** 색만으로 완료·연결·자료 부족을 판단하게 하지 않는다. 상태 문구를 함께 표시하고 근거 없는 금액, 점수, 진행률을 채우지 않는다.

## Typography

**Display Font:** Manrope, Malgun Gothic / 맑은 고딕, sans-serif  
**Body Font:** Manrope, Malgun Gothic / 맑은 고딕, sans-serif

GUI의 영문·숫자는 번들 Manrope를, 한글은 Windows의 맑은 고딕을 사용한다. Manrope는 program/src/web/assets/fonts/Manrope.ttf와 OFL-Manrope.txt로 포함된다. PDF·Word·Excel·PPT의 한글과 제작사 표기는 맑은 고딕으로 유지한다.

### Hierarchy

- **Display:** 페이지 제목. 크기·굵기·행간은 frontmatter의 display를 따른다.
- **Headline:** 우측 보고서 안내 제목. 넓은 창에서는 28px, 좁은 PC 창에서는 23px로 변한다.
- **Body:** 입력과 일반 본문. 입력창의 행간은 1.5이며 긴 설명은 muted로 낮춰 표시한다.
- **Label:** 입력 라벨과 주요 버튼. 필수·선택을 글자로 명시한다.
- **Supporting:** 입력 힌트와 자료·상태 설명. 개인정보 안내는 11px을 사용한다.
- **브랜드명:** 메뉴의 AI SHERPA는 Manrope 800, 16px이며 제품명은 18px, 700이다.
- **숫자:** 보고서 개수·날짜·경과 시간·사용량은 고정폭 숫자 정렬을 사용한다.

도움말 문단의 최대 길이는 약 70ch다. 긴 설명을 작은 글자로 압축하지 않는다.

## Layout

좌측 고정 메뉴, 상단 연결·사용량 상태, 중앙 작업 영역을 유지한다. 기본 메뉴 폭은 222px, 상단 최소 높이는 82px, 본문 최대 폭은 1650px이다. 본문의 기본 여백은 위 38px, 좌우 42px, 아래 40px이다.

새 분석은 입력 폼과 안내의 두 열로 구성한다. 기본 열은 minmax(390px, 1.25fr)와 minmax(280px, .85fr), 간격은 36px이다. 폼 안쪽 여백은 위 28px, 좌우 29px, 아래 23px이다. 두 개의 짧은 입력은 같은 너비로 묶고 거래 유형은 나란한 체크박스로 표시한다.

- **1550px 이상:** 본문 위 여백 48px, 열 간격 55px, 폼 안쪽 여백 34px.
- **1130px 이하:** 메뉴 폭 184px, 본문 좌우 여백 28px, 열 간격 24px. 보고서 구성 설명은 항목명 아래로 내려온다. 계정·사용량은 필요에 따라 두 줄로 배치한다.
- **850px 이하:** 메뉴가 위로 이동하고 작업면은 한 열이 된다. 이는 웹 안전장치이며 납품 기준은 최소 1000×720인 Windows 앱이다.
- **480px 이하:** 고객·업소 입력의 짧은 필드를 한 열로 배치한다.
- **낮은 창:** 세로 스크롤을 허용한다.

보관함·결과·도움말도 같은 메뉴와 상단 상태를 사용한다. PC 인증·계정 로그인·매물 입력·검토·저장의 기존 순서를 유지한다.

## Elevation & Depth

밝기 차이와 얇은 테두리로 작업면을 구획한다. 입력 폼과 목록은 평평하며, 사용량 상세·토스트·대화상자에만 부드러운 네이비 그림자를 사용한다. 그림자 값은 .impeccable/design.json의 extensions.shadows와 구현의 shadow 변수를 따른다. 대화상자 배경막은 반투명 네이비(#182B3D66)다.

키보드 포커스는 focus 색의 3px 외곽선과 3px 간격으로 표시한다.

**The Quiet Surface Rule.** 일반 작업면은 평평하게 유지한다. 현재 작업 위에 나타나는 사용량 상세·토스트·대화상자에만 그림자를 사용한다.

## Shapes

입력창·체크박스 선택면은 7px, 버튼·메뉴는 8px, 폼은 12px, 대화상자는 14px의 둥근 모서리를 사용한다. 요청 예시는 5px의 작은 직사각형 칩이다. 연결·진행 점은 원형이며 일반 아이콘은 둥근 선끝의 단순한 선형 SVG다.

제작사 로고는 원본의 S 모양 파란 연결선, 양 끝의 파란 원과 흰 중심, 코랄 별을 그대로 사용한다. 화면용 SVG와 출력용 PNG는 program/src/web/assets/sherpa-logo.svg·sherpa-logo.png에 있다. 종횡비는 420:230이며 늘이거나 자르지 않는다. 설치·실행 아이콘은 네이비 바탕의 같은 로고를 사용한다.

## Components

### Buttons

주요 행동은 코랄 바탕과 네이비 글자, 보조 행동은 투명 바탕과 청회색 경계로 표시한다. 기본 최소 높이는 44px, 작은 버튼은 38px, 폼 전체 너비의 실행 버튼은 52px이다. 텍스트 버튼은 짙은 파랑이며 호버 시 밑줄이 나타난다.

버튼의 배경·글자색 전환은 180ms다. 비활성 버튼은 불투명도 .55와 대기 커서를 사용한다. 감소된 모션에서는 전환을 끈다.

### Inputs / Fields

흰 배경, field-border 경계와 7px 모서리를 사용한다. 텍스트·날짜·선택 입력은 같은 체계이며 최소 높이는 46px이다. 라벨은 입력 위에 두고 필수·선택·단위를 글자로 표시한다. 텍스트 영역은 세로 크기 조절을 허용한다. 별도의 인라인 오류 경계 스타일을 새로 정의하지 않는다.

### Transaction Choices / Suggestion Chips

거래 유형은 실제 체크박스와 이름을 유지하며 선택 시 바탕·경계·글자색·굵기가 함께 바뀐다. 요청 예시 칩은 soft 바탕과 accent 글자를 쓰는 작은 행동 버튼이다. 호버 시 soft-hover로 변한다.

### Cards / Containers

입력 폼은 흰 배경과 line 경계를 사용한다. 우측 안내는 크림 바탕 위에 구획선으로 정리한다. 보관함은 흰 행의 경계와 옅은 파랑 호버로 구분한다. 고객 요약·상세 보고서 전환은 네이비 선택면과 흰 글자를 사용한다.

### Navigation / Branding

네이비 레일의 상단에 원본 로고, AI SHERPA와 부동산 도우미를 함께 표시한다. 선택 메뉴는 옅은 파란 바탕과 네이비 글자·굵기로 구분한다. 비선택 글자는 nav-active, 버전은 light-blue를 사용한다. 긴 메뉴명은 줄바꿈하지 않는다.

제작사 표기는 프로그램의 로고·제작 정보다. 설정에서 등록한 사무소명·담당자·연락처·업소 로고는 고객 요약 발행 정보로 별도 취급한다. 도움말의 이메일·인스타그램 표기는 program/assets/brand-provenance.json에서 검증된 정보를 따른다.

### Progress / Data States

분석 중에는 안내가 실제 작업 단계 목록으로 바뀐다. 현재 단계는 굵은 글자와 파란 점의 맥동, 완료 단계는 success 점으로 표시한다. 가상의 숫자 진행률은 표시하지 않는다. 1.5초의 진행 점 맥동은 감소된 모션에서 꺼진다.

자료 없음·산출 불가·평가 보류·지도 미첨부는 각 사유를 문구로 설명한다. 보고서 미리보기 위에 저장·수정·상담 입력을 배치한다.

### Dialogs / Toasts

PC 인증·설정·사용량 확인은 같은 글꼴·입력·버튼을 사용한다. 대화상자는 흰 바탕이며 닫기·나중에·실행을 글자로 표시한다. 일반 토스트는 깊은 네이비, 오류 토스트는 danger 바탕을 사용하고 상태 읽기 영역을 제공한다.

## Do's and Don'ts

### Do:

- **Do** 네이비 안내 영역, 크림 작업 바탕, 흰 입력면과 코랄 실행 버튼의 역할을 유지한다.
- **Do** 원본 로고의 파란 연결선·양 끝 원·코랄 별을 함께 보존한다.
- **Do** 입력창 위에 한국어 라벨과 필요한 단위·선택 여부를 표시한다.
- **Do** 제작사 AI SHERPA 표기와 고객 요약을 발행하는 부동산의 로고를 구분한다.
- **Do** 호버·키보드 포커스·선택·작업 중 상태를 구분하고 자료 부족을 설명한다.
- **Do** 좁거나 낮은 창에서는 줄 배치와 간격을 조절하고 세로 스크롤을 허용한다.
- **Do** 감소된 모션 설정에서 진행 점의 맥동과 상태 전환을 끈다.

### Don't:

- **Don't** 원본 로고를 새 도형이나 다른 색으로 재해석하지 않는다.
- **Don't** 업무와 관계없는 홍보 문구·장식·영상 애니메이션을 작업 화면에 추가하지 않는다.
- **Don't** 입력 단계나 기능 흐름을 브랜드 적용을 이유로 바꾸지 않는다.
- **Don't** 입력창과 결과 목록에 불필요한 그림자를 추가하지 않는다.
- **Don't** 근거 없는 가격·점수·지도·숫자 진행률을 채우거나 색만으로 상태를 전달하지 않는다.
- **Don't** 제작사 로고를 발행 업소의 로고로 표시하거나 원본 영상의 전화번호를 프로그램 문의 정보로 옮기지 않는다.

## 2026-10-22 업무 화면 개선 · v0.6.16

사용자가 기존 네이비·크림·코랄을 살린 단정한 업무형을 선택했다. 브랜드 색상·로고·글꼴은 유지하고 입력·안내의 비율, 선택 상태, 안내문과 선택 설정의 밀도를 조정했다. 본문 작업 영역의 기본 좌우 간격은 40px, 넓은 창의 사이드바는 232px이며 1130px 이하에서는 184px로 줄인다.

분석 버튼은 폼 하단과 오른쪽 안내에 둔다. 두 버튼은 같은 폼을 제출하며 문구·비활성 상태도 함께 바뀐다. 입력을 가리는 고정 하단 버튼은 사용하지 않는다. 면적 기준과 선택 조건은 기본 안내를 보존한 채 펼쳐 확인한다. 본문 바로 가기, 현재 메뉴 표시와 보관함 내부 포커스를 제공하며 설정 창은 낮은 화면에서 내부 스크롤을 허용한다.

제작자 개인 이름 대신 `AI SHERPA 제작`으로 표시한다. 왼쪽 메뉴와 도움말에 `@aisherpa_01` 및 사용자 지정 홍보영상 `https://www.instagram.com/p/Dexcr7WH2qR/`을 연결한다. 고객이 입력한 업소·담당자 정보와 제작자 표기는 구분한다.

실행 화면은 1000×720, 1100×780, 1440×1000, 1920×1080에서 확인했다. 검수용 캡처의 사용량과 보고서 목록은 가상 자료다. 분석·평가·조회·캐시·보고서 엔진은 이 UI 변경의 수정 범위에 포함하지 않는다.
