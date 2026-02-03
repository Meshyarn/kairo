import type { OrchestrationContext } from "../../OrchestrationContext.js";
import type { UnifiedContextGraph } from "../../context/UnifiedContextGraph.js";
import type { IFileSystem } from "../../../platform/FileSystem.js";
import { toImpactReport, collectDependentsFromGraph, analyzeSymbolImpact } from "./ImpactAnalysis.js";
import { buildDegradedReasons } from "../../DegradedReasonMapper.js";
import type { CrossLangImpact } from "../../../types/engine.js";

export const createImpactTasks = (args: {
  budget: { allowImpact: boolean };
  targetPath?: string;
  dryRun: boolean;
  includeImpact?: boolean;
  edits: any[];
  context: OrchestrationContext;
  ucg: UnifiedContextGraph;
  includeSymbolImpact: boolean;
  constraints: any;
  fileSystem: IFileSystem;
  runTool: (context: OrchestrationContext, tool: string, toolArgs: any) => Promise<any>;
}) => {
  const allowDependencyAnalysis = args.budget.allowImpact && args.targetPath && (!args.dryRun || args.includeImpact === true);
  const impactPromise = !args.dryRun && args.budget.allowImpact
    ? args.runTool(args.context, "impact_analyze", { target: args.targetPath, edits: args.edits })
    : Promise.resolve(null);
  const dependencyPromise = allowDependencyAnalysis
    ? (async () => {
        const deps = await collectDependentsFromGraph(args.ucg, args.targetPath as string, args.context);
        if (deps) {
          return deps;
        }
        return args.runTool(args.context, "relationship_analyze", { target: args.targetPath, mode: "dependencies", direction: "both" });
      })()
    : Promise.resolve(null);
  const hotSpotPromise = !args.dryRun && args.budget.allowImpact
    ? args.runTool(args.context, "hotspot_detect", {})
    : Promise.resolve([]);
  const symbolImpactPromise = args.includeSymbolImpact && args.targetPath
    ? analyzeSymbolImpact(args.targetPath, args.edits, args.constraints, args.fileSystem)
    : Promise.resolve(null);

  return {
    allowDependencyAnalysis,
    impactPromise,
    dependencyPromise,
    hotSpotPromise,
    symbolImpactPromise
  };
};

export const finalizeImpactReport = async (args: {
  dryRun: boolean;
  allowImpactPreview: boolean;
  finalResult: any;
  impactPromise: Promise<any>;
  dependencyPromise: Promise<any>;
  hotSpotPromise: Promise<any>;
  symbolImpactPromise: Promise<any>;
  includeImpact: boolean;
  crossLangImpact?: CrossLangImpact;
  parityDegradedReasons?: Array<any>;
  targetPath: string;
  guardrailResult?: any;
}): Promise<{
  impact: any;
  deps: any;
  hotSpots: any;
  symbolImpact: any;
  outputCrossLangImpact?: CrossLangImpact;
  impactReport: any;
  architecturalRisk: any;
  architecturalWarnings: string[];
  mergedDegradedReasons: any[];
}> => {
  const impact = args.dryRun ? (args.allowImpactPreview ? (args.finalResult?.impactPreview ?? null) : null) : await args.impactPromise;
  const deps = await args.dependencyPromise;
  const hotSpots = await args.hotSpotPromise;
  const symbolImpact = await args.symbolImpactPromise;
  const outputCrossLangImpact = args.includeImpact ? args.crossLangImpact : undefined;
  const degradedReasonDetails = outputCrossLangImpact?.reasons
    ? buildDegradedReasons(outputCrossLangImpact.reasons, {
        packageName: outputCrossLangImpact.packageName
      })
    : undefined;
  const mergedDegradedReasons = [
    ...(degradedReasonDetails ?? []),
    ...(args.parityDegradedReasons ?? [])
  ];
  let impactReport = toImpactReport(impact, deps, args.targetPath, hotSpots, outputCrossLangImpact);
  const architecturalRisk = args.guardrailResult?.architecturalRisk;
  const architecturalWarnings: string[] = Array.isArray(args.guardrailResult?.architecturalWarnings)
    ? args.guardrailResult.architecturalWarnings
    : [];
  if (impactReport && architecturalRisk?.riskLevel === "high") {
    impactReport = { ...impactReport, breakingChangeRisk: "high" };
  }
  return {
    impact,
    deps,
    hotSpots,
    symbolImpact,
    outputCrossLangImpact,
    impactReport,
    architecturalRisk,
    architecturalWarnings,
    mergedDegradedReasons
  };
};
