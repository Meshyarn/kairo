# Deployment Scenarios

Real-world configuration profiles for common use cases. Pick your scenario, apply the environment variables, and customize as needed.

**Audience:** Anyone deploying Kairo to production or a team environment.

---

## Quick Scenario Selector

| Your situation | See section | Time to deploy |
|---------------|-------------|----------------|
| Solo dev, local machine | Development | 5 min |
| Team with shared CI/CD | Team CI/CD | 15 min |
| Agent / AI system | Production Agent | 20 min |
| Restricted / air-gapped | Air-gapped | 10 min |
| Low-resource environment | Resource Constrained | 10 min |

---

## Scenario 1: Development (Local Machine)

**Who:** Individual developer, rapid iteration, quick feedback loops.

**Goals:**
- Fastest startup
- Minimal setup
- On-demand indexing (no pre-warming needed)
- Don't care about persistent caches

### Environment Variables

```bash
export KAIRO_MODE=mcp
export KAIRO_BUDGET=lean
export KAIRO_EMBEDDING_PROVIDER=hash
export KAIRO_ALLOW_STDOUT_LOGS=false
export KAIRO_LOG_TO_FILE=true
export KAIRO_MAX_RESULTS=15
export NODE_OPTIONS="--max-old-space-size=4096"
```

### Setup Steps

```bash
# 1. Install
npm install kairo

# 2. Quick smoke test
npm run smoke:mcp-mock-client

# 3. Connect to your editor/IDE
# (Configure MCP in Claude/.cline/etc. — see npm-install-and-setup.md)

# 4. First call
task({ request: "List all TypeScript files", mode: "auto" })
```

### Expected Behavior

- **First call:** 50-200ms (cold indexes)
- **Subsequent calls:** 10-50ms (cached)
- **Memory:** 300-500 MB
- **Disk:** Minimal (.kairo/ ~50 MB)

### When to upgrade

- You're sharing code with teammates → Switch to **Team CI/CD**
- Your project is > 5,000 files → Switch to **Production Agent** (add embedding warmup)
- You want semantic search → Add `KAIRO_EMBEDDING_PROVIDER=local`

---

## Scenario 2: Team CI/CD (Shared Container/Build System)

**Who:** DevOps, platform team, shared infrastructure, reproducible builds.

**Goals:**
- Consistent behavior across machines
- Persistent caches (across builds)
- Full search capability (lexical + semantic)
- Predictable performance

### Environment Variables

```bash
export KAIRO_MODE=mcp
export KAIRO_BUDGET=balanced
export KAIRO_EMBEDDING_PROVIDER=local
export KAIRO_EMBEDDING_MODEL=multilingual-e5-small
export KAIRO_EMBEDDING_PACK_FORMAT=float32
export KAIRO_VECTOR_INDEX=hnsw
export KAIRO_VECTOR_INDEX_REBUILD=manual
export KAIRO_LOG_TO_FILE=true
export KAIRO_ALLOW_STDOUT_LOGS=false
export KAIRO_MAX_RESULTS=20
export NODE_OPTIONS="--max-old-space-size=6144"
```

### Setup Steps

```bash
# 1. Install in your CI image (Dockerfile or similar)
RUN npm install kairo

# 2. Initialize in setup phase
npm run kairo-init -- --root /path/to/project

# 3. Build indexes (one-time, cached)
npm run kairo-reindex

# 4. In your CI workflow:
# - Store .kairo/ as artifact (or in persistent volume)
# - On each build: restore .kairo/ → skip init → use cache

# Example GitHub Actions:
- name: Restore Kairo cache
  uses: actions/cache@v3
  with:
    path: .kairo
    key: kairo-${{ hashFiles('package.json') }}

- name: Initialize Kairo (first time only)
  run: npm run kairo-init

- name: Your CI job
  run: npm run your-ci-job
```

### Expected Behavior

- **First build:** 30-90 seconds (initialization + indexing)
- **Cached builds:** < 1 second (restore .kairo/)
- **Query latency:** 20-100ms (p95)
- **Memory:** 600-800 MB
- **Cache hit rate:** 85-95% (after first few queries)

### Cost saving tip

Use `.kairo/.mcp.json` to selectively disable expensive features:

```json
{
  "features": {
    "graphRAG": {
      "enabled": false  // Skip if not needed
    }
  }
}
```

Then reindex:

```bash
manage({ command: "reindex" })
```

---

## Scenario 3: Production Agent (High Throughput)

**Who:** AI agents, autonomous code modification, high-concurrency scenarios.

**Goals:**
- Deep understanding of codebase
- Fast responses (multiple agents querying in parallel)
- Reliable error handling
- Monitor performance continuously

### Environment Variables

