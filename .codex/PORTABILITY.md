# 다른 PC에서 부동산 분석 워크스페이스 사용

이 폴더에는 부동산 분석과 Word PDF Excel PPT 이미지 제작에 필요한 스킬 16개와 프로그램 UI 개선 스킬 2개, 참고자료, 실행 보조 파일, 기존 승인 PPT 템플릿이 포함돼 있다. 새 PC에서는 폴더 전체를 복사하고 Codex 프로젝트로 추가하면 된다. 사용자 전역 스킬 폴더를 따로 복사할 필요가 없다.

## 시작 순서

1. `.agents`와 `.codex`를 포함해 `AI 부동산분석` 폴더 전체를 복사한다. 탐색기의 숨김 항목 표시 여부와 관계없이 이 두 폴더가 복사됐는지 확인한다. 드라이브·사용자명·상위 폴더·프로젝트 폴더 이름은 바뀌어도 된다.
2. 새 PC의 Codex에 복사한 폴더를 추가하고 해당 폴더에서 새 채팅을 시작한다. 프로젝트 설정 신뢰를 요청하면 새 PC의 정상 절차로 처리한다.
3. 첫 메시지로 `AGENTS.md와 .codex/PORTABILITY.md를 읽고 보고서 스킬 16개와 UI 스킬 2개, 문서 제작 런타임, 입지톡 연결 상태를 확인해줘`라고 요청한다. 스킬 목록에 보이지 않으면 Codex를 재시작한다. 로컬 `SKILL.md`를 직접 읽는 경로도 AGENTS.md에 연결돼 있다.
4. 기존 PC와 같은 모델·추론 설정과 필요한 도구 권한을 사용한다. 문서·이미지 도구와 외부 서비스 연결이 준비됐는지 확인한 뒤 실제 매물 분석을 진행한다.

## 포함된 파일

`real-estate-program-analysis`는 이 워크스페이스에서 만든 스킬이다. 프로그램과 같은 실행에는 `program/src/`와 해당 PC에서 사용할 프로젝트 의존성이 필요하다. 스킬 폴더만 옮기면 같은 엔진의 실행까지 보장되는 것은 아니다.

| 위치 | 역할 |
|---|---|
| `AGENTS.md` | 한국어 응답, 부동산 분석 기준, 로컬 스킬 연결, 제작·검증·사용량 확인 규칙 |
| `.agents/skills/` | 자동 발견 대상인 보고서 스킬 16개와 UI 스킬 2개의 본문·보조 파일·참고자료 |
| `.agents/skills/last-ppt-template/assets/` | 기존 승인 PPT 원본 템플릿 |
| `.codex/config.toml` | 입지톡 원격 MCP 주소와 활성화 설정 |
| `.codex/real-estate-skills.lock.json` | 워크스페이스 상대경로, 출처·버전·로컬 수정 사항과 파일 SHA-256 |
| `.codex/ui-skills.lock.json` | UI 스킬의 원본 커밋·라이선스·파일 SHA-256과 설치 검증 범위 |
| `.codex/runtime-baseline.json` | 이 PC에서 확인한 제작 런타임 버전과 대상 PC 확인 항목 |

스킬 이름이 전역 설치 또는 플러그인의 스킬과 겹쳐도 Codex가 두 내용을 합치는 것은 아니다. 이 워크스페이스에서는 AGENTS.md의 링크를 따라 로컬 사본을 읽는다. `spreadsheets`와 `presentations`의 로컬 이름은 소문자 규칙에 맞췄으며 지침 본문은 유지했다.

## 실행 환경 확인

실제 문서 작업 전 `load_workspace_dependencies`를 호출해 대상 PC의 Python·Node·패키지·변환 도구 경로를 확인한다. 현재 PC의 사용자 경로나 플러그인 캐시 버전을 명령에 고정하지 않는다. 반환된 관리형 패키지 디렉터리는 수정하지 않는다.

각 스킬의 `scripts/`, `container_tools/`, `assets/`는 그 스킬 폴더에 상대적인 경로다. 예를 들어 Word 구조 검사 도구는 `.agents/skills/documents/scripts/docx_validate.py`이고, 전국 실거래 자료 보조 도구는 `.agents/skills/real-estate-search/scripts/nationwide_daily_report.py`다. 실행 시 이 경로를 복사된 프로젝트의 현재 절대경로로 해석한다. 원본 문서의 `/mnt/data` 예제는 입출력 예시이며 실제 작업 경로가 아니다.

Node 스크립트에서 `@oai/artifact-tool` 같은 패키지가 필요하면 런타임 로더가 반환한 패키지 폴더를 사용한다. 스킬에서 지시하는 임시 `node_modules` 연결은 그 PC에서 새로 만든다. 이전 PC의 심볼릭 링크·junction·가상환경을 복사해 재사용하지 않는다. 슬라이드 보조 도구가 요구하는 `RUNTIME_NODE`, `RUNTIME_NODE_MODULES`, `RUNTIME_BIN_DIR`도 로더에서 확인한 대상 PC 경로를 해당 실행 프로세스에 전달한다.

