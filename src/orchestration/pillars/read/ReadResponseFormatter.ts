import type { DegradedReason } from "../../../types/tool-responses.js";

export type ReadResponsePayload = Record<string, any> & {
    success: boolean;
    status: string;
    message?: string;
    degradedReasons?: DegradedReason[];
};

export function formatReadResponse(payload: ReadResponsePayload): ReadResponsePayload {
    return payload;
}

export function formatReadBlockedResponse(payload: {
    status: string;
    message: string;
    reasons: string[];
    degradedReasons?: DegradedReason[];
}): ReadResponsePayload {
    return {
        success: false,
        status: payload.status,
        message: payload.message,
        reasons: payload.reasons,
        degradedReasons: payload.degradedReasons
    } as ReadResponsePayload;
}
