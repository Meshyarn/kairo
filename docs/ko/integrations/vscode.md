# VS Code MCP 템플릿

VS Code는 `.vscode/mcp.json` 파일로 stdio MCP 서버를 설정합니다.

Kairo는 스타터 템플릿을 생성할 수 있습니다:

```json
{
  "command": "init",
  "mode": "plan",
  "targets": ["vscode"]
}
```

VS Code MCP 권장 기본값:

- `KAIRO_LOG_TO_FILE=true`
- `KAIRO_ALLOW_STDOUT_LOGS=false`
- `--root`가 워크스페이스 폴더를 가리키도록 설정

참고:

- [프롬프트리스 MCP 연동](/ko/guides/promptless-integration)

