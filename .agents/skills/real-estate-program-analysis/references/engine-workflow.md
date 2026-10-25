# 프로그램 엔진 연결

워크스페이스 루트는 이 스킬 폴더의 상위 3단계다. 실행 환경은 `load_workspace_dependencies`로 확인한다. 아래 경로는 워크스페이스 상대경로이며 실제 명령에는 확인한 절대경로를 넣는다. 설치된 다른 버전 exe와 현재 소스를 섞지 않는다.

## 작업별 실제 모듈

모두 `program/src/` 아래에 있다. 필요한 부분만 읽는다.

| 작업 | 모듈 |
|---|---|
| 입력·6개월·면적·계약 평균·금액 표시 | `core.cjs`, `type-selection.cjs`, `price-table.cjs` |
| 공식 단지·타입 | `property-identity.cjs`, `property-search.cjs`, `type-catalog.cjs` |
| 국토부 거래 | `data.cjs`: `RtmsClient.collect(input,onProgress,signal)` |
| 주변·공식 자료 | `research.cjs`: `collectResearch(bridge,input,prices,options)` |
| 검증·생활환경 점수 | `scoring.cjs`, `living-access.cjs`, `shopping.cjs` |
| 자연·통학구역 | `regional-park.cjs`, `nature-access.cjs`, `public-trails.cjs`, `school-zone.cjs` |
| 고객 표·장단점·출처 | `customer-report.cjs`, `report-flow.cjs`, `comparison-basis.cjs` |
| 상세·비교·요약·브랜드 | `report.cjs`, `comparison-report.cjs`, `customer-summary.cjs`, `brand-theme.cjs` |
| 추이·예정 사업·지도·페이지 | `price-trend.cjs`, `future-developments.cjs`, `map-capture.cjs`, `report-pagination.cjs` |

배점은 현재 코드의 `RUBRIC`과 산출 결과의 `method/calculation`을 따른다. 별도 점수표를 복제하지 않는다. 상가·주택·오피스텔을 아파트의 6개 점수로 임의 평가하지 않는다.

## 새 분석

1. `core.normalizeInput()`으로 정리하고 공식 단지·타입을 식별한다. 동명 후보를 확인 없이 하나로 선택하지 않는다.
2. `RtmsClient.collect()`의 `rows`는 식별된 단지 계약, `raw`는 지역 전체 CSV·조회 조건이다. **전체 지역 CSV를 대상 계약으로 넣지 않는다.** 공식 `input.building`을 확정하고 `core.aggregate(rows,input,coverage)` 및 `prices.buildingResolution=identity`로 연결한다. 조회 오류를 빈 거래·0원으로 바꾸지 않는다.
3. `collectResearch()`를 재사용한다. 연결 어댑터는 `evidenceSession()`과 `evidenceTool(session,tool,args,{signal})`을 제공한다. 직접 입지톡을 호출했다면 응답을 `{server:"ipzitalk",tool,arguments,result}`로 보관한다. 공개 출처·조회일·`verified` 상태를 임의 생성하지 않는다. 현재 PC의 앱 사용자 데이터 아래 `research-cache.cjs`의 `ResearchCache`를 연결한다. 묶음 결과의 종류별 누락·45건 제한·좌표·반경·날짜를 확인하고 충분하지 않은 종류만 키워드로 보충한다. 병원 5km·일상 시설 1.5km·중고교 3km 등 서로 다른 범위를 한 반경으로 바꾸지 않는다. 공식 단지 코드·구 코드·동·지번·좌표·한국 기준일이 같을 때만 공개 근거를 재사용한다. 평형·거래 유형·고객 조건은 시설 캐시 키에 넣지 않고 거래와 상담 내용은 별도로 처리한다. 오류는 캐시하지 않으며 일일 한도 초과가 확인되면 남은 요청을 중단한다. 명시적 새 조회는 `forceRefresh:true`로 캐시를 건너뛴다.
4. 수집 결과 `tools,school,nature,natureAccess,livingAccess`를 `scoring.collectEvidence()`로 연결하고 `scoring.assessScores()`로 점수를 계산한다. 쇼핑·병원·학원은 원래 조회 응답의 분류·중심·반경·날짜·거리를 검증해 snapshot으로 만든다. 공식 숲길은 실제 경로 판독기·확인한 geometry가 필요하다. 산 이름 검색 결과만으로 경로를 만들지 않는다.
5. 본문·특징·장단점은 계산 결과에서 작성한다. `evidence-guard.cjs`와 `future-developments.cjs`로 미검증 숫자·예정 사업을 걸러낸다. 단지 비교는 `comparison.cjs`의 구성·검증을 적용한다.

