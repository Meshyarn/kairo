import { buildContractMeta } from "./tools/ToolArgs.js";
import type { ToolSpec } from "./tools/ToolSpecRegistry.js";

export const wrapLegacyResult = (
    result: any,
    jsonResponse: (payload: any) => any,
    textResponse: (text: string) => any
): any => {
    let response: any;
    if (result && typeof result === 'object' && Array.isArray(result.content)) {
        response = result;
    } else if (typeof result === 'string') {
        response = textResponse(result);
    } else {
        response = jsonResponse(result);
    }
    const derivedError = deriveLegacyIsError(result);
    if (typeof derivedError === "boolean" && response && typeof response === "object") {
        response.isError = derivedError;
    }
    return response;
};

export const deriveLegacyIsError = (result: any): boolean | undefined => {
    if (!result || typeof result !== "object") {
        return undefined;
    }
    if (typeof (result as any).isError === "boolean") {
        return (result as any).isError;
    }
    if (typeof (result as any).success === "boolean") {
        return !(result as any).success;
    }
    if (typeof (result as any).errorCode === "string") {
        return true;
    }
    return undefined;
};

export const attachContractMeta = (
    result: any,
    toolSpec: ToolSpec | undefined,
    mode: "compat" | "strict",
    normalized: { args: Record<string, any>; findings: import("./tools/ToolArgs.js").CompatFinding[] },
    jsonResponse: (payload: any) => any
): any => {
    if (!toolSpec) return result;
    if (normalized.args?.trace !== true) return result;
    if (!result || typeof result !== "object" || !Array.isArray(result.content)) {
        return result;
    }
    const text = result.content?.[0]?.text;
    if (typeof text !== "string") return result;
    let payload: any;
    try {
        payload = JSON.parse(text);
    } catch {
        return result;
    }
    if (!payload || typeof payload !== "object") return result;
    if (payload.isError) return result;

    const contract = buildContractMeta(toolSpec, mode, normalized.findings, normalized.args);
    payload.contract = contract;
    if (Array.isArray(contract.findings) && contract.findings.length > 0 && payload.guidance) {
        const warnings = contract.findings.map((finding) => ({
            severity: finding.severity,
            code: finding.code,
            message: finding.message,
            affectedTargets: undefined,
            mitigation: undefined
        }));
        if (Array.isArray(payload.guidance.warnings)) {
            payload.guidance.warnings.push(...warnings);
        } else {
            payload.guidance.warnings = warnings;
        }
    }
    return jsonResponse(payload);
};

export const ensureResponseHasIsError = (response: any): void => {
    if (!response || typeof response !== "object") return;
    if (typeof response.isError === "boolean") return;
    response.isError = response.success === false;
};