```bash
export KAIRO_MODE=mcp
export KAIRO_BUDGET=deep
export KAIRO_EMBEDDING_PROVIDER=local
export KAIRO_EMBEDDING_PACK_FORMAT=float32
export KAIRO_VECTOR_INDEX=hnsw
export KAIRO_VECTOR_INDEX_REBUILD=manual
export KAIRO_VECTOR_INDEX_SHARDS=auto
export KAIRO_LOG_TO_FILE=true
export KAIRO_ALLOW_STDOUT_LOGS=false
export KAIRO_MAX_RESULTS=25
export KAIRO_TOOL_SCHEMA_MODE=compat
export NODE_OPTIONS="--max-old-space-size=8192"
```

### Setup Steps

```bash
# 1. Container deployment
docker run \
  --env-file .env.prod \
  --volume /path/to/codebase:/code \
  --volume /path/to/cache:/cache \
  my-kairo-image

# In Dockerfile:
FROM node:18-alpine

WORKDIR /app
COPY package.json .
RUN npm ci

# Pre-build indexes (one-time)
RUN npm run kairo-init -- --root /code
RUN npm run kairo-reindex

ENTRYPOINT ["node", "dist/index.js", "--root", "/code"]
```

### Monitoring & Tuning

```bash
# Check status regularly
manage({
  command: "status",
  detail: "full"
})

# Monitor performance
manage({
  command: "status",
  include: ["performance", "cacheStats", "memoryUsage"]
})

# Response should show:
# {
#   "performance": {
#     "avgLatency": "85ms",
#     "p95Latency": "250ms",
#     "cacheHitRate": "92%"
#   },
#   "memoryUsage": {
#     "rss": "1.8GB",
#     "heapUsed": "1.2GB"
#   }
# }
```

### Performance Tuning

If you see high latency:

```bash
# Check what's slow
manage({ command: "status", include: ["slowQueries"] })

# 1. If bottleneck is vector search:
export KAIRO_VECTOR_INDEX_SHARDS=4  # More shards = faster indexing

# 2. If bottleneck is embedding computation:
# Pre-warm with a broad query
task({ request: "Summarize codebase structure", budget: "deep" })

# 3. If memory is high:
# Reduce batch sizes
export KAIRO_EMBEDDING_PACK_INDEX=bin  # Use binary format
```

### Expected Behavior

- **Setup:** One-time 2-5 minutes (preindex)
- **Query latency:** 50-300ms (p95)
- **Throughput:** 50-100 concurrent sessions
- **Memory:** 800 MB - 2 GB (depending on project size)

---

## Scenario 4: Air-gapped / Restricted Environment

**Who:** Financial, healthcare, government sectors with strict security policies.

**Goals:**
- Zero external downloads
- Minimal dependencies
- Offline-first operation
- Compliance-friendly

### Environment Variables

```bash
export KAIRO_MODE=mcp
export KAIRO_BUDGET=lean
export KAIRO_EMBEDDING_PROVIDER=disabled
export KAIRO_ALLOW_STDOUT_LOGS=false
export KAIRO_LOG_TO_FILE=true
export KAIRO_MAX_RESULTS=10
export NODE_OPTIONS="--max-old-space-size=2048"
# No network calls; no model downloads
```

### Setup Steps

```bash
# 1. On a machine WITH internet (air-gapped prep):
npm install kairo
# (This only downloads Node.js dependencies)

# 2. Bundle everything
tar -czf kairo-bundle.tar.gz node_modules/ dist/

# 3. Transfer to air-gapped environment (USB, approved channel)

# 4. Unpack and initialize
tar -xzf kairo-bundle.tar.gz
node dist/index.js --root /path/to/project

# 5. First init call
manage({ command: "init" })
```

### Verification Checklist

```bash
# Verify no external access attempts:
strace -e connect node dist/index.js --root /path 2>&1 | grep -v "unix\|127.0"
# Should see: nothing (no external connections)

# Verify lexical-only search works:
task({
  request: "Find all error handlers",
  mode: "auto"
})
# Should succeed without embeddings

# Check status:
manage({ command: "status" })
# "vectorSearch": "unavailable" (expected)
# "lexicalSearch": "available" (required)
```

### Expected Behavior

- **Startup:** < 500ms
- **Lexical queries:** 10-40ms (p95)
- **Memory:** 250-400 MB
- **Disk:** ~20 MB (.kairo/ indexes)
- **Network requests:** 0

---

## Scenario 5: Resource Constrained (Edge / Embedded)

**Who:** Embedded systems, serverless (cold start sensitive), low-memory environments.

**Goals:**
- Minimal memory footprint
- Fast cold starts
- Lower CPU usage
- Works on edge devices

### Environment Variables

```bash
export KAIRO_MODE=mcp
export KAIRO_BUDGET=lean
export KAIRO_EMBEDDING_PROVIDER=disabled
export KAIRO_LOG_TO_FILE=false  # Skip file I/O overhead
export KAIRO_ALLOW_STDOUT_LOGS=false
export KAIRO_MAX_RESULTS=5  # Smaller result sets
export NODE_OPTIONS="--max-old-space-size=1024"  # 1 GB max
```

### Deployment Profile

