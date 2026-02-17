# 프롬프트리스 MCP 연동

이 가이드는 별도의 시스템 프롬프트를 추가하지 않고 Kairo를 MCP 호스트에 연결하는 방법을 설명합니다. 목표는 도구 표면(tool surface)을 compact하게 유지하고, stdout를 깨끗하게 유지하며, 대부분의 워크플로우에서 `task` 도구에 의존하는 것입니다.

> Tool name note: 일부 MCP 호스트는 tool name에 서버 prefix를 붙여 보여줍니다(예: `kairo_task`). canonical tool name은 `task`와 `manage`입니다.

## 권장 기본값

호스트 환경변수에 아래 값을 사용하세요:

- `KAIRO_MODE=mcp` (기본값; opt out 하려면 `dev`)
- `KAIRO_PRESET=mcp-balanced` (기본; 더 큰 레포는 `mcp-deep`)
- `KAIRO_PUBLIC_SURFACE=compact`
- `KAIRO_TOOL_SCHEMA_MODE=compat`
- `KAIRO_LOG_TO_FILE=true`
- `KAIRO_ALLOW_STDOUT_LOGS=false`
- `KAIRO_ROOT_PATH=/absolute/path/to/repo` (또는 args로 `--root` 전달)

왜:
- `compact` surface는 `list_tools`를 작고 안정적으로 유지합니다( `task` + `manage`만 노출).
- `compat` schema mode는 호스트가 추가 필드를 붙여도 hard failure를 방지합니다.
- log-to-file은 stdout의 MCP 프레임을 깨뜨리는 것을 방지합니다.

근거: `docs/adr/ADR-084-mcp-autopilot-and-preset-layer.md`.

## (권장) 정책 파일

`.kairo/config/mcp.json` 아래에 MCP 정책을 고정할 수 있습니다:

```json
{
  "version": 1,
  "mode": "mcp",
  "preset": "mcp-balanced",
  "publicSurface": "compact",
  "autopilot": {
    "autoModeNeverApplies": true,
    "defaultOutputFormat": "summary",
    "maxAutoRepairAttempts": 2,
    "allowAutoReindex": true
  },
  "applyHandshake": {
    "required": true,
    "oneTime": true,
    "invalidateOnDrift": true
  },
  "timeboxMs": {
    "total": 15000,
    "perStep": 3000
  }
}
```

Notes:
- 전체 task 스키마가 필요하면 `manage({ command: "schema", tool: "task", detail: "full" })`를 호출하세요.
- `task` 대신 Five Pillars 전체를 원하면 `publicSurface`를 `pillars`로 바꾸세요.

## (선택) 베타 텔레메트리

프롬프트 없이 실제 사용 데이터를 수집하려면 베타 로그를 활성화하세요:

```
KAIRO_BETA_LOG_ENABLED=true
```

기본적으로 `.kairo/logs/beta.ndjson`에 기록됩니다.

## 호스트 설정 템플릿

### 호스트 스니펫 생성 (권장)

`manage init`로 호스트별 MCP 스니펫을 생성할 수 있습니다:

```json
{
  "command": "init",
  "mode": "plan",
  "targets": ["host_snippets", "host_codex", "host_claude_cli", "host_gemini_cli"]
}
```

생성된 파일은 `.kairo/config/hosts/` 아래에 위치합니다. `server` 블록을 호스트 설정으로 복사한 뒤 `/ABS/PATH/...` 자리만 실제 경로로 바꿔 주세요.

### 일반 stdio 블록

대부분의 MCP 호스트는 주변 JSON 형태가 달라도 아래 core 필드를 받아들입니다:

```json
{
  "command": "node",
  "args": ["/abs/path/to/kairo/dist/index.js", "--root", "/abs/path/to/repo"],
  "timeout": 300000,
  "env": {
    "NODE_OPTIONS": "--max-old-space-size=4096",
    "KAIRO_MODE": "mcp",
    "KAIRO_PUBLIC_SURFACE": "compact",
    "KAIRO_LOG_TO_FILE": "true",
    "KAIRO_ALLOW_STDOUT_LOGS": "false"
  }
}
```

호스트가 `mcpServers` 또는 `servers`를 사용한다면, 서버 엔트리 이름을 `kairo`로 두고 이 블록을 그 아래에 배치하세요.

### VS Code (`.vscode/mcp.json`)

Kairo가 이 설정을 생성해 줄 수 있습니다:

