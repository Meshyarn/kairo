# Agent Benchmark Suite (Reproducible, Judge‑Free First)

This suite implements the automation-first benchmark flow documented in `docs/performance/benchmarks.md` (and `docs/ko/performance/benchmarks.md`).

## Launcher (recommended)

For `cascade.ts` pipelines (route/cascade), use the convenience wrapper which sets `KAIRO_AGENT_MODEL_CMD` for you:

```bash
node benchmarks/agent/launch.mjs --provider codex --help
```

## Quick Start (mock mode)

```bash
node --import tsx benchmarks/agent/run.ts \
  --suite benchmarks/agent/suite.example.json \
  --mode mock
```

Results are written under `benchmarks/runs/<run-id>/` and a Markdown report is generated in `benchmarks/reports/`.

## Real-world suite

Use the expanded suite for practical tasks:

```bash
node --import tsx benchmarks/agent/run.ts \
  --suite benchmarks/agent/suite.realworld.json \
  --mode live \
  --provider codex \
  --model gpt-5.1-codex \
  --tool-mode kairo \
  --log-level progress
```

## Kairo project suite (5 cases)

Use a smaller suite based on the real Kairo source tree (tracked files via `git archive`, no `node_modules/`):

```bash
node --import tsx benchmarks/agent/run.ts \
  --suite benchmarks/agent/suite.kairo5.json \
  --mode live \
  --provider codex \
  --model gpt-5.1-codex \
  --tool-mode kairo
```

## Live mode (Codex CLI login)

Use Codex CLI auth (ChatGPT login), then run the suite via the Codex CLI adapter.

```bash
codex login
export KAIRO_AGENT_MODEL_CMD="node scripts/run-codex-cli-agent.mjs"
export CODEX_TOOL_MODE="kairo"
export CODEX_MODEL="gpt-5.1-codex"
node --import tsx benchmarks/agent/run.ts \
  --suite benchmarks/agent/suite.example.json \
  --mode live \
  --provider codex \
  --model gpt-5.1-codex \
  --tool-mode kairo
```

To run the mini model:

```bash
export CODEX_MODEL="gpt-5.1-codex-mini"
node --import tsx benchmarks/agent/run.ts \
  --suite benchmarks/agent/suite.example.json \
  --mode live \
  --provider codex \
  --model gpt-5.1-codex-mini \
  --tool-mode kairo
```

## Live mode (bring your own model runner)

Provide a command that reads the prompt from stdin and prints **JSON only** to stdout.
The JSON must include `patch_unified_diff`, `final_answer`, and `notes` (minimum schema).  
If you need structured data, encode it as JSON **string** in `final_answer` (recommended).

```bash
export KAIRO_AGENT_MODEL_CMD="node scripts/run-openai-agent.mjs"
export OPENAI_API_KEY="your-api-key"
export OPENAI_MODEL="gpt-5.2"
node --import tsx benchmarks/agent/run.ts \
  --suite benchmarks/agent/suite.example.json \
  --mode live \
  --provider openai \
  --model gpt-5.2
```

The command receives:

- prompt via **stdin**
- environment variable `KAIRO_BENCH_WORKSPACE` pointing to the test workspace

## Live mode (Google Gemini)

Use a Gemini API key (Google AI Studio). The runner reads the prompt from stdin and returns JSON only.

```bash
export KAIRO_AGENT_MODEL_CMD="node scripts/run-gemini-agent.mjs"
export GEMINI_API_KEY="your-gemini-api-key"
node --import tsx benchmarks/agent/run.ts \
  --suite benchmarks/agent/suite.example.json \
  --mode live \
  --provider gemini \
  --model gemini-3.0-pro
```

Login-based auth (gcloud) also works:

```bash
gcloud auth application-default login
export KAIRO_AGENT_MODEL_CMD="node scripts/run-gemini-agent.mjs"
export GEMINI_AUTH_CMD="gcloud auth application-default print-access-token"
node --import tsx benchmarks/agent/run.ts \
  --suite benchmarks/agent/suite.example.json \
  --mode live \
  --provider gemini \
  --model gemini-3.0-pro
```

Mini vs full comparison (matrix):

