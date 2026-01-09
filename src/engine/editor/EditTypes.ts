import type { DiffMode, MatchConfidence, NormalizationLevel } from "../../types.js";

export interface Match {
    start: number;
    end: number;
    replacement: string;
    original: string;
    lineNumber: number;
    matchType: "exact" | "whitespace-fuzzy" | "levenshtein" | "normalization";
    normalizationLevel?: NormalizationLevel;
    confidence?: MatchConfidence;
}

// ADR-042-005: Phase A2 - PlannedMatch for Resolver
export interface PlannedMatch {
    match: Match;
    candidateCount: number;
    allCandidates?: Match[];
}

export class AmbiguousMatchError extends Error {
    public conflictingLines: number[];

    constructor(message: string, details: { conflictingLines: number[] }) {
        super(message);
        this.name = "AmbiguousMatchError";
        this.conflictingLines = details.conflictingLines;
    }
}

export class HashMismatchError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "HashMismatchError";
    }
}

export class MatchNotFoundError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "MatchNotFoundError";
    }
}

export interface ApplyEditsOptions {
    diffMode?: DiffMode;
}
