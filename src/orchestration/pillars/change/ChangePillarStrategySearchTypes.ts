import type { InternalToolRegistry } from "../../InternalToolRegistry.js";
import type { OrchestrationContext } from "../../OrchestrationContext.js";
import type { ParsedIntent, StrategySearchRequest } from "../../IntentRouter.js";
import type { IFileSystem } from "../../../platform/FileSystem.js";
import type { CrossLangImpact } from "../../../types/engine.js";
import type { TraceBuilder } from "../../trace/TraceBuilder.js";

export type StrategySearchEvaluationArgs = {
  strategy: StrategySearchRequest | undefined;
  context: OrchestrationContext;
  intent: ParsedIntent;
  baseConstraints: any;
  baseTargets: string[];
  baseTargetFiles: string[];
  baseDiffMode?: "myers" | "semantic";
  includeImpact: boolean;
  traceBuilder?: TraceBuilder;
  registry: InternalToolRegistry;
  runTool: (context: OrchestrationContext, tool: string, toolArgs: any) => Promise<any>;
  resolveFileSystem: () => IFileSystem;
  shouldUseBatch: (constraints: any, targetFiles: string[], editPaths: string[]) => boolean;
  buildCrossLangImpact: (
    targetPath: string,
    context: OrchestrationContext,
    options?: { force?: boolean; changedExports?: string[]; afterContent?: string }
  ) => Promise<CrossLangImpact | undefined>;
};