```bash
node --import tsx benchmarks/agent/matrix.ts \
  --suite benchmarks/agent/suite.realworld.json \
  --provider gemini \
  --mini gemini-3.0-flash \
  --full gemini-3.0-pro
```

## Replay mode

Recompute results from stored transcripts (no model calls).

```bash
node --import tsx benchmarks/agent/run.ts \
  --suite benchmarks/agent/suite.example.json \
  --mode replay \
  --replay-from <run-id>
```

## A/B comparison report

Compare two runs (baseline vs Kairo):

```bash
node --import tsx benchmarks/agent/compare.ts \
  --baseline <run-id-or-path> \
  --kairo <run-id-or-path>
```

## Matrix (4 runs + 3 comparisons)

Runs baseline/kairo for both models and writes a single comparison report.

```bash
node --import tsx benchmarks/agent/matrix.ts \
  --suite benchmarks/agent/suite.example.json \
  --provider codex \
  --mini gpt-5.1-codex-mini \
  --full gpt-5.1-codex \
  --timeout-ms 120000
```

## Cascade (gated mini → Kairo → compare to full baseline)

For the “mini + Kairo can match full + baseline” hypothesis, run a **gated cascade**:

- Stage 1: mini baseline on all cases
- Stage 2: mini Kairo only on gated cases (e.g. failures, cost hotspots, complex cases)
- Stage 3: full baseline on all cases (comparison target)

```bash
node --import tsx benchmarks/agent/cascade.ts \
  --suite benchmarks/agent/suite.realworld.json \
  --mode live \
  --provider codex \
  --mini gpt-5.1-codex-mini \
  --full gpt-5.1-codex \
  --timeout-ms 120000 \
  --kairo-budget low
```

You can also pass `--only` / `--exclude` to focus the cascade on a subset of cases.

Rebuild a cascade report from an existing run without re-running models:

```bash
node --import tsx benchmarks/agent/cascade.ts \
  --replay-from <cascade-run-id-or-path> \
  --out benchmarks/reports/agent-cascade-replay.md
```

This also rewrites the cascade `results.json` summary to match the replayed report.

## Route (static routing: complex → Kairo, others → baseline)

If you want to compare **actual spend** for a system that routes requests up-front (instead of “baseline then rerun”), use the route pipeline:

- Non-complex cases → mini baseline
- Complex cases → mini Kairo
- Full baseline still runs on the same selected set (comparison target)

```bash
node --import tsx benchmarks/agent/cascade.ts \
  --pipeline route \
  --suite benchmarks/agent/suite.kairo5.json \
  --mode live \
  --provider codex \
  --mini gpt-5-codex-mini \
  --full gpt-5-codex \
  --timeout-ms 300000 \
  --kairo-budget low \
  --gate-files-min 4
```

Notes:
- Routing uses the same “complex” heuristic as `--case-scope complex`: `files>=N` or `category ∈ [feature,ci,db,tests]` (override via `--gate-files-min` / `--gate-category`).
- `--gate` flags are ignored in route mode (they are used only for cascade gating).
- You can run the same `cascade.ts` command via the launcher by replacing the first line with `node benchmarks/agent/launch.mjs --provider codex ...` (or `--provider gemini ...`).

## Pricing / Cost (input vs output tokens)

Token totals alone can be misleading because **input vs output tokens are priced differently** (and models have different rates).
You can optionally pass a pricing table so reports include **estimated cost** and gates can rank by cost.

All runners accept `--pricing <path-or-json>` (recommended: a JSON file):

```bash
node --import tsx benchmarks/agent/cascade.ts \
  --suite benchmarks/agent/suite.kairo5.json \
  --mode live \
  --provider codex \
  --mini gpt-5-codex-mini \
  --full gpt-5-codex \
  --pricing benchmarks/agent/pricing.example.json
```

Pricing file format (keys can be `provider/model` or just `model`, with `default` fallback):

```json
{
  "snapshot": "2026-01-26",
  "currency": "USD",
  "models": {
    "codex/gpt-5-codex-mini": { "input_per_1k": 0.0, "output_per_1k": 0.0 },
    "codex/gpt-5-codex": { "input_per_1k": 0.0, "output_per_1k": 0.0 },
    "default": { "input_per_1k": 0.0, "output_per_1k": 0.0 }
  }
}
```

