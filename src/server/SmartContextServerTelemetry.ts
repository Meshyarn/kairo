import { metrics } from "../utils/MetricsCollector.js";
import { hashContent } from "../utils/hash.js";
import type { BetaTelemetryEvent, BetaTelemetryLogger } from "../utils/BetaTelemetryLogger.js";

/** Inline token estimator (replaces deleted orchestration/TokenBudget). */
const estimateTokens = (text: string, _opts?: { languageId?: string }): number => {
    return Math.ceil(text.length / 4);
};

export const recordToolCallTelemetry = (name: string): void => {
    const toolName = typeof name === "string" && name.trim().length > 0 ? name.trim() : "unknown";
    metrics.inc("tool.calls_total");
    metrics.inc(`tool.calls.${toolName}`);
};

export const recordResponseTelemetry = (name: string, response: any): void => {
    try {
        const text = extractResponseText(response);
        if (!text) return;
        const toolName = typeof name === "string" && name.trim().length > 0 ? name.trim() : "unknown";
        const usedChars = text.length;
        metrics.observe("response.envelope.chars", usedChars);
        metrics.observe(`response.envelope.chars.${toolName}`, usedChars);
        const estimatedTokens = estimateTokens(text, { languageId: "json" });
        metrics.observe("response.envelope.tokens", estimatedTokens);
        metrics.observe(`response.envelope.tokens.${toolName}`, estimatedTokens);
        const degradedReasons = extractDegradedReasonTypes(text);
        for (const reason of degradedReasons) {
            metrics.inc(`degraded.reason.${reason}`);
        }
    } catch {
        // ignore telemetry failures
    }
};

export const recordBetaTelemetry = (args: {
    name: string;
    payloadArgs: any;
    response: any;
    startedAt: number;
    betaTelemetry?: BetaTelemetryLogger;
}): void => {
    if (!args.betaTelemetry) return;
    try {
        const toolName = typeof args.name === "string" && args.name.trim().length > 0 ? args.name.trim() : "unknown";
        const text = extractResponseText(args.response);
        const responseChars = text?.length ?? 0;
        const responseTokens = text ? estimateTokens(text, { languageId: "json" }) : undefined;
        const payload = safeParsePayload(text);
        const event: BetaTelemetryEvent = {
            tool: toolName,
            surface: "kairo",
            latencyMs: Math.max(0, Date.now() - args.startedAt),
            responseChars: responseChars > 0 ? responseChars : undefined,
            responseTokens,
            status: resolvePayloadStatus(payload, args.response),
            errorCode: resolvePayloadErrorCode(payload, args.response),
            degraded: typeof payload?.degraded === "boolean" ? payload.degraded : undefined,
            degradedReasons: Array.isArray(payload?.degradedReasons) ? payload.degradedReasons : undefined,
            contractFindingCodes: extractContractFindingCodes(payload),
            ...buildBetaInputSummary(toolName, args.payloadArgs)
        };
        args.betaTelemetry.record(event);
    } catch {
        // ignore beta telemetry failures
    }
};

const safeParsePayload = (text?: string): any | undefined => {
    if (!text) return undefined;
    const trimmed = text.trim();
    if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) {
        return undefined;
    }
    if (trimmed.length > 200_000) {
        return undefined;
    }
    try {
        return JSON.parse(trimmed);
    } catch {
        return undefined;
    }
};

const resolvePayloadStatus = (payload: any, response: any): "ok" | "error" | undefined => {
    if (payload?.ok === true || payload?.success === true) return "ok";
    if (payload?.ok === false || payload?.success === false) return "error";
    if (response?.isError === true) return "error";
    return undefined;
};

const resolvePayloadErrorCode = (payload: any, response: any): string | undefined => {
    if (typeof payload?.errorCode === "string") return payload.errorCode;
    if (typeof payload?.result?.errorCode === "string") return payload.result.errorCode;
    const text = response?.content?.[0]?.text;
    if (typeof text === "string" && text.includes("MissingParameter")) return "MissingParameter";
    return undefined;
};

