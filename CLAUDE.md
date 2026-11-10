# 프로젝트 지침

이 프로젝트의 지침은 Codex와 공용인 AGENTS.md에 있습니다. 아래 파일을 그대로 따르세요.

@AGENTS.md

## Claude에서 사용할 때

- AGENTS.md에서 Codex 전용 기능(Codex 커스텀 에이전트, `.codex/agents/*.toml`, Codex 플러그인)을 가리키면 `.claude/agents/`의 같은 이름(밑줄은 하이픈) 서브에이전트와 `.claude/skills/`의 스킬을 사용하세요.
- `.agents/skills/` 경로를 가리키는 지침은 `.claude/skills/`에 복사된 같은 이름의 스킬로 대신 실행할 수 있습니다.
