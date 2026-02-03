import type { Edit, MatchDiagnostics } from "../../types.js";
import { LineCounter } from "../LineCounter.js";
import {
    HashMismatchError,
    MatchNotFoundError,
    type Match,
    type PlannedMatch
} from "./EditTypes.js";
import {
    normalizeReplacementString,
    decodeEscapeSequences,
    encodeEscapeSequences,
    decodeStructuralEscapeSequences,
    escapeRegExp
} from "./EditPlanningEscapes.js";
import { createExactRegex, createFuzzyRegex, isBoundaryPosition } from "./EditPlanningRegex.js";
import { planInsertOperation, findAllMatches } from "./EditPlanningPlanner.js";
import { findMatchWithEscapeVariants, resolveAmbiguousMatches } from "./EditPlanningMatchFinder.js";
import { computeHash, validateExpectedHash } from "./EditPlanningHash.js";
import { getNormalizationAttempts, normalizeString } from "./EditPlanningNormalization.js";
import { computeMatchConfidence } from "./EditPlanningConfidence.js";
import { trigramKeys, jaccardSimilarity } from "./EditPlanningFuzzy.js";

export class EditPlanner {
    public decodeEscapeSequences(value: string): string {
        return decodeEscapeSequences(value);
    }

    public encodeEscapeSequences(value: string): string {
        return encodeEscapeSequences(value);
    }

    public decodeStructuralEscapeSequences(value: string): string {
        return decodeStructuralEscapeSequences(value);
    }

    public escapeRegExp(value: string): string {
        return escapeRegExp(value);
    }

    public createExactRegex(
        targetString: string,
        mode: Parameters<typeof createExactRegex>[1],
        normalization?: Parameters<typeof createExactRegex>[2]
    ): RegExp {
        return createExactRegex(targetString, mode, normalization);
    }

    public createFuzzyRegex(targetString: string): RegExp {
        return createFuzzyRegex(targetString);
    }

    public getNormalizationAttempts(level?: Parameters<typeof getNormalizationAttempts>[0]) {
        return getNormalizationAttempts(level);
    }

    public normalizeString(
        value: Parameters<typeof normalizeString>[0],
        level: Parameters<typeof normalizeString>[1],
        config?: Parameters<typeof normalizeString>[2]
    ) {
        return normalizeString(value, level, config);
    }

    public computeMatchConfidence(
        match: Parameters<typeof computeMatchConfidence>[0],
        edit: Parameters<typeof computeMatchConfidence>[1],
        normalizationLevel?: Parameters<typeof computeMatchConfidence>[2]
    ) {
        return computeMatchConfidence(match, edit, normalizationLevel);
    }

    public trigramKeys(value: string): Set<string> {
        return trigramKeys(value);
    }

    public jaccardSimilarity(a: Set<string>, b: Set<string>): number {
        return jaccardSimilarity(a, b);
    }

    public isBoundaryPosition(content: string, index: number): boolean {
        return isBoundaryPosition(content, index);
    }

    public applyEditsInternal(originalContent: string, edits: Edit[]): Match[] {
        const lineCounter = new LineCounter(originalContent);
        const plannedMatches: Match[] = [];

        for (const edit of edits) {
            edit.replacementString = normalizeReplacementString(edit.replacementString);

            if (edit.indexRange) {
                const { start, end } = edit.indexRange;

                if (start < 0 || end < start || end > originalContent.length) {
                    throw new Error(
                        `Index range [${start}, ${end}) is out of bounds for file of length ${originalContent.length}.`
                    );
                }

                const existing = originalContent.substring(start, end);
                if (existing !== edit.targetString) {
                    throw new Error(
                        `Content mismatch at index range [${start}, ${end}): expected "${edit.targetString}", found "${existing}".`
                    );
                }

                if (edit.expectedHash) {
                    const computed = computeHash(existing, edit.expectedHash.algorithm);
                    if (computed !== edit.expectedHash.value) {
                        const err = new HashMismatchError(
                            `Hash mismatch detected for index range [${start}, ${end}). Expected ${edit.expectedHash.value}, computed ${computed}.`
                        );
                        (err as any).edit = edit;
                        throw err;
                    }
                }

                plannedMatches.push({
                    start,
                    end,
                    replacement: edit.replacementString,
                    original: existing,
                    lineNumber: lineCounter.getLineNumber(start),
                    matchType: 'exact'
                });
            } else if (edit.insertMode) {
                try {
                    const insertMatch = planInsertOperation(originalContent, edit, lineCounter);
                    plannedMatches.push(insertMatch);
                } catch (error) {
                    (error as any).edit = edit;
                    throw error;
                }
            } else {
                try {
                    const match = findMatchWithEscapeVariants(originalContent, edit, lineCounter);
                    validateExpectedHash(edit, originalContent, match, lineCounter);
                    plannedMatches.push(match);
                } catch (error) {
                    (error as any).edit = edit;
                    throw error;
                }
            }
        }

        for (const match of plannedMatches) {
            if (match.matchType !== 'levenshtein' && match.matchType !== 'whitespace-fuzzy') {
                continue;
            }
            const lineStart = lineCounter.getCharIndexForLine(match.lineNumber);
            if (match.start <= lineStart) {
                continue;
            }
            const prefix = originalContent.substring(lineStart, match.start);
            if (!prefix || !/^[ \t]+$/.test(prefix)) {
                continue;
            }
            const leadingWhitespace = match.replacement.match(/^[ \t]+/)?.[0] ?? '';
            if (leadingWhitespace && match.replacement.startsWith(prefix)) {
                match.replacement = match.replacement.slice(prefix.length);
            }
        }

        plannedMatches.sort((a, b) => a.start - b.start);

        for (let i = 0; i < plannedMatches.length - 1; i++) {
            if (plannedMatches[i].end > plannedMatches[i + 1].start) {
                throw new Error(
                    `Conflict detected: Edit for "${plannedMatches[i].original}" overlaps with "${plannedMatches[i + 1].original}".`
                );
            }
        }

        return plannedMatches;
    }

