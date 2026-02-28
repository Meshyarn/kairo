import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import type { ToolSpec } from "./tools/ToolSpecRegistry.js";

export async function handleCallTool(args: {
  name: string;
  payload: any;
  toolSpecRegistry: { get: (name: string) => ToolSpec | undefined };
  handlerRegistry: { handle: (name: string, args: any) => Promise<any | null> };
  errorResponse: (errorCode: string, message: string, details?: any) => any;
  ensureResponseHasIsError: (response: any) => void;
  recordToolCallTelemetry: (name: string) => void;
  recordResponseTelemetry: (name: string, response: any) => void;
  recordBetaTelemetry: (name: string, payloadArgs: any, response: any, startedAt: number) => void;
}): Promise<any> {
  const {
    name,
    payload,
    toolSpecRegistry,
    handlerRegistry,
    errorResponse,
    ensureResponseHasIsError,
    recordToolCallTelemetry,
    recordResponseTelemetry,
    recordBetaTelemetry,
  } = args;

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
    if (!toolSpec) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }

    // Validate required params
    const required = toolSpec.inputSchema?.required ?? [];
    const payloadArgs = payload ?? {};
    const missing = required.filter((key: string) => payloadArgs[key] === undefined || payloadArgs[key] === null);
    if (missing.length > 0) {
      return finalizeResponse(errorResponse("MissingParameter", `Missing required parameter(s): ${missing.join(", ")}`));
    }

    const result = await handlerRegistry.handle(name, payloadArgs);
    if (result !== null && result !== undefined) {
      return finalizeResponse(result);
    }
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  } catch (error: any) {
    if (error instanceof McpError) {
      throw error;
    }
    return finalizeResponse(errorResponse(error?.code ?? "InternalError", error?.message ?? "Unknown error", error?.details));
  }
}