```json
{
  "inputs": [],
  "servers": {
    "kairo": {
      "type": "stdio",
      "command": "node",
      "cwd": "${workspaceFolder}",
      "args": ["--max-old-space-size=8196", "${workspaceFolder}/dist/index.js"],
      "env": {
        "KAIRO_LOG_TO_FILE": "true",
        "KAIRO_ALLOW_STDOUT_LOGS": "false",
        "KAIRO_WASM_DIR": "${workspaceFolder}/wasm"
      }
    }
  }
}
```

패치 생성:

```
manage({ command: "init", mode: "plan", targets: ["vscode"] })
```

## 프롬프트리스 사용 흐름

모델(에이전트) 입장에서는 `task`를 유일한 엔트리포인트로 취급하세요:

```json
{
  "request": "엔트리포인트와 주요 의존성을 요약해줘.",
  "mode": "ask",
  "budget": "lean",
  "paths": ["src"]
}
```

Note: ADR-086 기준으로 `task`는 compact surface에서 `mode="write"`와 `mode="verify"`를 지원합니다. 다만 이 모드들은 안전/정책 이유로 여전히 `blocked`를 반환할 수 있습니다(예: target path 누락, apply token 누락/만료/사용됨, fileVersion drift, review/guardrail blocks, draft target mismatch). pillar 단위의 전체 옵션이 필요하면 `KAIRO_PUBLIC_SURFACE=pillars`로 전환하세요.

## Evidence Pack 후속 호출(ADR-087)

도구 표면을 확장하지 않고 더 깊이를 확보하고 싶다면, `task`에 deep budget을 요청한 뒤 `manage`로 evidence pack을 가져오세요:

```json
{
  "request": "auth flow와 핵심 파일들을 설명해줘.",
  "mode": "analyze",
  "budget": "deep"
}
```

그 다음:

```json
{
  "command": "artifact",
  "target": "<evidenceId>",
  "detail": "full"
}
```

Notes:
- `task`는 inline `evidence`와 함께 `artifacts`에 evidence-pack artifact id를 포함해 반환합니다.
- 응답 크기를 제한하려면 `output.maxTokens/maxChars`를 사용하세요. `task`는 맞추기 위해 LOD를 downshift 합니다.

더 깊은 옵션이 필요하면 필요 시점에 schema를 가져오세요:

```json
{
  "command": "schema",
  "tool": "task",
  "detail": "full"
}
```

안전한 change 흐름:
1. `task`를 `mode="plan_change"`로 호출
   - `edits`를 생략하면: prep 반환(`editsTemplate` + target hints + fileVersions)
   - `edits`를 제공하면: `draftId` + `applyToken` 반환(MCP 모드)
2. `task`를 `mode="apply_change"` + `draftId` + `applyToken`으로 호출 (`targetFiles`/`edits`를 다시 보낼 필요 없음)
   - apply 응답에 `verification`이 임베드될 수 있습니다. 확신이 필요하면 `task(mode="verify")`로 후속 확인하세요.

안전한 write 흐름:
1. `task`를 `mode="write"` + `safety="plan"` + `targetPath`로 호출
   - `request` 안에 fenced code block으로 콘텐츠를 포함하세요(예: ```ts ... ```)
   - `draftId` + `applyToken` 반환(MCP 모드)
2. `task`를 `mode="write"` + `safety="apply"` + `draftId` + `applyToken`으로 호출
   - draft target을 오버라이드하지 마세요. `targetPath` 불일치는 안전을 위해 차단됩니다.

## 트러블슈팅(프롬프트 없이)

- drift, 인덱스 헬스, workflow 상태( `nativeSearch` 포함 ) 확인: `manage({ command: "status" })`
- 호스트 설정 점검: `manage({ command: "doctor", scope: "host" })`
- artifacts 목록/조회: `manage({ command: "artifacts" })` 및 `manage({ command: "artifact", target: "<id>" })`
- root가 잘못되었으면 항상 `--root` 또는 `KAIRO_ROOT_PATH`를 지정하세요.
- 호스트가 JSON parsing이 엄격하다면 stdout를 깨끗하게 유지(`KAIRO_ALLOW_STDOUT_LOGS=false`)하고, 로그는 `KAIRO_LOG_TO_FILE`에 의존하세요.

전체 도구 상세는 `docs/ko/agent/TOOL_REFERENCE.md`를 참고하세요.
