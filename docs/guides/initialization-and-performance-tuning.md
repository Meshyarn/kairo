# Initialization & Performance Tuning

After connecting to your MCP host, Kairo needs to initialize your project and optionally configure performance features.

**Time:** 15-30 min | **Difficulty:** Intermediate

---

## Part A: Project Initialization

### Why initialize?

Initialization (via `manage({ command: "init" })`) does several important things:

1. **Creates `.kairo/` directory** with proper structure
2. **Generates language configuration** (if needed)
3. **Builds initial indexes** for lexical search
4. **Sets up storage for embeddings/caches**
5. **Validates your project structure** and reports issues

If you skip this, Kairo will still work, but:
- First calls will be much slower (on-demand indexing)
- Language detection might be inaccurate
- Embedding caching won't be available

### Running initialization

#### From your MCP host

```bash
# In Claude CLI, Cline, or another agent:
manage({ command: "init" })
```

Response (on success):

```json
{
  "success": true,
  "message": "Kairo initialized for /path/to/project",
  "details": {
    "languagesDetected": ["typescript", "python", "json"],
    "projectStructure": {
      "sourceFiles": 1234,
      "configFiles": 45,
      "testFiles": 89
    },
    "indexingStatus": "complete",
    "nextSteps": [
      "Configure embeddings (optional): KAIRO_EMBEDDING_PROVIDER=local",
      "Run performance profiling: manage({ command: 'status' })"
    ]
  }
}
```

#### From CLI (development)

```bash
# If running Kairo locally
node dist/index.js --root /path/to/project

# Then send over stdio:
echo '{"command":"manage","payload":{"command":"init"}}' | node dist/index.js --root /path/to/project
```

### What gets created

```
.kairo/
├── .kairo.lock          # Project lock file (prevents concurrent access)
├── kairo.log            # Main log file
├── storage/
│   ├── v1/
│   │   ├── index/       # Lexical search indexes
│   │   ├── embeddings/  # Vector embeddings (if enabled)
│   │   └── metadata/    # Index metadata
│   └── cache/           # Query result caches
├── .mcp.json            # MCP configuration (auto-created or manual)
├── language.json        # Language configuration
└── state/               # Session and transaction state
```

---

## Part B: Performance Configuration

After initialization, you can configure performance features:

### 1. MCP Configuration (`.mcp.json`)

Kairo auto-generates `.kairo/.mcp.json` during init, but you can customize it:

```json
{
  "version": "1.0",
  "profile": "balanced",
  "features": {
    "lexicalSearch": {
      "enabled": true,
      "provider": "tantivy"
    },
    "vectorSearch": {
      "enabled": true,
      "provider": "local",
      "model": "multilingual-e5-small"
    },
    "graphRAG": {
      "enabled": false,
      "depth": "standard"
    },
    "caching": {
      "enabled": true,
      "ttl": 3600
    }
  },
  "performance": {
    "maxConcurrency": 4,
    "timeoutMs": 300000,
    "budget": "balanced"
  },
  "logging": {
    "level": "info",
    "toFile": true,
    "toStdout": false
  }
}
```

**Update strategy:**

```bash
# 1. Check current config
manage({ command: "status" })

# 2. Modify .kairo/.mcp.json (text editor)

# 3. Reload configuration
manage({ command: "reindex" })
```

### 2. Language Configuration (`language.json`)

Kairo auto-detects languages during init and creates `.kairo/language.json`:

```json
{
  "version": "1.0",
  "languages": [
    {
      "name": "typescript",
      "extensions": [".ts", ".tsx"],
      "parserOptions": {
        "parseComments": true,
        "extractSymbols": true
      }
    },
    {
      "name": "python",
      "extensions": [".py"],
      "parserOptions": {
        "parseDocstrings": true,
        "extractSymbols": true
      }
    }
  ],
  "fallback": "json"
}
```

**Customize for your project:**

```bash
# Generate from scratch
kairo-gen-languages --root /path/to/project > .kairo/language.json

# Or edit manually and verify
manage({ 
  command: "status",
  detail: "full"
})
```

Common customizations:

| Scenario | Change |
|----------|--------|
| Large TypeScript mono-repo | Add `"maxDepth": 3` to parser options |
| Python + C extensions | Add both parsers; ensure `.pyx` extensions are recognized |
| Restricted parsing | Set `"parseComments": false` for speed |
| Custom file types | Add to `languages[]` with closest parser |

### 3. GraphRAG Embeddings Setup

For semantic search and better understanding of cross-file dependencies:

#### Prerequisites

- **HuggingFace model** (local or remote)
- **Embedding provider** configured (see [Search & Embeddings](/guides/search-and-embeddings))

#### Enable GraphRAG

Edit `.kairo/.mcp.json`:

```json
{
  "features": {
    "graphRAG": {
      "enabled": true,
      "depth": "standard",
      "modelUrl": "Xenova/multilingual-e5-small"
    }
  }
}
```

Then rebuild indexes:

```bash
manage({ command: "reindex" })
```

This will:
1. Compute embeddings for each symbol/file
2. Build a vector index (HNSW or brute-force)
3. Link related symbols across files
4. Cache embeddings for faster queries

**Monitor progress:**

