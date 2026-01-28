# Install Kairo + Configure MCP

This guide covers getting Kairo installed as an npm package and wiring it as an MCP server in your host.

**Time:** 8 min | **Difficulty:** Beginner

---

## Step 1: Install Kairo

### Option A: From npm registry

```bash
npm install kairo
```

Or with other package managers:

```bash
# yarn
yarn add kairo

# pnpm
pnpm add kairo

# bun
bun add kairo
```

### Option B: From this repo (for development)

```bash
git clone https://github.com/anomalyco/kairo
cd kairo
npm ci
npm run build
```

The built entry point will be at `dist/index.js`.

---

## Step 2: Verify installation

Kairo is a **stdio MCP server**, not an interactive CLI. The supported argv surface is intentionally small:

- `--root <path>` (or `KAIRO_ROOT_PATH` / `KAIRO_ROOT`)

### Smoke test (from this repo)

Test that Kairo can communicate over stdio:

```bash
# From repo
npm run smoke:mcp-mock-client
```

This spawns Kairo and makes a few sample calls. If it exits with code 0, you're good.

### Verify via your MCP host (from npm or repo)

After wiring your MCP host (next section), run:

```bash
manage({ command: "status" })
```

If you get a JSON response with `success: true`, your host integration is working.

---

## Step 3: Identify your MCP host

Kairo is an MCP server over **stdio**. Your host launches it and sends/receives JSON.

Common hosts:

| Host | Config file | Example |
|------|------------|---------|
| **Claude CLI** | `~/.claude/mcp_config.json` | See below |
| **Cline (VS Code)** | `.cline/mcp_config.json` | See below |
| **Cursor** | `.cursor/mcp_config.json` | See below |
| **Custom agent** | Depends on your setup | Provide `command` + `args` + `env` |

---

## Step 4: Configure MCP in your host

### Claude CLI example

Edit `~/.claude/mcp_config.json`:

```json
{
  "mcpServers": {
    "kairo": {
      "command": "node",
      "args": [
        "/absolute/path/to/kairo/dist/index.js",
        "--root",
        "/absolute/path/to/your/project"
      ],
      "timeout": 300000,
      "env": {
        "NODE_OPTIONS": "--max-old-space-size=4096",
        "KAIRO_MODE": "mcp",
        "KAIRO_PUBLIC_SURFACE": "compact",
        "KAIRO_LOG_TO_FILE": "true",
        "KAIRO_ALLOW_STDOUT_LOGS": "false",
        "KAIRO_MAX_RESULTS": "25"
      }
    }
  }
}
```

**Key fields explained:**

| Field | Purpose |
|-------|---------|
| `command` | Node.js executable |
| `args[0]` | Path to Kairo entry point |
| `args[1]`, `args[2]` | Always set `--root` to your target project |
| `timeout` | 300s allows indexing on first run. Adjust lower if needed. |
| `NODE_OPTIONS` | Heap size for large repos (adjust 4096 to 8192+ if needed) |
| `KAIRO_MODE` | Always `mcp` for MCP hosts |
| `KAIRO_PUBLIC_SURFACE` | `compact` (recommended) = `task` + `manage`; `pillars` for raw APIs |
| `KAIRO_LOG_TO_FILE` | Keep stdout clean (required for MCP) |
| `KAIRO_ALLOW_STDOUT_LOGS` | Should be `false` (logs to file only) |
| `KAIRO_MAX_RESULTS` | Limit result pages (25 is good default) |

### Cline (VS Code) example

Create `.cline/mcp_config.json` in your project:

```json
{
  "mcpServers": {
    "kairo": {
      "command": "node",
      "args": [
        "node_modules/kairo/dist/index.js",
        "--root",
        "."
      ],
      "timeout": 300000,
      "env": {
        "NODE_OPTIONS": "--max-old-space-size=4096",
        "KAIRO_MODE": "mcp",
        "KAIRO_PUBLIC_SURFACE": "compact",
        "KAIRO_LOG_TO_FILE": "true",
        "KAIRO_ALLOW_STDOUT_LOGS": "false"
      }
    }
  }
}
```

> **Note:** Relative paths work better in project-local config files.

### Cursor example

Create `.cursor/mcp_config.json`:

```json
{
  "mcpServers": {
    "kairo": {
      "command": "node",
      "args": [
        "/absolute/path/to/kairo/dist/index.js",
        "--root",
        "/absolute/path/to/your/project"
      ],
      "timeout": 300000,
      "env": {
        "NODE_OPTIONS": "--max-old-space-size=4096",
        "KAIRO_MODE": "mcp",
        "KAIRO_PUBLIC_SURFACE": "compact",
        "KAIRO_LOG_TO_FILE": "true",
        "KAIRO_ALLOW_STDOUT_LOGS": "false"
      }
    }
  }
}
```

---

## Step 5: Test the connection

### From Claude CLI

```bash
claude
```

Then in the chat, try:

```
What tools do I have available?
```

Claude should list `task` and `manage` tools.

### From Cline

Open VS Code with Cline enabled, open any code file. Cline's chat panel should show available tools.

---

## Troubleshooting

### "Kairo not found" or command not in PATH

- If installed globally: `npm install -g kairo` (not recommended; prefer local installation)
- If from repo: use full absolute path to `dist/index.js`
- Verify with: `node /path/to/kairo/dist/index.js --help`

### Timeout on first run

- Increase `timeout` in MCP config to 600000 (10 minutes)
- First run indexes your project; subsequent runs are much faster
- Check logs: `tail -f .kairo/kairo.log`

### MCP connection fails silently

- Verify `KAIRO_LOG_TO_FILE=true` and `KAIRO_ALLOW_STDOUT_LOGS=false`
- Check `.kairo/kairo.log` for errors
- Ensure `--root` is an absolute path to your project
- Verify the root path contains source code or config files

### "random parse errors" in host

- Almost always: logs being written to stdout
- Fix: `KAIRO_LOG_TO_FILE=true` and `KAIRO_ALLOW_STDOUT_LOGS=false`
- Restart the MCP connection in your host

---

## Next steps

Once connected:

1. Run your first call: [First Calls](/quickstart/first-calls)
2. Initialize Kairo for your project: [Initialization & Performance Tuning](/guides/initialization-and-performance-tuning)
3. Review host integration best practices: [MCP Host Checklist](/integrations/mcp-hosts)

---

## Reference

- [Getting Started (full guide)](/guides/getting-started)
- [MCP host integration](/integrations/mcp-hosts)
- [Configuration reference](/reference/configuration/basics)
