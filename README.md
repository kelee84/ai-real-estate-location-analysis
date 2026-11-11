# AI 부동산 입지분석프로젝트

AI SHERPA의 Windows용 부동산 입지분석 프로그램입니다. Electron 기반으로 GPT·Gemini·Claude 연결, 실거래 자료 분석, 생활환경 6개 항목 평가와 고객 보고서 저장을 지원합니다.

## Windows 설치 파일

[최신 배포본 다운로드](https://github.com/kelee84/ai-real-estate-location-analysis/releases/latest)에서 설치 파일, 1쪽 간단 설명서와 SHA-256 확인값을 받으세요. 현재 배포 버전은 **0.6.32**이며 공개 배포합니다.

일반 사용자는 설치 파일을 실행하면 됩니다. AI 계정/API 키와 입지톡 연결은 각 PC에서 본인 계정으로 설정합니다. 변경·검증 기록은 [배포 기록](RELEASES.md)에 남깁니다.

## 개발 및 실행

```powershell
cd program
npm ci
npm test
npm run prepare:resources
npm start
```

설치 파일은 `npm run dist`로 만들며 `release/`에 생성됩니다. 자세한 실행·검증 방법은 [프로그램 설명](program/README.md)을 참고하세요.

## 다른 PC에서 사용

이 저장소는 소스 코드입니다. ZIP 다운로드만으로 앱이 설치되지는 않습니다. 소스를 실행하거나 빌드하려면 Windows x64에서 Node.js와 npm을 준비하고 위 명령을 실행하세요. 일반 사용자에게는 별도로 만든 Windows 설치 파일을 전달합니다. 설치 파일·의존성은 소스 저장소에 포함하지 않습니다.

다른 PC에서는 본인의 ChatGPT 계정 또는 Gemini·Claude API 키를 연결하고 입지톡에 로그인해야 합니다. 로그인 정보·API 키·고객 보고서·캐시는 옮기지 않습니다. 같은 분석 모듈을 사용하더라도 외부 자료의 조회 시점, AI 모델과 응답에 따라 결과 문장은 달라질 수 있습니다.

현재 저장소와 배포 파일은 공개되어 있습니다. 누구나 내려받을 수 있으며, 각자의 AI 계정/API 키와 지도 연결은 별도로 필요합니다.

## 프로젝트 구성

- `program/src/`: Electron 앱과 분석·보고서 모듈
- `program/scripts/`: 빌드·배포·검증 도구
- `program/tests/`: 자동 검증
- `.agents/skills/`: 프로젝트에 필요한 스킬·참고자료
- `.codex/PORTABILITY.md`: 다른 PC에서의 환경 구성 안내

로그인 정보와 API 키는 각 PC에서 별도로 연결합니다. 고객 보고서, 인증정보, 의존성 및 빌드 산출물은 Git에 포함하지 않습니다.
