import { ConfigBootstrapper } from "../../config/ConfigBootstrapper.js";
import { ConfigurationManager } from "../../config/ConfigurationManager.js";
import { EngineManager } from "../../orchestration/capabilities/EngineManager.js";
import { AuditLog } from "../../utils/AuditLog.js";
import type { ManageHandlerDeps } from "./ManageHandlerUtils.js";
import {
  buildBudgetSnapshot,
  buildCapabilityHints,
  buildCostSummary,
  buildEmbeddingFindings,
  buildNativeSearchStatus,
  buildRolloutStatus,
  buildStaleRiskGuidance,
  buildWorkspaceDrift
} from "./ManageStatusUtils.js";
import { buildSchemaSummary, buildWorkflowSummary, generateSchemaArtifactId, resolveToolSpec } from "./ManageWorkflowUtils.js";
import { computeEmbeddingDiagnostics } from "../../embeddings/EmbeddingDiagnostics.js";

export const handleInit = async (deps: ManageHandlerDeps, args: any) => {
  const context = deps.context;
  const bootstrapper = new ConfigBootstrapper(context.rootPath);
  const result = await bootstrapper.init({
    mode: args?.mode,
    targets: args?.targets,
    root: args?.root,
    multiRepo: args?.multiRepo,
    presets: args?.presets,
    languageScan: args?.languageScan,
    applyOptions: args?.applyOptions
  });
  return {
    ...result,
    output: "Config init completed."
  };
};

export const handleDoctor = async (deps: ManageHandlerDeps, args: any) => {
  const context = deps.context;
  const bootstrapper = new ConfigBootstrapper(context.rootPath);
  const result = await bootstrapper.doctor({
    mode: args?.mode,
    scope: args?.scope,
    root: args?.root
  });
  const detail = args?.detail === "full" ? "full" : "summary";
  const capabilityDetail = detail === "full" || args?.scope === "capabilities" ? "full" : "summary";
  let fileCount: number | undefined;
  const dependencyGraph = context.dependencyGraph;
  if (dependencyGraph?.getIndexStatus) {
    try {
      const status = await dependencyGraph.getIndexStatus();
      if (typeof status?.global?.totalFiles === "number") {
        fileCount = status.global.totalFiles;
      }
    } catch {
      fileCount = undefined;
    }
  }
  const includeCapabilities = !args?.scope
    || args?.scope === "capabilities"
    || args?.scope === "host"
    || args?.scope === "parity";
  const capabilityDiagnostics = includeCapabilities
    ? EngineManager.getDiagnosticsSnapshot({
      detail: capabilityDetail,
      rootPath: context.rootPath
    })
    : undefined;
  const capabilityHints = includeCapabilities && capabilityDiagnostics
    ? buildCapabilityHints(capabilityDiagnostics, { detail: capabilityDetail })
    : undefined;
  const overridePolicy = ConfigurationManager.getOverridePolicy();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recentAccepted = await AuditLog.query({
    since,
    filter: { decision: "accepted" },
    limit: 1000
  });
  const auditStats = await AuditLog.stats();
  const indexSnapshot = context.indexStateManager
    ? await context.indexStateManager.getSnapshot()
    : undefined;
  const staleGuidance = indexSnapshot ? buildStaleRiskGuidance(indexSnapshot.staleRisk) : null;
  const metricsExportStatus = context.metricsExportService?.getStatus();
  const budgetSnapshot = await buildBudgetSnapshot(context);
  const embeddingDiagnostics = computeEmbeddingDiagnostics();
  const embeddingFindings = buildEmbeddingFindings(embeddingDiagnostics);
  const nativeSearchStatus = buildNativeSearchStatus(context);
  const rolloutStatus = buildRolloutStatus(context, fileCount);
  const driftStatus = await buildWorkspaceDrift(context);
  const costSummary = buildCostSummary(fileCount);
  const workflowSummary = buildWorkflowSummary(context);
  return {
    ...result,
    output: "Config doctor completed.",
    ...(capabilityDiagnostics ? { capabilityDiagnostics } : {}),
    ...(capabilityHints && capabilityHints.length > 0 ? { capabilityHints } : {}),
    nativeSearch: nativeSearchStatus,
    overridePolicy: {
      enabled: overridePolicy.enabled,
      maxTtlMinutes: overridePolicy.maxTtlMinutes,
      maxFiles: overridePolicy.maxFiles,
      allowed: Object.keys(overridePolicy.allowed)
    },
    overrideAudit: {
      lastEventAt: auditStats.lastEventAt,
      totalEvents: auditStats.total,
      acceptedLast24h: recentAccepted.length,
      ...(overridePolicy.enabled
        ? {}
        : { note: "Override policy is disabled; audit events are historical only." })
    },
    ...(indexSnapshot ? { indexSnapshot } : {}),
    ...(staleGuidance ? { staleGuidance } : {}),
    embeddingDiagnostics,
    ...(embeddingFindings.length > 0 ? { embeddingFindings } : {}),
    ...(budgetSnapshot ? { budget: budgetSnapshot } : {}),
    ...(metricsExportStatus ? { metricsExport: metricsExportStatus } : {}),
    drift: driftStatus,
    cost: costSummary,
    ...workflowSummary,
    rollout: rolloutStatus
  };
};

export const handleSchema = async (deps: ManageHandlerDeps, args: any) => {
  const context = deps.context;
  const toolName = typeof args?.tool === "string"
    ? args.tool
    : (typeof args?.target === "string" ? args.target : "");
  if (!toolName) {
    return { success: false, output: "Missing tool name for schema export." };
  }
  const toolSpec = resolveToolSpec(context, toolName);
  if (!toolSpec) {
    return { success: false, output: `Unknown tool: ${toolName}` };
  }
  const detail = args?.detail === "full" ? "full" : "summary";
  if (detail === "summary") {
    return {
      success: true,
      output: "Schema summary ready.",
      schema: buildSchemaSummary(toolSpec)
    };
  }
  const exportedAt = Date.now();
  const artifactId = generateSchemaArtifactId(exportedAt);
  const schemaExport = {
    tool: toolSpec.name,
    schemaVersion: toolSpec.schemaVersion,
    description: toolSpec.description,
    inputSchema: toolSpec.inputSchema,
    compat: toolSpec.compat,
    exportedAt
  };
  context.flowArtifactManager.store({
    id: artifactId,
    type: "schema",
    createdAt: exportedAt,
    expiresAt: exportedAt + deps.schemaArtifactTtlMs,
    schema: schemaExport
  });
  return {
    success: true,
    output: "Schema export ready.",
    artifactId,
    schemaVersion: toolSpec.schemaVersion
  };
};