```bash
# For AWS Lambda / similar:
HANDLER_MEMORY=512MB  # or higher if needed
TIMEOUT=60s

# For Raspberry Pi / similar:
# Ensure at least 2 GB free RAM
# Consider SSD (not SD card) for .kairo/ storage
```

### Optimization Tips

```bash
# 1. Disable unnecessary features
export KAIRO_PARSING_DEPTH=1  # Only surface-level symbols

# 2. Limit concurrency
export KAIRO_MAX_CONCURRENT_OPS=1

# 3. Use minimal logging
export KAIRO_LOG_LEVEL=error  # Only errors

# 4. Profile your specific workload
time task({ request: "Your typical query", mode: "auto" })
```

### Expected Behavior

- **Cold start:** 300-500ms
- **Warm call latency:** 50-150ms
- **Memory:** 200-300 MB
- **Suitable for:** Queries only (not indexing)

---

## Scenario 6: Custom Multi-Tenant (Advanced)

**Who:** Platform teams, SaaS providers, multi-user scenarios.

**Goals:**
- Isolate projects
- Per-project configuration
- Resource limits per tenant
- Audit logging

### Environment Variables (per tenant)

```bash
# Each tenant gets its own environment
export KAIRO_MODE=mcp
export KAIRO_BUDGET=balanced
export KAIRO_ROOT_PATH=/data/tenants/${TENANT_ID}/codebase
export KAIRO_LOG_TO_FILE=true
export KAIRO_LOG_PATH=/data/tenants/${TENANT_ID}/logs/kairo.log
export KAIRO_TOOL_SCHEMA_MODE=compat
export KAIRO_MAX_RESULTS=20
export NODE_OPTIONS="--max-old-space-size=2048"
```

### Multi-Tenant Setup

```bash
# Docker Compose example
version: '3.8'
services:
  kairo-tenant-1:
    image: my-kairo:latest
    environment:
      TENANT_ID: customer-a
      KAIRO_ROOT_PATH: /projects/customer-a
    volumes:
      - ./projects/customer-a:/projects/customer-a
      - ./cache/customer-a/.kairo:/.kairo

  kairo-tenant-2:
    image: my-kairo:latest
    environment:
      TENANT_ID: customer-b
      KAIRO_ROOT_PATH: /projects/customer-b
    volumes:
      - ./projects/customer-b:/projects/customer-b
      - ./cache/customer-b/.kairo:/.kairo
```

### Resource Limits

```bash
# Prevent one tenant from starving others
KAIRO_MEMORY_LIMIT=2048MB  # Per tenant
KAIRO_TIMEOUT=30000ms      # Per request
KAIRO_MAX_CONCURRENT_REQUESTS=5  # Per tenant

# Monitor each tenant
for tenant in customer-{a,b,c}; do
  echo "=== $tenant ==="
  manage({
    command: "status",
    detail: "full"
  }) | jq .memoryUsage
done
```

---

## Comparison Table

| Aspect | Dev | Team CI/CD | Prod Agent | Air-gapped | Resource-Limited |
|--------|-----|-----------|-----------|-----------|-----------------|
| Setup time | 5 min | 15 min | 20 min | 10 min | 10 min |
| Budget | lean | balanced | deep | lean | lean |
| Embeddings | hash | local | local | disabled | disabled |
| Memory | 300-500 MB | 600-800 MB | 800-2000 MB | 250-400 MB | 200-300 MB |
| Latency (p95) | 50-200ms | 20-100ms | 50-300ms | 10-40ms | 50-150ms |
| Cache persistence | No | Yes | Yes | No | No |
| Best for | Iteration | Reliability | Scale | Security | Efficiency |

---

## Migration Path

**Start simple, scale when needed:**

1. Begin with **Development** (fastest to productive)
2. Add teammates → migrate to **Team CI/CD** (caching + consistency)
3. Going production → **Production Agent** (deep analysis + monitoring)
4. Have compliance needs → add **Air-gapped features**
5. Running on edge → **Resource-Constrained**

---

## Troubleshooting by Scenario

### "My dev setup is slow"
→ Skip embeddings: `KAIRO_EMBEDDING_PROVIDER=disabled`

### "CI builds are inconsistent"
→ Use **Team CI/CD**: cache .kairo/ between builds

### "Agent queries are timing out"
→ Increase timeout in MCP config: `timeout: 600000`

### "I can't access external model URLs"
→ Use **Air-gapped**: `KAIRO_EMBEDDING_PROVIDER=disabled`

### "Out of memory errors"
→ Reduce budget: `KAIRO_BUDGET=lean`

---

## Next Steps

1. **Pick your scenario** and apply the environment variables
2. **Initialize:** `manage({ command: "init" })`
3. **Test:** `task({ request: "Your first query", mode: "auto" })`
4. **Monitor:** `manage({ command: "status", detail: "full" })`
5. **Tune:** Check [Performance & Reliability](/concepts/performance-and-reliability) if needed

For detailed reference, see [Configuration Reference](/reference/configuration/basics).
