import path from "path";
import type { StrategySearchCandidate, StrategySearchRequest } from "../../IntentRouter.js";
import type { DependencyGraph } from "../../../ast/DependencyGraph.js";
import type { IndexStateManager } from "../../../indexing/IndexStateManager.js";
import type { SymbolicGuardEngine } from "../../../engine/validators/symbolic-guard-engine.js";
import { estimateTokens } from "../../TokenBudget.js";
import { applyEditsToContent } from "../../guardrails/IntegrityGuardrails.js";
import { collectEditPaths, extractEditFilePath } from "./ChangePillarEditUtils.js";
import { executeBatchChange } from "./BatchExecution.js";
import { buildFailureGuidance } from "./ChangePillarReviewUtils.js";
import { mapRiskLevelToScore, resolveCandidateTargets } from "./ChangePillarStrategyUtils.js";
import { normalizeEdits, mapEditsToFiles } from "./EditExecution.js";
import type { StrategySearchEvaluationArgs } from "./ChangePillarStrategySearchTypes.js";

type CandidateTraceDetail = {
  targetFilesCount?: number;
  shouldBatch?: boolean;
  diffMode?: string;
  includeImpact?: boolean;
  durationMs?: number;
};

export type StrategySearchCandidateContext = {
  config: StrategySearchRequest;
  args: StrategySearchEvaluationArgs;
  dependencyGraph?: DependencyGraph;
  indexStateManager?: IndexStateManager;
  symbolicGuardEngine?: SymbolicGuardEngine;
  deadline: number;
  recordTimeboxExceeded: () => void;
  recordCandidateTrace: (candidateSummary: any, detail?: CandidateTraceDetail) => void;
};

