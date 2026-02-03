import type { StrategySearchCandidate } from "../../IntentRouter.js";
import type { DependencyGraph } from "../../../ast/DependencyGraph.js";
import type { IndexStateManager } from "../../../indexing/IndexStateManager.js";
import { metrics } from "../../../utils/MetricsCollector.js";
import { SymbolicGuardEngine } from "../../../engine/validators/symbolic-guard-engine.js";
import { resolveSymbolicGuardConfig } from "../../../config/SymbolicGuardConfig.js";
import { resolveStrategySearchConfig } from "./ChangePillarStrategyUtils.js";
import { evaluateStrategyCandidate } from "./ChangePillarStrategySearchCandidate.js";
import { runStrategySearchMcts } from "./ChangePillarStrategySearchMcts.js";
import type { StrategySearchEvaluationArgs } from "./ChangePillarStrategySearchTypes.js";

export const evaluateStrategySearch = async (
  args: StrategySearchEvaluationArgs
): Promise<{ selected?: StrategySearchCandidate; summary?: any } | null> => {
  const config = resolveStrategySearchConfig(args.strategy);
  if (!config) return null;

  const summary: any = {
    mode: config.mode,
    stage: config.stage,
    candidates: [],
    degradedReasons: []
  };

  const recordDegraded = (reason: string, data?: Record<string, unknown>) => {
    summary.degradedReasons.push(reason);
    if (args.traceBuilder) {
      args.traceBuilder.recordEvent({
        area: "policy",
        code: "strategy_search_degraded",
        data: { reason, ...(data ?? {}) }
      });
    }
  };

  const recordCandidateTrace = (
    candidateSummary: any,
    detail: {
      targetFilesCount?: number;
      shouldBatch?: boolean;
      diffMode?: string;
      includeImpact?: boolean;
      durationMs?: number;
    } = {}
  ) => {
    if (!args.traceBuilder) return;
    args.traceBuilder.recordEvent({
      area: "policy",
      code: "strategy_search_candidate",
      data: {
        id: candidateSummary.id,
        label: candidateSummary.label,
        dryRunOk: candidateSummary.dryRunOk,
        ...(candidateSummary.errorCode ? { errorCode: candidateSummary.errorCode } : {}),
        ...(typeof candidateSummary.reward === "number" ? { reward: candidateSummary.reward } : {}),
        ...(typeof candidateSummary.touchedFiles === "number" ? { touchedFiles: candidateSummary.touchedFiles } : {}),
        ...(typeof candidateSummary.diffSize === "number" ? { diffSize: candidateSummary.diffSize } : {}),
        ...(typeof candidateSummary.estimatedTokens === "number"
          ? { estimatedTokens: candidateSummary.estimatedTokens }
          : {}),
        ...(typeof candidateSummary.contractBreaking === "number"
          ? { contractBreaking: candidateSummary.contractBreaking }
          : {}),
        ...(typeof candidateSummary.contractConsumers === "number"
          ? { contractConsumers: candidateSummary.contractConsumers }
          : {}),
        ...(typeof candidateSummary.guardsHigh === "number"
          ? { guardsHigh: candidateSummary.guardsHigh }
          : {}),
        ...(typeof candidateSummary.guardsDiagnostics === "number"
          ? { guardsDiagnostics: candidateSummary.guardsDiagnostics }
          : {}),
        ...(candidateSummary.riskLevel ? { riskLevel: candidateSummary.riskLevel } : {}),
        ...(Array.isArray(candidateSummary.degradedReasons) && candidateSummary.degradedReasons.length > 0
          ? { degradedReasons: candidateSummary.degradedReasons }
          : {}),
        ...(candidateSummary.rewardBreakdown ? { rewardBreakdown: candidateSummary.rewardBreakdown } : {}),
        ...(typeof detail.targetFilesCount === "number"
          ? { targetFilesCount: detail.targetFilesCount }
          : {}),
        ...(typeof detail.shouldBatch === "boolean" ? { shouldBatch: detail.shouldBatch } : {}),
        ...(typeof detail.diffMode === "string" ? { diffMode: detail.diffMode } : {}),
        ...(typeof detail.includeImpact === "boolean" ? { includeImpact: detail.includeImpact } : {}),
        ...(typeof detail.durationMs === "number" ? { durationMs: detail.durationMs } : {})
      }
    });
  };

  if (config.mode === "off" || config.stage === "r0") {
    if (args.traceBuilder) {
      args.traceBuilder.recordEvent({
        area: "policy",
        code: "strategy_search_skipped",
        data: {
          reason: config.mode === "off" ? "mode_off" : "stage_r0",
          mode: config.mode,
          stage: config.stage
        }
      });
    }
    return { summary };
  }

  if (!Array.isArray(config.candidates) || config.candidates.length === 0) {
    recordDegraded("reasoning_candidates_missing");
    return { summary };
  }

  const stageLimit = config.stage === "r2" ? 3 : 2;
  const maxCandidates = config.stage === "r3"
    ? config.maxCandidates
    : Math.min(config.maxCandidates, stageLimit);
  const candidates = config.candidates.slice(0, maxCandidates) as StrategySearchCandidate[];
  const normalizedCandidates = candidates.map((candidate, index) => {
    const id = typeof candidate.id === "string" && candidate.id.length > 0
      ? candidate.id
      : `candidate_${index + 1}`;
    const candidateWithId = candidate.id === id ? candidate : { ...candidate, id };
    return { candidate: candidateWithId, id };
  });
  const candidateLookup = new Map<string, StrategySearchCandidate>();
  for (const entry of normalizedCandidates) {
    candidateLookup.set(entry.id, entry.candidate);
  }
  if (config.candidates.length > normalizedCandidates.length) {
    recordDegraded("reasoning_candidates_truncated", {
      requestedCount: config.candidates.length,
      usedCount: normalizedCandidates.length
    });
  }

  if (args.traceBuilder) {
    args.traceBuilder.recordEvent({
      area: "policy",
      code: "strategy_search_start",
      data: {
        mode: config.mode,
        stage: config.stage,
        candidates: normalizedCandidates.length,
        timeboxMs: config.timeboxMs,
        maxImpactMs: config.maxImpactMs,
        maxTouchedFiles: config.maxTouchedFiles,
        maxTokensEstimated: config.maxTokensEstimated
      }
    });
  }

  const startTime = Date.now();
  const deadline = startTime + config.timeboxMs;
  let timeboxExceeded = false;
  const recordTimeboxExceeded = () => {
    if (timeboxExceeded) return;
    timeboxExceeded = true;
    metrics.inc("timeout.change.strategy_search");
  };
  const dependencyGraph = args.registry.getMetadata("dependencyGraph") as DependencyGraph | undefined;
  const indexStateManager = args.registry.getMetadata("indexStateManager") as IndexStateManager | undefined;
  const symbolicGuardConfig = resolveSymbolicGuardConfig();
  const symbolicGuardEnabled = symbolicGuardConfig.enabled && symbolicGuardConfig.mode !== "off";
  const symbolicGuardEngine = symbolicGuardEnabled ? new SymbolicGuardEngine() : undefined;

  const evaluated: Array<any> = [];
  const evaluatedById = new Map<string, any>();
  const evaluateCandidate = async (entry: { candidate: StrategySearchCandidate; id: string }): Promise<any> => {
    const cached = evaluatedById.get(entry.id);
    if (cached) return cached;
    const candidateSummary = await evaluateStrategyCandidate({
      config,
      args,
      dependencyGraph,
      indexStateManager,
      symbolicGuardEngine,
      deadline,
      recordTimeboxExceeded,
      recordCandidateTrace
    }, entry);
    evaluatedById.set(entry.id, candidateSummary);
    evaluated.push(candidateSummary);
    return candidateSummary;
  };

  if (config.stage === "r3") {
    summary.search = (await runStrategySearchMcts({
      config,
      normalizedCandidates,
      candidateLookup,
      evaluateCandidate,
      deadline,
      evaluated,
      traceBuilder: args.traceBuilder,
      recordDegraded,
      recordTimeboxExceeded
    })).search;
  } else {
    for (const entry of normalizedCandidates) {
      if (Date.now() > deadline) {
        recordTimeboxExceeded();
        summary.degradedReasons.push("reasoning_budget_exceeded");
        if (args.traceBuilder) {
          args.traceBuilder.recordEvent({
            area: "budget",
            code: "strategy_search_budget_exceeded",
            data: {
              timeboxMs: config.timeboxMs,
              evaluatedCount: evaluated.length
            }
          });
        }
        break;
      }
      await evaluateCandidate(entry);
    }
  }

  summary.candidates = evaluated;
  const successful = evaluated.filter((item) => item.dryRunOk && typeof item.reward === "number");
  if (successful.length === 0) {
    recordDegraded("reasoning_all_failed", { evaluatedCount: evaluated.length });
    return { summary };
  }

  const best = successful.reduce((acc, current) => (current.reward > acc.reward ? current : acc));
  summary.selectedCandidateId = best.id;
  if (best.rewardBreakdown) {
    summary.selectedRewardBreakdown = best.rewardBreakdown;
  }
  if (args.traceBuilder) {
    args.traceBuilder.recordEvent({
      area: "policy",
      code: "strategy_search_selected",
      data: {
        selected: best.id,
        reward: best.reward,
        evaluatedCount: evaluated.length,
        successCount: successful.length,
        durationMs: Math.max(0, Date.now() - startTime)
      }
    });
  }

  return {
    selected: candidateLookup.get(best.id) ?? normalizedCandidates.find((entry) => entry.id === best.id)?.candidate,
    summary
  };
};