AI에는 `compactResearch()`의 핵심 시설·거리·범위·한계·출처만 전달하고 전체 검색 결과·경로 좌표·후보 목록은 원자료에 둔다. `research.metrics`의 실제 요청·캐시 재사용·차단 횟수와 AI 입력 글자 수를 기록한다. 글자 수 감소를 실제 과금 토큰 감소로 표현하지 않는다. MCP 묶음 요청 1회가 내부 지도 API 조회·과금 1회를 뜻한다고 가정하지 않는다. 프로그램의 입지톡 잔여 횟수는 서비스가 알린 범위만 표시하며 현재 전용 잔여 조회 도구가 없으므로 임의 총량에서 요청 수를 빼지 않는다.

상품·가격 점수와 기본 프리미엄 행은 제거됐다. 최근 6개월 실거래 평균은 계속 제공하며 호가와 구분한다. 과거 상품·가격 근거는 원본에 보존하고 병원·학원 점수로 치환하지 않는다. 학교알리미의 자체 시험 결과를 학교 간 전국 순위로 환산하지 않으며 보안문자 확인을 자동 우회하지 않는다.

## 저장본 재출력·준비된 자료 실행

앱 보고서는 `report.json`, 같은 폴더의 `raw/`, `figures/`를 묶어 다룬다. 저장 위치는 현재 PC 앱 설정·사용자 문서 폴더에서 확인한다. 이전 PC 사용자명·절대경로를 하드코딩하지 않는다. 업소 정보가 필요하면 해당 PC 설정의 `officeProfile`만 읽고 계정 파일·로그인 토큰은 스킬에 복사하지 않는다.

```text
<확인한 Node 실행파일> <스킬 절대경로>/scripts/run-analysis.cjs --input <JSON 절대경로> --out <새 폴더 절대경로>
```

이 도구는 인터넷·계정·AI를 호출하지 않는다.

- 저장된 보고서는 `scoring.prepareReport()`로 앱과 같은 호환 처리를 한다. 현재 자료로 무조건 재산정하거나 원본을 덮어쓰지 않는다. 완성된 비교 보고서도 재출력할 수 있다.
- 새 단일 분석 번들은 `kind:"analysis-bundle-v1"`, `input`, 공식 수집 `contracts`, `coverage`, `identity`, `tools`, 수집기로 확인한 `snapshots`를 넣는다. snapshots 키는 `school,nature,natureAccess,livingAccess`이며 과거 자료 호환용 `product,peers,listings`도 보존할 수 있다. 앱이 만든 검증 증거 재사용에만 `evidence`를 쓴다. 선택값은 `narrative,dataCheckedAt,trend,futureDevelopments,consultation,map`이다. 지도는 입력 파일 옆 `figures/`에 둔다. 이 도구가 자료 수집까지 했다고 말하지 않는다.
- 새 비교는 각 단지를 먼저 같은 기준으로 분석하고 프로그램의 `comparison.cjs` 절차로 조립한다. 이 도구는 새로운 비교 수집 로직을 따로 구현하지 않는다.
- 결과는 `report.json`, `report.html`, `customer-summary.html`, `method/engine.json`이다. 내부 JSON에는 비공개 메모가 있을 수 있어 고객 전달 파일로 쓰지 않는다.
- engine.json에 버전·코드 해시·지도 포함 여부·미확인 사항을 기록한다. 실행 성공은 원자료·현장·페이지 검증 완료를 뜻하지 않는다.

## PDF·편집 형식

로컬 PDF 스킬의 시작 기록을 먼저 적용한 뒤 확인된 **Electron 실행파일**로 `scripts/render-pdf.cjs <report.html> <새 output.pdf>`를 실행한다. 프로그램의 `report-pagination.printBalanced()`를 그대로 쓰며 앱 로그인·사용자 데이터를 읽지 않는다. 최종 전 페이지 렌더링 검토는 별도로 한다. 요약은 `customer-summary.html`을 같은 방식으로 변환한다.

Word·Excel·PPT는 해당 로컬 스킬을 적용한 뒤 `report.word/excel/powerpoint`를 호출한다. PPT 기본 템플릿은 로컬 `last-ppt-template/assets/TTTM_분석프로그램_설계서_기본템플릿.pptx`를 확인한다. 차트·평균·지도 스타일을 중복 작성하지 않는다.

현재 `map-capture.isValidatedMap()`과 이미지 존재 확인을 통과해야 본문 지도 첨부로 기록한다. 없으면 실제 입지톡 캡처를 확보하고 미첨부로 표시한다. 앱 저장은 `export-location.cjs`의 마지막 성공 경로를 유지한다. 워크스페이스 파일 생성은 지정 경로나 `reports/`를 쓰며 무관한 앱 저장 설정을 바꾸지 않는다.