export const evaluateStrategyCandidate = async (
  context: StrategySearchCandidateContext,
  entry: { candidate: StrategySearchCandidate; id: string }
): Promise<any> => {
  const { config, args } = context;
  const candidate = entry.candidate;
  const candidateStart = Date.now();
  const simulationDeadline = candidateStart + config.maxSimulationMs;
  const candidateSummary: any = {
    id: entry.id,
    label: candidate.label,
    dryRunOk: false
  };
  const appendCandidateDegraded = (reason: string) => {
    candidateSummary.degradedReasons = Array.from(new Set([
      ...(candidateSummary.degradedReasons ?? []),
      reason
    ]));
  };
  const candidateEdits = Array.isArray(candidate.edits) ? candidate.edits : [];
  if (candidateEdits.length === 0) {
    candidateSummary.errorCode = "candidate_edits_missing";
    candidateSummary.message = "Strategy candidate edits are required.";
    context.recordCandidateTrace(candidateSummary, { durationMs: Date.now() - candidateStart });
    return candidateSummary;
  }

  const { targetFiles, targetPath } = resolveCandidateTargets({
    candidate,
    baseTargets: args.baseTargets,
    baseTargetFiles: args.baseTargetFiles
  });
  if (targetFiles.length === 0) {
    candidateSummary.errorCode = "candidate_target_missing";
    candidateSummary.message = "Strategy candidate target is missing.";
    context.recordCandidateTrace(candidateSummary, {
      targetFilesCount: targetFiles.length,
      durationMs: Date.now() - candidateStart
    });
    return candidateSummary;
  }

  const candidateDiffMode = candidate.options?.diffMode ?? args.baseDiffMode;
  const candidateIncludeImpact = typeof candidate.options?.includeImpact === "boolean"
    ? candidate.options.includeImpact
    : args.includeImpact;
  const editPaths = collectEditPaths(candidateEdits);
  const shouldBatch = args.shouldUseBatch(args.baseConstraints, targetFiles, editPaths);

  let diffText = "";
  let diffSize = 0;
  const touchedFiles = targetFiles.length > 0 ? targetFiles.length : editPaths.length;
  let riskScore = 0;
  let riskLevel: string | undefined;
  let breakingChanges = 0;
  let candidateNormalization: ReturnType<typeof normalizeEdits> | undefined;
  let candidateNewContent: string | undefined;
  let contractBreaking = 0;
  let contractConsumers = 0;
  let guardsHigh = 0;
  let guardsDiagnostics = 0;
  let contractPenalty = 0;

  if (shouldBatch) {
    const batchResult = await executeBatchChange(
      {
        intent: args.intent,
        context: args.context,
        rawEdits: candidateEdits,
        targetFiles,
        dryRun: true,
        includeImpact: false,
        dependencyGraph: context.dependencyGraph,
        indexStateManager: context.indexStateManager,
        constraints: args.baseConstraints,
        diffMode: candidateDiffMode
      },
      args.runTool,
      (edit) => extractEditFilePath(edit),
      (failureArgs) => buildFailureGuidance(failureArgs)
    );
    candidateSummary.dryRunOk = Boolean(batchResult?.success);
    if (!batchResult?.success) {
      candidateSummary.errorCode = batchResult?.errorCode ?? "candidate_dryrun_failed";
      candidateSummary.message = batchResult?.message ?? "Candidate dry-run failed.";
    } else {
      diffText = typeof batchResult?.diff === "string" ? batchResult.diff : "";
    }
  } else {
    if (!targetPath) {
      candidateSummary.errorCode = "candidate_target_missing";
      candidateSummary.message = "Strategy candidate target is missing.";
      context.recordCandidateTrace(candidateSummary, { durationMs: Date.now() - candidateStart });
      return candidateSummary;
    }
    candidateNormalization = normalizeEdits(candidateEdits, targetPath);
    if (candidateNormalization.edits.length === 0) {
      candidateSummary.errorCode = "candidate_edits_invalid";
      candidateSummary.message = "Strategy candidate edits are invalid.";
      context.recordCandidateTrace(candidateSummary, { durationMs: Date.now() - candidateStart });
      return candidateSummary;
    }
    const editResult = await args.runTool(args.context, "edit_transaction", {
      filePath: targetPath,
      edits: candidateNormalization.edits,
      dryRun: true,
      options: {
        skipImpactPreview: true,
        ...(candidateDiffMode ? { diffMode: candidateDiffMode } : {})
      }
    });
    candidateSummary.dryRunOk = Boolean(editResult?.success);
    if (!editResult?.success) {
      candidateSummary.errorCode = editResult?.errorCode ?? "candidate_dryrun_failed";
      candidateSummary.message = editResult?.message ?? "Candidate dry-run failed.";
    } else {
      diffText = typeof editResult?.diff === "string" ? editResult.diff : "";
      const structured = Array.isArray(editResult?.structuredDiff) ? editResult.structuredDiff[0] : undefined;
      const added = typeof structured?.added === "number" ? structured.added : 0;
      const removed = typeof structured?.removed === "number" ? structured.removed : 0;
      diffSize = added + removed;
      candidateNewContent = typeof editResult?.newContent === "string" ? editResult.newContent : undefined;
    }
  }

  if (candidateSummary.dryRunOk) {
    if (diffSize === 0) {
      diffSize = Math.ceil(diffText.length / 80);
    }
    const estimatedTokens = diffText ? estimateTokens(diffText) : 0;
    candidateSummary.touchedFiles = touchedFiles;
    candidateSummary.diffSize = diffSize;
    candidateSummary.estimatedTokens = estimatedTokens;

    if (touchedFiles > config.maxTouchedFiles || estimatedTokens > config.maxTokensEstimated) {
      candidateSummary.degradedReasons = ["reasoning_budget_exceeded"];
    }

    const simulationBudgetExceeded = Date.now() > simulationDeadline;
    if (simulationBudgetExceeded) {
      appendCandidateDegraded("reasoning_budget_exceeded");
    }

    const impactStart = Date.now();
    const impactDeadline = impactStart + config.maxImpactMs;
    const hasImpactBudget = candidateIncludeImpact
      && config.maxImpactMs > 0
      && !simulationBudgetExceeded
      && impactDeadline <= context.deadline;
    if (hasImpactBudget && targetFiles.length === 1) {
      const impact = await args.runTool(args.context, "impact_analyze", {
        target: targetFiles[0],
        edits: candidateEdits
      });
      riskLevel = impact?.riskLevel ?? impact?.preview?.riskLevel;
      riskScore = mapRiskLevelToScore(riskLevel);
      const breakingNotes = Array.isArray(impact?.notes)
        ? impact.notes.filter((note: any) => typeof note === "string" && note.startsWith("BREAKING CHANGE:"))
        : [];
      breakingChanges = Array.isArray(impact?.breakingChanges)
        ? impact.breakingChanges.length
        : breakingNotes.length;
    } else if (candidateIncludeImpact) {
      appendCandidateDegraded("reasoning_impact_skipped");
    }

    const resolveCandidateContent = async (): Promise<string | undefined> => {
      if (candidateNewContent) return candidateNewContent;
      if (!targetPath) return undefined;
      if (!candidateNormalization) {
        candidateNormalization = normalizeEdits(candidateEdits, targetPath);
      }
      const resolvedTarget = path.resolve(targetPath);
      const scopedEdits = candidateNormalization.edits.filter(
        (edit) => path.resolve(edit.filePath ?? targetPath) === resolvedTarget
      );
      if (scopedEdits.length === 0) {
        return undefined;
      }
      const fileSystem = args.resolveFileSystem();
      if (!await fileSystem.exists(targetPath)) {
        return undefined;
      }
      let existingContent = "";
      try {
        existingContent = await fileSystem.readFile(targetPath);
      } catch {
        return undefined;
      }
      try {
        candidateNewContent = applyEditsToContent(existingContent, scopedEdits).newContent;
      } catch {
        return undefined;
      }
      return candidateNewContent;
    };

    const evaluateContractAndGuards = async (): Promise<void> => {
      if (!hasImpactBudget) {
        if (candidateIncludeImpact) {
          appendCandidateDegraded("reasoning_contract_skipped");
          appendCandidateDegraded("reasoning_guards_skipped");
        }
        return;
      }
      if (Date.now() > context.deadline || Date.now() > impactDeadline) {
        context.recordTimeboxExceeded();
        appendCandidateDegraded("reasoning_budget_exceeded");
        return;
      }

      const contractBreakingSet = new Set<string>();
      const contractConsumerSet = new Set<string>();
      let evaluatedAny = false;

      if (!shouldBatch) {
        if (!targetPath) {
          appendCandidateDegraded("reasoning_contract_skipped");
          appendCandidateDegraded("reasoning_guards_skipped");
          return;
        }
        const content = await resolveCandidateContent();
        if (!content) {
          appendCandidateDegraded("reasoning_contract_skipped");
          appendCandidateDegraded("reasoning_guards_skipped");
          return;
        }
        evaluatedAny = true;
        const contractImpact = await args.buildCrossLangImpact(targetPath, args.context, {
          afterContent: content
        });
        if (contractImpact) {
          const breaking = Array.isArray(contractImpact.breakingExports) ? contractImpact.breakingExports : [];
          const consumers = Array.isArray(contractImpact.consumerFiles) ? contractImpact.consumerFiles : [];
          for (const entry of breaking) {
            contractBreakingSet.add(`${contractImpact.packageName}:${entry}`);
          }
          for (const entry of consumers) {
            contractConsumerSet.add(entry);
          }
          if (contractImpact.degraded && Array.isArray(contractImpact.reasons)) {
            for (const reason of contractImpact.reasons) {
              if (typeof reason === "string" && reason.length > 0) {
                appendCandidateDegraded(reason);
              }
            }
          }
        }
        if (context.symbolicGuardEngine) {
          const guardResult = await context.symbolicGuardEngine.evaluate({ filePath: targetPath, content });
          guardsDiagnostics += guardResult.diagnostics.length;
          guardsHigh += guardResult.diagnostics.filter((diag) => diag.severity === "high").length;
          if (Array.isArray(guardResult.degradedReasons)) {
            for (const reason of guardResult.degradedReasons) {
              if (typeof reason === "string" && reason.length > 0) {
                appendCandidateDegraded(reason);
              }
            }
          }
        } else {
          appendCandidateDegraded("symbolic_guards_disabled");
        }
      } else {
        const mapped = mapEditsToFiles({
          targetFiles,
          rawEdits: candidateEdits,
          fallbackTarget: targetPath,
          extractEditFilePath: (edit) => extractEditFilePath(edit)
        });
        if (mapped.error || !mapped.fileEdits) {
          appendCandidateDegraded("reasoning_contract_skipped");
          appendCandidateDegraded("reasoning_guards_skipped");
          return;
        }
        const fileSystem = args.resolveFileSystem();
        for (const [filePath, editsForFile] of mapped.fileEdits.entries()) {
          if (Date.now() > context.deadline || Date.now() > impactDeadline) {
            context.recordTimeboxExceeded();
            appendCandidateDegraded("reasoning_budget_exceeded");
            break;
          }
          const normalization = normalizeEdits(editsForFile, filePath);
          if (normalization.edits.length === 0) {
            continue;
          }
          if (!await fileSystem.exists(filePath)) {
            continue;
          }
          let existingContent = "";
          try {
            existingContent = await fileSystem.readFile(filePath);
          } catch {
            continue;
          }
          let newContent = "";
          try {
            newContent = applyEditsToContent(existingContent, normalization.edits).newContent;
          } catch {
            continue;
          }
          evaluatedAny = true;
          const contractImpact = await args.buildCrossLangImpact(filePath, args.context, {
            afterContent: newContent
          });
          if (contractImpact) {
            const breaking = Array.isArray(contractImpact.breakingExports) ? contractImpact.breakingExports : [];
            const consumers = Array.isArray(contractImpact.consumerFiles) ? contractImpact.consumerFiles : [];
            for (const entry of breaking) {
              contractBreakingSet.add(`${contractImpact.packageName}:${entry}`);
            }
            for (const entry of consumers) {
              contractConsumerSet.add(entry);
            }
            if (contractImpact.degraded && Array.isArray(contractImpact.reasons)) {
              for (const reason of contractImpact.reasons) {
                if (typeof reason === "string" && reason.length > 0) {
                  appendCandidateDegraded(reason);
                }
              }
            }
          }
          if (context.symbolicGuardEngine) {
            const guardResult = await context.symbolicGuardEngine.evaluate({ filePath, content: newContent });
            guardsDiagnostics += guardResult.diagnostics.length;
            guardsHigh += guardResult.diagnostics.filter((diag) => diag.severity === "high").length;
            if (Array.isArray(guardResult.degradedReasons)) {
              for (const reason of guardResult.degradedReasons) {
                if (typeof reason === "string" && reason.length > 0) {
                  appendCandidateDegraded(reason);
                }
              }
            }
          } else {
            appendCandidateDegraded("symbolic_guards_disabled");
          }
        }
      }

      if (!evaluatedAny) {
        appendCandidateDegraded("reasoning_contract_skipped");
        appendCandidateDegraded("reasoning_guards_skipped");
        return;
      }

      contractBreaking = contractBreakingSet.size;
      contractConsumers = contractConsumerSet.size;
      contractPenalty = contractBreaking + Math.ceil(Math.min(contractConsumers, 20) / 5);
      candidateSummary.contractBreaking = contractBreaking;
      candidateSummary.contractConsumers = contractConsumers;
      candidateSummary.guardsDiagnostics = guardsDiagnostics;
      candidateSummary.guardsHigh = guardsHigh;
    };

    await evaluateContractAndGuards();

    const weights = config.scoring.weights;
    const filesPenalty = weights.files * touchedFiles;
    const diffPenalty = weights.diff * diffSize;
    const tokensPenalty = weights.tokens * estimatedTokens;
    const riskPenalty = weights.risk * riskScore;
    const breakingPenalty = weights.breaking * breakingChanges;
    const contractWeightedPenalty = weights.contract * contractPenalty;
    const guardsPenalty = weights.guardsHigh * guardsHigh;
    const reward = 100
      - filesPenalty
      - diffPenalty
      - tokensPenalty
      - riskPenalty
      - breakingPenalty
      - contractWeightedPenalty
      - guardsPenalty;
    candidateSummary.reward = reward;
    candidateSummary.breakingChanges = breakingChanges;
    candidateSummary.rewardBreakdown = {
      base: 100,
      penalties: {
        files: filesPenalty,
        diff: diffPenalty,
        tokens: tokensPenalty,
        risk: riskPenalty,
        breaking: breakingPenalty,
        contract: contractWeightedPenalty,
        guardsHigh: guardsPenalty
      },
      signals: {
        touchedFiles,
        diffSize,
        estimatedTokens,
        riskScore,
        breakingChanges,
        contractBreaking,
        contractConsumers,
        guardsHigh
      }
    };
    if (riskLevel) {
      candidateSummary.riskLevel = riskLevel;
    }
  }

  context.recordCandidateTrace(candidateSummary, {
    targetFilesCount: targetFiles.length,
    shouldBatch,
    diffMode: candidateDiffMode,
    includeImpact: candidateIncludeImpact,
    durationMs: Date.now() - candidateStart
  });
  return candidateSummary;
};
