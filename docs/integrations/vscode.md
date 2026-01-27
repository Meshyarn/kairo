# VS Code MCP template

VS Code uses a `.vscode/mcp.json` file to configure stdio MCP servers.

Kairo can generate a starter template:

```json
{
  "command": "init",
  "mode": "plan",
  "targets": ["vscode"]
}
```

Recommended environment defaults for VS Code MCP:

- `KAIRO_LOG_TO_FILE=true`
- `KAIRO_ALLOW_STDOUT_LOGS=false`
- Ensure `--root` points at the workspace folder

See:

- [Promptless MCP Integration](/guides/promptless-integration)