    public getDiagnostics(content: string, edit: Edit): MatchDiagnostics {
        const lineCounter = new LineCounter(content);
        const diagnostics: MatchDiagnostics = { attempts: [] };

        // Attempt 1: Exact
        diagnostics.attempts.push({
            mode: "exact",
            candidates: [],
            failureReason: "Exact match failed"
        });

        // Attempt 2: Whitespace
        const wsRegex = createExactRegex(edit.targetString, "whitespace", edit.normalizationConfig);
        const wsCandidates: { line: number; snippet: string }[] = [];
        let match;
        while ((match = wsRegex.exec(content)) !== null) {
            wsCandidates.push({
                line: lineCounter.lineAt(match.index),
                snippet: match[0].substring(0, 50) + "..."
            });
        }
        diagnostics.attempts.push({
            mode: "whitespace",
            candidates: wsCandidates,
            failureReason: wsCandidates.length === 0 ? "No whitespace-tolerant matches found" : "Matches found but not selected (ambiguous?)"
        });

        const structuralRegex = createExactRegex(edit.targetString, "structural", edit.normalizationConfig);
        const structuralCandidates: { line: number; snippet: string }[] = [];
        let structuralMatch;
        while ((structuralMatch = structuralRegex.exec(content)) !== null) {
            structuralCandidates.push({
                line: lineCounter.lineAt(structuralMatch.index),
                snippet: structuralMatch[0].substring(0, 50) + "..."
            });
        }
        diagnostics.attempts.push({
            mode: "structural",
            candidates: structuralCandidates,
            failureReason: structuralCandidates.length === 0 ? "No structural matches found" : "Matches found but likely need tighter anchors"
        });

        return diagnostics;
    }

    // ADR-042-005: Phase A2 - Planning API for Resolver
    /**
     * Plans edits from content without applying them.
     * Returns match candidates with diagnostics for Resolver to make decisions.
     */
    public planEditsFromContent(
        content: string,
        edits: Edit[],
        opts?: {
            allowAmbiguousAutoPick?: boolean;
            timeoutMs?: number;
        }
    ): PlannedMatch[] {
        const lineCounter = new LineCounter(content);
        const results: PlannedMatch[] = [];

        for (const edit of edits) {
            try {
                // For indexRange edits, validate directly
                if (edit.indexRange) {
                    const { start, end } = edit.indexRange;
                    if (start < 0 || end > content.length || start > end) {
                        throw new MatchNotFoundError(
                            `Invalid indexRange: start=${start}, end=${end}, contentLength=${content.length}`
                        );
                    }
                    const targetSlice = content.substring(start, end);
                    results.push({
                        match: {
                            start,
                            end,
                            replacement: edit.replacementString,
                            original: targetSlice,
                            lineNumber: lineCounter.getLineNumber(start),
                            matchType: 'exact',
                            normalizationLevel: 'exact'
                        },
                        candidateCount: 1
                    });
                    continue;
                }

                // For insert operations
                if (edit.insertMode) {
                    const insertMatch = planInsertOperation(content, edit, lineCounter);
                    results.push({
                        match: insertMatch,
                        candidateCount: 1
                    });
                    continue;
                }

                // For string-based matching, find all candidates
                const allMatches = findAllMatches(content, edit, lineCounter);

                if (allMatches.length === 0) {
                    throw new MatchNotFoundError(`No match found for target: "${edit.targetString}"`);
                }

                if (allMatches.length === 1) {
                    results.push({
                        match: allMatches[0],
                        candidateCount: 1
                    });
                    continue;
                }

                // Multiple candidates - resolve or return all
                const allowAutoPick = opts?.allowAmbiguousAutoPick ?? true;
                if (allowAutoPick) {
                    const resolved = resolveAmbiguousMatches(allMatches, edit);
                    if (resolved) {
                        results.push({
                            match: resolved,
                            candidateCount: allMatches.length,
                            allCandidates: allMatches
                        });
                        continue;
                    }
                }

                // Return all candidates for Resolver to decide
                results.push({
                    match: allMatches[0], // first as default
                    candidateCount: allMatches.length,
                    allCandidates: allMatches
                });

            } catch (error) {
                // Re-throw with edit context
                (error as any).edit = edit;
                throw error;
            }
        }

        return results;
    }

}
