import fs from "node:fs";
import path from "node:path";

process.env.KAIRO_METRICS_MODE = process.env.KAIRO_METRICS_MODE ?? "detailed";

async function main() {
  const { metrics } = await import("../dist/utils/MetricsCollector.js");
  const { evaluateOverrideDecision } = await import("../dist/orchestration/pillars/shared/OverrideDecision.js");
  const { evaluateIntegrityGuardrailBlock } = await import("../dist/orchestration/pillars/shared/IntegrityGuardrailDecision.js");
  const { applyBudgetToExploreItemsWithGlobalLimit, createExploreBudgetState } = await import(
    "../dist/orchestration/pillars/explore/ExploreDecisionEngine.js"
  );
  const { applySkeletonCompressionDecision } = await import(
    "../dist/orchestration/pillars/understand/UnderstandDecisionEngine.js"
  );
  const { evaluateIntegrityGuardrails } = await import("../dist/orchestration/guardrails/IntegrityGuardrails.js");

  metrics.reset();

  const auditLogAppend = async () => "audit-bench";
  await evaluateOverrideDecision({
    constraints: { reviewOptions: { blockOn: [] } },
    targetFiles: ["src/app.ts"],
    pillar: "write",
    auditLogAppend
  });

  const warnings = [];
  evaluateIntegrityGuardrailBlock({
    guardrailResult: { status: "block", blockedReason: "architectural_violation" },
    dryRun: false,
    bypass: true,
    workflowWarnings: warnings,
    warningMessage: "Override bypassed integrity guardrails blocking for this apply.",
    downgradeOnBypass: true
  });

  const state = createExploreBudgetState();
  applyBudgetToExploreItemsWithGlobalLimit({
    state,
    items: [
      { filePath: "src/one.ts", preview: "hello world", score: 1 },
      { filePath: "src/two.ts", preview: "hello world again", score: 1 }
    ],
    isFullContent: false,
    allowDistill: false,
    maxItemTokens: 16,
    maxChars: 1000,
    maxItemChars: 20,
    maxTokens: 64,
    totalTokens: 0,
    degraded: false,
    reasons: [],
    getLanguageId: () => "typescript",
    estimateTokens: () => 8
  });

  applySkeletonCompressionDecision({
    skeleton: "SKELETON",
    filePath: "src/app.ts",
    maxTokens: 8,
    languageId: "typescript",
    buildDigest: () => "DIGEST",
    applyTokenBudget: (text) => ({
      text,
      applied: true,
      usedChars: text.length,
      estimatedTokens: 64
    })
  });

  await evaluateIntegrityGuardrails({
    targetPath: "src/app.ts",
    oldContent: "export const a = 1;",
    newContent: "export const a = 2;",
    constraints: {},
    applyMode: false
  });

  const snapshot = metrics.snapshot();
  console.log(buildReport(snapshot.histograms ?? {}));

  const outDir = path.join("benchmarks", "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `adr-072-decision-metrics-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf-8");
  console.log(`Wrote metrics snapshot to ${outPath}`);
  process.exit(0);
}

function buildReport(histograms) {
  const keys = Object.keys(histograms)
    .filter((key) => key.startsWith("decision.") || key === "guardrails.integrity_total_ms")
    .sort();
  const lines = [];
  lines.push("============================================================");
  lines.push("ADR-072 Phase C: Decision/Guardrails Metrics Snapshot");
  lines.push("============================================================");
  for (const key of keys) {
    const h = histograms[key] ?? { count: 0 };
    lines.push(
      `${key}: count=${h.count} mean=${formatNum(h.mean)} p95=${formatNum(h.p95)} max=${formatNum(h.max)}`
    );
  }
  return lines.join("\n");
}

function formatNum(value) {
  if (!Number.isFinite(value)) return "-";
  return `${value.toFixed(3)}ms`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