const extractContractFindingCodes = (payload: any): string[] | undefined => {
    const findings = payload?.contract?.findings;
    if (!Array.isArray(findings)) return undefined;
    const codes = findings
        .map((entry: any) => entry?.code)
        .filter((code: any) => typeof code === "string") as string[];
    return codes.length > 0 ? codes.slice(0, 8) : undefined;
};

const buildBetaInputSummary = (toolName: string, args: any): Partial<BetaTelemetryEvent> => {
    if (!args || typeof args !== "object") return {};
    const summary: Partial<BetaTelemetryEvent> = {};
    if (toolName === "task") {
        summary.mode = typeof args.mode === "string" ? args.mode : undefined;
        summary.budget = typeof args.budget === "string" ? args.budget : undefined;
        summary.outputFormat = typeof args.output?.format === "string" ? args.output.format : undefined;
        if (typeof args.request === "string" && args.request.trim().length > 0) {
            summary.requestHash = hashContent(args.request.trim());
        }
    } else if (typeof args.goal === "string" && args.goal.trim().length > 0) {
        summary.requestHash = hashContent(args.goal.trim());
    } else if (typeof args.intent === "string" && args.intent.trim().length > 0) {
        summary.requestHash = hashContent(args.intent.trim());
    } else if (typeof args.query === "string" && args.query.trim().length > 0) {
        summary.requestHash = hashContent(args.query.trim());
    }

    summary.editsCount = Array.isArray(args.edits) ? args.edits.length : undefined;
    summary.pathsCount = Array.isArray(args.paths) ? args.paths.length : undefined;
    summary.targetFilesCount = Array.isArray(args.targetFiles) ? args.targetFiles.length : undefined;
    return summary;
};

const extractResponseText = (response: any): string | undefined => {
    if (!response || typeof response !== "object") return undefined;
    const content = (response as any).content;
    if (!Array.isArray(content)) return undefined;
    const parts: string[] = [];
    for (const item of content) {
        if (item?.type === "text" && typeof item.text === "string") {
            parts.push(item.text);
        }
    }
    return parts.length > 0 ? parts.join("\n") : undefined;
};

const extractDegradedReasonTypes = (text: string): string[] => {
    const trimmed = text.trim();
    if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) {
        return [];
    }
    let payload: any;
    try {
        payload = JSON.parse(trimmed);
    } catch {
        return [];
    }
    return collectDegradedReasonTypes(payload);
};

const collectDegradedReasonTypes = (payload: any): string[] => {
    const seen = new Set<string>();
    const stack: any[] = [payload];
    let guard = 0;
    while (stack.length > 0 && guard < 500) {
        const current = stack.pop();
        guard += 1;
        if (!current || typeof current !== "object") continue;
        if (Array.isArray(current)) {
            const limit = Math.min(current.length, 50);
            for (let i = 0; i < limit; i += 1) {
                const entry = current[i];
                if (entry && typeof entry === "object") {
                    stack.push(entry);
                }
            }
            continue;
        }
        const degradedSets = [
            (current as any).degradedReasons,
            (current as any).degradedReasonDetails
        ];
        for (const reasons of degradedSets) {
            if (!Array.isArray(reasons)) continue;
            for (const entry of reasons) {
                if (typeof entry === "string" && entry.trim().length > 0) {
                    seen.add(entry.trim());
                    continue;
                }
                if (entry && typeof entry === "object") {
                    const type = (entry as any).type ?? (entry as any).code ?? (entry as any).reason;
                    if (typeof type === "string" && type.trim().length > 0) {
                        seen.add(type.trim());
                    }
                }
            }
        }
        const values = Object.values(current);
        const limit = Math.min(values.length, 50);
        for (let i = 0; i < limit; i += 1) {
            const value = values[i];
            if (value && typeof value === "object") {
                stack.push(value);
            }
        }
    }
    return Array.from(seen);
};
