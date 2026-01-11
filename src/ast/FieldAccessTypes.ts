import type { DegradedReason } from "../types/tool-responses.js";

export type FieldAccessConfidence = "high" | "low";

export interface FieldAccessLocation {
    filePath: string;
    line: number;
    column: number;
    propertyChain: string[];
}

export interface FieldAccessLookup {
    usages: FieldAccessLocation[];
    confidence: FieldAccessConfidence;
    degradedReasons?: DegradedReason[];
}

export interface FieldAccessIndexResult {
    confidence: FieldAccessConfidence;
    degradedReasons?: DegradedReason[];
}

export type FieldAccessIndexKey = {
    packageName: string;
    exportName: string;
    fieldName: string;
};