```bash
# Watch logs in real-time
tail -f .kairo/kairo.log | grep "graphrag\|embedding\|index"

# Or check status
manage({ command: "status" })
```

### 4. Rebuild & Reindex

After configuration changes, always reindex:

```bash
# Full rebuild (slowest; clears all caches)
manage({ command: "reindex" })

# Incremental reindex (faster; only changes)
manage({ command: "reindex", options: { mode: "incremental" } })

# Rebuild specific language
manage({ command: "reindex", options: { language: "typescript" } })
```

**Expected times:**

| Repo size | Lexical only | + GraphRAG |
|-----------|--------------|-----------|
| < 100 files | 5-10s | 15-30s |
| 100-1000 files | 30-60s | 2-5 min |
| 1000-5000 files | 2-10 min | 10-30 min |
| 5000+ files | 15-60 min | 45-180 min |

---

## Part C: Validation & Performance Check

After initialization, validate your setup:

### 1. Check project structure

```bash
manage({
  command: "status",
  detail: "full"
})
```

Look for:

```json
{
  "indexHealth": {
    "state": "healthy",
    "fileCount": 1234,
    "lastIndexTime": "2026-01-24T12:34:56Z",
    "staleness": "0s"
  },
  "languages": {
    "typescript": { "count": 800, "status": "indexed" },
    "python": { "count": 100, "status": "indexed" }
  },
  "features": {
    "lexicalSearch": "available",
    "vectorSearch": "available",
    "graphRAG": "ready"
  },
  "nativeCore": {
    "available": true,
    "version": "0.7.0"
  }
}
```

### 2. Run a test search

```bash
task({
  request: "Find all authentication functions in the codebase",
  mode: "auto"
})
```

Verify:
- Response time (p50 < 100ms for cached, < 1s for cold)
- Result relevance (top 5 results are actually relevant)
- No errors in logs

### 3. Monitor resource usage

Check memory and CPU during operations:

```bash
# Terminal 1: watch logs
tail -f .kairo/kairo.log

# Terminal 2: run a heavy query
task({
  request: "Analyze cross-file dependencies",
  mode: "auto",
  budget: "deep"
})

# Terminal 3: monitor process
ps aux | grep node | grep kairo
```

Healthy baseline:
- RSS memory: < 500 MB (small project) to < 2 GB (large)
- CPU: spikes during indexing, then idle
- File descriptors: < 256 (indicates no handle leaks)

---

## Quick Configuration Profiles

Use these as starting points:

### Profile: Development (fast iteration)

```bash
export KAIRO_MODE=mcp
export KAIRO_BUDGET=lean
export KAIRO_EMBEDDING_PROVIDER=hash
export KAIRO_ALLOW_STDOUT_LOGS=false
```

Then initialize:

```bash
manage({ command: "init" })
```

**Characteristics:** Fastest startup, indexing on-demand, no semantic search.

### Profile: Team CI/CD (stable, cacheable)

```bash
export KAIRO_MODE=mcp
export KAIRO_BUDGET=balanced
export KAIRO_EMBEDDING_PROVIDER=local
export KAIRO_EMBEDDING_MODEL=multilingual-e5-small
export KAIRO_VECTOR_INDEX=hnsw
export KAIRO_LOG_TO_FILE=true
```

Then initialize and rebuild:

```bash
manage({ command: "init" })
manage({ command: "reindex" })
```

**Characteristics:** Predictable performance, full caching, semantic search ready.

### Profile: Production Agent (high throughput)

```bash
export KAIRO_MODE=mcp
export KAIRO_BUDGET=deep
export KAIRO_EMBEDDING_PROVIDER=local
export KAIRO_EMBEDDING_PACK_FORMAT=float32
export KAIRO_VECTOR_INDEX=hnsw
export KAIRO_VECTOR_INDEX_REBUILD=manual
export NODE_OPTIONS="--max-old-space-size=8192"
```

Then initialize, rebuild, and validate:

```bash
manage({ command: "init" })
manage({ command: "reindex" })
manage({ command: "status", detail: "full" })
```

**Characteristics:** Deep analysis, persistent caches, optimized for agent loops.

---

## Troubleshooting

### "Init failed: cannot write to .kairo/"

```bash
# Check permissions
ls -la .kairo/

# Fix (if needed)
chmod 755 .kairo/
chmod 644 .kairo/*

# Retry
manage({ command: "init" })
```

### "Index build took too long"

- Increase timeout in MCP config: `timeout: 600000`
- Or split by language: `manage({ command: "reindex", options: { language: "typescript" } })`
- Or switch to incremental mode

### "graphRAG failed to initialize"

Check `.kairo/kairo.log`:

```bash
tail -50 .kairo/kairo.log | grep -i "graphrag\|embedding"
```

Common issues:
- Model not found: verify `KAIRO_EMBEDDING_MODEL` path
- Out of memory: increase `NODE_OPTIONS` heap size
- Missing language config: regenerate `language.json`

---

## Next steps

1. **Ready for first calls:** [First Calls](/quickstart/first-calls)
2. **Want deeper performance tuning:** See your scenario in [Deployment Scenarios](/guides/deployment-scenarios)
3. **Need help with embeddings:** [Search & Embeddings](/guides/search-and-embeddings)