| 작업 | 대상 PC에서 필요한 실행 기능 |
|---|---|
| Word | `python-docx`, 한글 글꼴, 대상 PC의 문서 렌더러 또는 확인된 DOCX 변환·페이지 렌더링 도구 |
| PDF | `reportlab`, `pypdf` 등 작업에 맞는 라이브러리와 Poppler 등 렌더러 |
| Excel | Codex 제공 `@oai/artifact-tool`과 해당 런타임의 계산·내보내기 기능 |
| PPT | Codex 제공 `@oai/artifact-tool`과 슬라이드 렌더링 도구, 템플릿에 사용된 글꼴 |
| 통계 그림 | 우선 사용 가능한 제작 런타임의 차트 도구를 확인한다. Matplotlib·Seaborn·Plotly가 필요한 작업에서만 해당 스킬의 호환 버전을 별도 환경에 준비한다. |
| 생성 이미지 | 계정에 제공되는 이미지 생성·편집 도구. CLI/API 방식은 사용자가 명시적으로 선택한 경우에만 사용한다. |

이 폴더에 실행 엔진의 바이너리·전체 Node 패키지·Python 가상환경은 포함하지 않는다. 이들은 OS·CPU·Codex 버전에 맞는 환경을 대상 PC에서 사용해야 한다. 설치된 파일을 확인한 것만으로 실제 변환·렌더링까지 성공했다고 보고하지 않는다.

PDF·Excel·슬라이드 스킬이 요구하는 `mark_artifact_operation_started.mjs` 등 실행 보조 파일은 각 스킬의 `container_tools/`에 포함돼 있다. 실제 파일 작성 시 해당 스킬의 실행 순서와 결과 검증을 따른다.

## 프로그램 UI 개선 스킬

- `impeccable`은 화면 구성·타이포그래피·색상·사용성과 디자인 검토에, `emil-design-eng`는 버튼·입력창·포커스·상태 전환·애니메이션을 다듬는 데 사용한다. `AGENTS.md`의 UI 개선 지침에 따라 로컬 사본을 읽는다.
- 두 스킬은 원본 커밋을 고정해 설치했으며 라이선스와 참고자료를 함께 보관한다. 기존 전역 설치본과 보고서 제작 스킬의 기록은 유지한다.
- Impeccable 실행기는 해당 PC용 엔진을 처음 실행할 때 공식 GitHub 릴리스에서 내려받고 체크섬을 확인한다. 새 PC에는 네트워크 연결과 사용자 캐시 폴더의 쓰기 권한이 필요하다. 현재 PC의 엔진 캐시나 계정 설정은 복사하지 않는다. Windows에서는 로컬 스킬의 `scripts/impeccable.cmd`를 사용한다.
- 설치 검증과 프로그램 디자인 검수는 구분한다. 스킬 설치만으로 프로그램의 화면이나 설치 파일이 바뀌지는 않는다.

## 계정과 외부 서비스

- `.codex/config.toml`에는 입지톡의 공개 MCP 주소만 포함돼 있다. 대상 Codex가 프로젝트 설정을 읽는지 확인하고, 필요한 로그인·접근 허가는 대상 PC에서 처리한다.
- 이미지 생성 도구, 실시간 Excel 연결, 브라우징, 연결된 클라우드 문서는 계정과 앱의 기능이다. 스킬 파일은 이 기능을 사용하는 절차를 제공하며 접근 권한을 복사하지 않는다.
- 국내 실거래 조회용 민간 중계 서비스는 이전 점검에서 지역코드 조회는 성공했지만 아파트·상업업무용 매매 조회는 HTTP 502로 실패했다. 새 PC에서도 해당 응답을 확인한다. 오류·조회 제한이 있으면 국토부 공식 원자료 또는 사용자가 제공한 자료로 확인하며 값을 만들지 않는다.
- 계정 토큰·API 키·사용량 승인 상태는 포함하지 않는다. 주간 사용량은 대상 PC의 실제 계정과 초기화 창을 기준으로 확인한다.

## 라이선스와 포함 범위

업스트림의 라이선스·저작권 파일은 해당 스킬 폴더에 보존했다. GitHub에서 가져온 스킬의 커밋은 설치 기록에 고정돼 있다. 라이선스가 명시되지 않은 공개 저장소를 재배포 허가로 해석하지 않는다.

기존 전역 `xlsx`와 관리형 `documents` 사본에는 외부 보관·복사를 금지하는 조건이 명시돼 있어 최종 묶음에 포함하지 않았다. Excel 작업은 포함된 OpenAI `spreadsheets` 스킬로 처리한다. 로컬 `documents`는 [Nous Research의 MIT 라이선스 Word 스킬](https://github.com/NousResearch/hermes-agent/tree/7bda2a3368024f7ae1c70cef16583e7c2c891674/skills/productivity/docx)이며 작성·읽기·편집·템플릿·변경 추적·주석·구조 검사 보조 도구를 포함한다. Word의 페이지 렌더링은 대상 PC의 제공 도구를 사용한다. 기존 전역 스킬과 관리형 원본은 변경하지 않았다.

## 검증 범위

설치 기록의 파일 해시는 복사 누락·변경 확인에 사용한다. 실제로 다른 경로의 임시 폴더에 복사해 로컬 링크·파일 해시·Python 구문과 대표 보조 도구의 진입점을 점검한다. 이 점검은 다른 PC의 모델·로그인·이미지 생성 권한·외부 데이터 서비스나 실제 보고서의 내용 품질을 보장하는 검사는 아니다.

## 공식 참고

- [OpenAI 로컬 스킬 위치와 발견 방식](https://learn.chatgpt.com/docs/build-skills)
- [OpenAI AGENTS.md 적용 방식](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [국토교통부 실거래가 공개시스템](https://rt.molit.go.kr/)
