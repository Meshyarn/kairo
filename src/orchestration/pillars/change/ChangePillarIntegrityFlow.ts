import type { IntegrityReport } from "../../../integrity/IntegrityTypes.js";
import { IntegrityEngine } from "../../../integrity/IntegrityEngine.js";
import type { IFileSystem } from "../../../platform/FileSystem.js";
import type { DependencyGraph } from "../../../ast/DependencyGraph.js";
import type { IndexStateManager } from "../../../indexing/IndexStateManager.js";
import { shouldBlockIntegrity, formatIntegrityBlockMessage } from "./IntegrityValidation.js";
import {
  applyEditsToContent,
  evaluateIntegrityGuardrails,
  normalizeGuardrailContent,
  resolveGuardrailTargetPath
} from "../../guardrails/IntegrityGuardrails.js";
import { evaluateIntegrityGuardrailBlock } from "../shared/IntegrityGuardrailDecision.js";
import { buildDraftApplyEdits } from "./ChangePillarReviewUtils.js";

export const runIntegrityPreflight = async (args: {
  integrityOptions: any;
  originalIntent: string;
  targetPath: string;
  dryRun: boolean;
  runTool: (tool: string, toolArgs: any) => Promise<any>;
}): Promise<{ report?: IntegrityReport; blockedResponse?: Record<string, any> }> => {
  if (!args.integrityOptions || args.integrityOptions.mode === "off") {
    return {};
  }
  const report = (await IntegrityEngine.run(
    {
      query: args.originalIntent,
      targetPaths: args.targetPath ? [args.targetPath] : undefined,
      scope: args.integrityOptions.scope ?? "auto",
      sources: args.integrityOptions.sources ?? [],
      limits: args.integrityOptions.limits ?? {},
      mode: args.integrityOptions.mode ?? "preflight"
    },
    (tool, toolArgs) => args.runTool(tool, toolArgs)
  )).report;

  if (!args.dryRun && shouldBlockIntegrity(args.integrityOptions.mode ?? "preflight", args.integrityOptions.blockPolicy, report)) {
    const blockedReport: IntegrityReport = {
      ...report,
      status: "blocked",
      blockedReason: report.blockedReason ?? "high_severity_conflict"
    };
    const blockedSummary = formatIntegrityBlockMessage(blockedReport.topFindings);
    return {
      report,
      blockedResponse: {
        success: false,
        status: "blocked",
        message: blockedSummary,
        operation: "apply",
        targetFile: args.targetPath,
        integrity: blockedReport,
        guidance: {
          message: blockedSummary
        }
      }
    };
  }

  return { report };
};

export const evaluateIntegrityGuardrailsFlow = async (args: {
  targetPath: string;
  fileSystem: IFileSystem;
  useDraftApply: boolean;
  draftContent?: string;
  edits: any[];
  dependencyGraph?: DependencyGraph;
  indexStateManager?: IndexStateManager;
  constraints: any;
  runTool: (tool: string, toolArgs: any) => Promise<any>;
  dryRun: boolean;
  bypassIntegrityGuardrails: boolean;
  workflowWarnings: string[];
  traceBuilder?: { recordEvent?: (event: any) => void; recordSkip?: (area: string, code: string, reason: string) => void };
}): Promise<{
  guardrailResult?: any;
  reviewOriginalContent: string;
  reviewNextContent: string;
  edits: any[];
  blockedResponse?: Record<string, any>;
}> => {
  const guardrailTargetPath = resolveGuardrailTargetPath(args.targetPath);
  let originalContent = "";
  try {
    originalContent = await args.fileSystem.readFile(guardrailTargetPath);
  } catch {
    originalContent = "";
  }
  let nextContent = originalContent;
  let resolvedEdits = args.edits;
  try {
    if (args.useDraftApply && args.draftContent) {
      resolvedEdits = buildDraftApplyEdits({
        filePath: args.targetPath,
        originalContent,
        draftContent: args.draftContent
      });
      nextContent = args.draftContent;
    } else {
      nextContent = applyEditsToContent(originalContent, args.edits).newContent;
    }
  } catch {
    nextContent = originalContent;
  }

  let guardrailResult = await evaluateIntegrityGuardrails({
    targetPath: guardrailTargetPath,
    oldContent: normalizeGuardrailContent(originalContent),
    newContent: normalizeGuardrailContent(nextContent),
    edits: resolvedEdits,
    dependencyGraph: args.dependencyGraph,
    indexStateManager: args.indexStateManager,
    constraints: args.constraints,
    runTool: (tool, toolArgs) => args.runTool(tool, toolArgs),
    applyMode: !args.dryRun
  });

  const guardrailDecision = evaluateIntegrityGuardrailBlock({
    guardrailResult,
    dryRun: args.dryRun,
    bypass: args.bypassIntegrityGuardrails,
    workflowWarnings: args.workflowWarnings,
    warningMessage: "Override bypassed integrity guardrails blocking for this apply.",
    downgradeOnBypass: true
  });
  guardrailResult = guardrailDecision.guardrailResult;
  if (args.traceBuilder?.recordEvent) {
    args.traceBuilder.recordEvent({
      area: "guardrails",
      code: "integrity_guardrails",
      data: { blocked: guardrailDecision.blocked, bypassed: args.bypassIntegrityGuardrails }
    });
  }
  if (guardrailDecision.blocked) {
    if (args.traceBuilder?.recordSkip) {
      args.traceBuilder.recordSkip("integrity_guardrails", "guardrail_blocked", "integrity guardrails blocked apply");
    }
    return {
      guardrailResult,
      reviewOriginalContent: originalContent,
      reviewNextContent: nextContent,
      edits: resolvedEdits,
      blockedResponse: {
        success: false,
        status: "blocked",
        message: guardrailResult.violations?.[0]?.message ?? "Blocked by integrity guardrails.",
        operation: "apply",
        targetFile: args.targetPath,
        architecturalRisk: guardrailResult.architecturalRisk,
        architecturalWarnings: guardrailResult.architecturalWarnings,
        blockingErrors: guardrailResult.blockingErrors,
        errorCode: guardrailResult.errorCode ?? "ARCHITECTURE_BLOCKED",
        blockedReason: guardrailResult.blockedReason ?? "architectural_violation",
        safetyChecklist: guardrailResult.safetyChecklist,
        violations: guardrailResult.violations,
        warnings: guardrailResult.warnings,
        guidance: {
          message: guardrailResult.violations?.[0]?.message ?? "Resolve guardrail violations before retrying."
        }
      }
    };
  }

  return {
    guardrailResult,
    reviewOriginalContent: originalContent,
    reviewNextContent: nextContent,
    edits: resolvedEdits
  };
};
