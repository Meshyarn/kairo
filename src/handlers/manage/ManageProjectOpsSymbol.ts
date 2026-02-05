import { buildDegradedReasons } from "../../orchestration/DegradedReasonMapper.js";
import type { ManageHandlerDeps } from "./ManageHandlerUtils.js";
import { buildSymbolIndexStatus, resolveSymbolSemanticSearchFlags } from "./ManageStatusUtils.js";

export const handleSymbolIndexStatus = (deps: ManageHandlerDeps) => {
  const status = buildSymbolIndexStatus(deps.context);
  return {
    success: true,
    output: "Symbol index status.",
    status,
    ...(status.degradedReasons ? { degradedReasons: status.degradedReasons } : {})
  };
};

export const handleSymbolIndexBuild = async (deps: ManageHandlerDeps) => {
  const context = deps.context;
  const config = resolveSymbolSemanticSearchFlags();
  const reasons: string[] = [];
  if (!config.enabled) {
    reasons.push("symbol_semantic_search_disabled");
  }
  if (config.enabled && !context.symbolEmbeddingIndex) {
    reasons.push("embedding_provider_disabled");
  }
  if (reasons.length > 0) {
    return {
      success: false,
      output: "Symbol semantic search is not available.",
      degradedReasons: buildDegradedReasons(reasons)
    };
  }
  const result = await context.symbolEmbeddingIndex!.buildIndex();
  return {
    success: true,
    output: "Symbol index build completed.",
    result,
    status: context.symbolEmbeddingIndex!.getStatus()
  };
};

export const handleSymbolIndexClear = async (deps: ManageHandlerDeps) => {
  const context = deps.context;
  const config = resolveSymbolSemanticSearchFlags();
  const reasons: string[] = [];
  if (!config.enabled) {
    reasons.push("symbol_semantic_search_disabled");
  }
  if (config.enabled && !context.symbolEmbeddingIndex) {
    reasons.push("embedding_provider_disabled");
  }
  if (reasons.length > 0) {
    return {
      success: false,
      output: "Symbol semantic search is not available.",
      degradedReasons: buildDegradedReasons(reasons)
    };
  }
  const result = await context.symbolEmbeddingIndex!.clearIndex();
  return {
    success: true,
    output: "Symbol index cleared.",
    result,
    status: context.symbolEmbeddingIndex!.getStatus()
  };
};