Notes:
- If all rates are `0`, cost is treated as “disabled” and reports show `-`.
- If the runner provides `cached_input_tokens` (Codex CLI does), you can also set `cached_input_per_1k`. If omitted, cached tokens are billed like normal input tokens.
- You can also set `KAIRO_BENCH_PRICING` to the same value as `--pricing` (CLI wins if both are set).

### Cascade gating strategies

- Fail-only (default): `--gate fail`
- Cost-based (top N% by tokens/time): `--gate cost --gate-metric tokens|time|both --gate-top 0.3`
- Complexity-based (files/category): `--gate complex --gate-files-min 2 --gate-category feature,ci,db,tests`
- Combine strategies (union): `--gate fail,cost` (also supports `fail,complex` or `fail,cost,complex`)

### Case scope (baseline/full filtering)

- `--case-scope all` (default): run all selected cases.
- `--case-scope complex`: run **only complex cases** for baseline + full (uses the same `--gate-files-min` / `--gate-category` rules as the complex gate).

### Matrix with case filters

Run only specific cases (comma-separated):

```bash
node --import tsx benchmarks/agent/matrix.ts \
  --suite benchmarks/agent/suite.realworld.json \
  --provider codex \
  --mini gpt-5.1-codex-mini \
  --full gpt-5.1-codex \
  --only rw-cli-flag-001,rw-parse-ids-001
```

Exclude specific cases:

```bash
node --import tsx benchmarks/agent/matrix.ts \
  --suite benchmarks/agent/suite.realworld.json \
  --provider codex \
  --mini gpt-5.1-codex-mini \
  --full gpt-5.1-codex \
  --exclude rw-cli-flag-001
```

Re-run only cases that failed in a previous run:

```bash
node --import tsx benchmarks/agent/matrix.ts \
  --suite benchmarks/agent/suite.realworld.json \
  --provider codex \
  --mini gpt-5.1-codex-mini \
  --full gpt-5.1-codex \
  --only-failed-from <run-id-or-path>
```

Focus on cases where Kairo wins vs baseline:

```bash
node --import tsx benchmarks/agent/matrix.ts \
  --suite benchmarks/agent/suite.realworld.json \
  --provider codex \
  --mini gpt-5.1-codex-mini \
  --full gpt-5.1-codex \
  --only-kairo-wins-from <baseline-run-id-or-path> \
  --kairo-run <kairo-run-id-or-path>
```

## Logging

Use `--log-level summary|progress|verbose` (default: `progress`).

```bash
node --import tsx benchmarks/agent/run.ts \
  --suite benchmarks/agent/suite.realworld.json \
  --mode live \
  --provider codex \
  --model gpt-5.1-codex \
  --tool-mode kairo \
  --log-level verbose
```

## Kairo budget tuning

Use `--kairo-budget` to reduce Kairo token budgets for cost control:

```bash
node --import tsx benchmarks/agent/run.ts \
  --suite benchmarks/agent/suite.realworld.json \
  --mode live \
  --provider codex \
  --model gpt-5.1-codex \
  --tool-mode kairo \
  --kairo-budget low
```

Pass it through matrix runs as well:

```bash
node --import tsx benchmarks/agent/matrix.ts \
  --suite benchmarks/agent/suite.realworld.json \
  --provider codex \
  --mini gpt-5.1-codex-mini \
  --full gpt-5.1-codex \
  --kairo-budget low
```

## Notes

- For Codex CLI auth, use `scripts/run-codex-cli-agent.mjs` and run `codex login` first.
- Use `CODEX_TOOL_MODE=baseline|kairo` (or `--tool-mode`) to toggle Kairo MCP availability.
- Kairo mode keeps `shell_tool` enabled for reliability; the prompt asks the model to avoid raw file reads/shell unless required.
- For OpenAI API keys, use `scripts/run-openai-agent.mjs` and set `OPENAI_API_KEY`.
- `OPENAI_MODEL` controls the model used by the runner; `--model` updates the manifest.
- `CODEX_REASONING_EFFORT` can override `model_reasoning_effort` from `~/.codex/config.toml` (default: `high`).
