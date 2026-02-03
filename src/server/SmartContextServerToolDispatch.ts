import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { FeatureFlags } from "../config/FeatureFlags.js";
import { getToolSchemaMode, normalizeArgs, validateArgs } from "./tools/ToolArgs.js";
import type { ToolSpec } from "./tools/ToolSpecRegistry.js";

export async function handleCallTool(args: {
  name: string;
  payload: any;
  toolSpecRegistry: { get: (name: string) => ToolSpec | undefined };
  handlerRegistry: { handle: (name: string, args: any) => Promise<any | null> };
  internalRegistry: { hasTool: (name: string) => boolean; execute: (name: string, args: any) => Promise<any> };
  orchestrationEngine: { executePillar: (name: string, args: any) => Promise<any> };
  isPillarTool: (name: string) => boolean;
  attachContractMeta: (
    result: any,
    toolSpec: ToolSpec | undefined,
    mode: "compat" | "strict",
    normalized: { args: Record<string, any>; findings: any }
  ) => any;
  wrapLegacyResult: (result: any) => any;
  jsonResponse: (payload: any) => any;
  errorResponse: (errorCode: string, message: string, details?: any) => any;
  ensureResponseHasIsError: (response: any) => void;
  recordToolCallTelemetry: (name: string) => void;
  recordResponseTelemetry: (name: string, response: any) => void;
  recordBetaTelemetry: (name: string, payloadArgs: any, response: any, startedAt: number) => void;
  handleCallToolLegacy?: (params: {
    name: string;
    args: any;
    internalRegistry: { hasTool: (name: string) => boolean; execute: (name: string, args: any) => Promise<any> };
    orchestrationEngine: { executePillar: (name: string, args: any) => Promise<any> };
    isPillarTool: (name: string) => boolean;
    wrapLegacyResult: (result: any) => any;
    jsonResponse: (payload: any) => any;
  }) => Promise<any | null>;
  rolloutContext?: { userId: string };
}): Promise<any> {
  const {
    name,
    payload,
    toolSpecRegistry,
    handlerRegistry,
    internalRegistry,
    orchestrationEngine,
    isPillarTool,
    attachContractMeta,
    wrapLegacyResult,
    jsonResponse,
    errorResponse,
    ensureResponseHasIsError,
    recordToolCallTelemetry,
    recordResponseTelemetry,
    recordBetaTelemetry,
    rolloutContext
  } = args;

  return FeatureFlags.withContext(rolloutContext, async () => {
    recordToolCallTelemetry(name);
    const startedAt = Date.now();
    const finalizeResponse = (response: any) => {
      ensureResponseHasIsError(response);
      recordResponseTelemetry(name, response);
      recordBetaTelemetry(name, payload, response, startedAt);
      return response;
    };
    try {
      const toolSpec = toolSpecRegistry.get(name);
      const mode = getToolSchemaMode();
      const normalized = toolSpec ? normalizeArgs(toolSpec, payload, mode) : { args: payload ?? {}, findings: [], droppedFields: [] };
      if (toolSpec) {
        const validation = validateArgs(toolSpec, normalized.args, mode);
        if (validation.missing.length > 0) {
          return finalizeResponse(errorResponse("MissingParameter", `Missing required parameter(s): ${validation.missing.join(", ")}`));
        }
        if (validation.invalid.length > 0) {
          return finalizeResponse(errorResponse("InvalidArguments", "Invalid arguments.", { invalid: validation.invalid }));
        }
      }
      const useModularHandlers = FeatureFlags.isEnabled(FeatureFlags.MODULAR_HANDLERS_ENABLED, rolloutContext);
      let result: any | null = null;
      if (useModularHandlers) {
        const handlerResult = await handlerRegistry.handle(name, normalized.args);
        if (handlerResult !== null) {
          result = attachContractMeta(handlerResult, toolSpec, mode, normalized);
        }
      } else {
        const legacyHandler = args.handleCallToolLegacy ?? handleCallToolLegacy;
        const legacyResult = await legacyHandler({
          name,
          args: normalized.args,
          internalRegistry,
          orchestrationEngine,
          isPillarTool,
          wrapLegacyResult,
          jsonResponse
        });
        if (legacyResult !== null) {
          result = attachContractMeta(legacyResult, toolSpec, mode, normalized);
        }
      }
      if (result !== null) {
        return finalizeResponse(result);
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    } catch (error: any) {
      if (error instanceof McpError) {
        throw error;
      }
      return finalizeResponse(errorResponse(error?.code ?? "InternalError", error?.message ?? "Unknown error", error?.details));
    }
  });
}

export async function handleCallToolLegacy(params: {
  name: string;
  args: any;
  internalRegistry: { hasTool: (name: string) => boolean; execute: (name: string, args: any) => Promise<any> };
  orchestrationEngine: { executePillar: (name: string, args: any) => Promise<any> };
  isPillarTool: (name: string) => boolean;
  wrapLegacyResult: (result: any) => any;
  jsonResponse: (payload: any) => any;
}): Promise<any | null> {
  const { name, args, internalRegistry, orchestrationEngine, isPillarTool, wrapLegacyResult, jsonResponse } = params;
  if (internalRegistry.hasTool(name)) {
    const result = await internalRegistry.execute(name, args);
    return wrapLegacyResult(result);
  }

  if (isPillarTool(name)) {
    const result = await orchestrationEngine.executePillar(name, args);
    return jsonResponse(result);
  }

  return null;
}
