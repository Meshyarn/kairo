import type {
    ContextFuzziness,
    Edit,
    NormalizationConfig,
    NormalizationLevel
} from "../../types.js";
import { LineCounter } from "../LineCounter.js";
import { MatchNotFoundError, type Match } from "./EditTypes.js";
import { decodeEscapeSequences, encodeEscapeSequences } from "./EditPlanningEscapes.js";
import { createExactRegex, createFuzzyRegex } from "./EditPlanningRegex.js";
import { getNormalizationAttempts, normalizeString } from "./EditPlanningNormalization.js";
import { findLevenshteinCandidates } from "./EditPlanningFuzzy.js";
import { computeMatchConfidence } from "./EditPlanningConfidence.js";
import {
    generateAmbiguousMatchError,
    generateMatchFailureDiagnostics
} from "./EditPlanningDiagnostics.js";

const buildEscapeAwareVariants = (edit: Edit): Array<{ edit: Edit; mode: string }> => {
    const variants: Array<{ edit: Edit; mode: string }> = [{ edit, mode: "raw" }];

    const decodedTarget = decodeEscapeSequences(edit.targetString);
    const decodedBefore = typeof edit.beforeContext === "string"
        ? decodeEscapeSequences(edit.beforeContext)
        : undefined;
    const decodedAfter = typeof edit.afterContext === "string"
        ? decodeEscapeSequences(edit.afterContext)
        : undefined;

    if (
        decodedTarget !== edit.targetString ||
        decodedBefore !== edit.beforeContext ||
        decodedAfter !== edit.afterContext
    ) {
        variants.push({
            edit: {
                ...edit,
                targetString: decodedTarget,
                beforeContext: decodedBefore,
                afterContext: decodedAfter
            },
            mode: "decoded"
        });
    }

    const encodedTarget = encodeEscapeSequences(edit.targetString);
    const encodedBefore = typeof edit.beforeContext === "string"
        ? encodeEscapeSequences(edit.beforeContext)
        : undefined;
    const encodedAfter = typeof edit.afterContext === "string"
        ? encodeEscapeSequences(edit.afterContext)
        : undefined;

    if (
        encodedTarget !== edit.targetString ||
        encodedBefore !== edit.beforeContext ||
        encodedAfter !== edit.afterContext
    ) {
        variants.push({
            edit: {
                ...edit,
                targetString: encodedTarget,
                beforeContext: encodedBefore,
                afterContext: encodedAfter
            },
            mode: "encoded"
        });
    }

    return variants;
};

export const findMatchWithEscapeVariants = (
    content: string,
    edit: Edit,
    lineCounter: LineCounter
): Match => {
    const escapeMode = edit.escapeMode ?? 'auto';
    if (escapeMode === 'interpreted' || escapeMode === 'literal') {
        const effectiveEdit = { ...edit };
        if (escapeMode === 'interpreted') {
            effectiveEdit.targetString = decodeEscapeSequences(edit.targetString);
            if (effectiveEdit.replacementString) {
                effectiveEdit.replacementString = decodeEscapeSequences(effectiveEdit.replacementString);
            }
        }
        return findMatch(content, effectiveEdit, lineCounter);
    }

    const variants = buildEscapeAwareVariants(edit);
    const attemptedModes: string[] = [];
    let primaryError: MatchNotFoundError | undefined;
    let lastError: MatchNotFoundError | undefined;

    for (const variant of variants) {
        attemptedModes.push(variant.mode);
        try {
            return findMatch(content, variant.edit, lineCounter);
        } catch (error) {
            if (error instanceof MatchNotFoundError) {
                if (!primaryError) {
                    primaryError = error;
                }
                lastError = error;
                continue;
            }
            throw error;
        }
    }

    const failure = primaryError ?? lastError;
    if (failure) {
        const suffix = `\n\nTried escape-aware variants (modes: ${attemptedModes.join(", ")}), but none matched the target string.`;
        throw new MatchNotFoundError(`${failure.message}${suffix}`);
    }

    throw new MatchNotFoundError(
        `Unable to locate target "${edit.targetString}" even after trying escape-aware variants.`
    );
};

export const findMatch = (
    content: string,
    edit: Edit,
    lineCounter: LineCounter
): Match => {
    let matches: Match[] = [];
    const normalizationDiagnostics: { level: NormalizationLevel; matchCount: number }[] = [];

    if (edit.fuzzyMode === "levenshtein") {
        const exactRegex = createExactRegex(edit.targetString, "exact", edit.normalizationConfig);
        const exactMatches = [...content.matchAll(exactRegex)].map(m => ({
            start: m.index!,
            end: m.index! + m[0].length,
            replacement: edit.replacementString,
            original: m[0],
            lineNumber: lineCounter.getLineNumber(m.index!),
            matchType: 'exact' as const,
            normalizationLevel: 'exact' as NormalizationLevel
        }));

        if (exactMatches.length > 0) {
            matches = exactMatches;
        } else {
            matches = findLevenshteinCandidates(content, edit.targetString, edit.replacementString, lineCounter, edit.lineRange);
        }
    } else if (edit.fuzzyMode === "whitespace") {
        const regex = createFuzzyRegex(edit.targetString);
        matches = [...content.matchAll(regex)].map(m => ({
            start: m.index!,
            end: m.index! + m[0].length,
            replacement: edit.replacementString,
            original: m[0],
            lineNumber: lineCounter.getLineNumber(m.index!),
            matchType: 'whitespace-fuzzy' as const,
            normalizationLevel: 'whitespace' as NormalizationLevel
        }));
    } else {
        const attempts = getNormalizationAttempts(edit.normalization);
        for (const level of attempts) {
            const regex = createExactRegex(edit.targetString, level, edit.normalizationConfig);
            const matchType: Match['matchType'] = level === 'exact' ? 'exact' : 'normalization';
            const attemptMatches = [...content.matchAll(regex)].map(m => ({
                start: m.index!,
                end: m.index! + m[0].length,
                replacement: edit.replacementString,
                original: m[0],
                lineNumber: lineCounter.getLineNumber(m.index!),
                matchType,
                normalizationLevel: level
            }));
            normalizationDiagnostics.push({ level, matchCount: attemptMatches.length });
            if (attemptMatches.length > 0) {
                matches = attemptMatches;
                break;
            }
        }
    }

    const filteredMatches = matches.filter(match => {
        if (edit.lineRange) {
            if (match.lineNumber < edit.lineRange.start || match.lineNumber > edit.lineRange.end) return false;
        }

        if (edit.beforeContext) {
            const searchStart = edit.anchorSearchRange?.chars
                ? Math.max(0, match.start - edit.anchorSearchRange.chars)
                : 0;
            const preceding = content.substring(searchStart, match.start);
            const contextFuzziness = edit.contextFuzziness ?? "normal";
            if (!matchesContext(edit.beforeContext, preceding, contextFuzziness, edit.normalizationConfig)) {
                return false;
            }
        }

        if (edit.afterContext) {
            const searchEnd = edit.anchorSearchRange?.chars
                ? Math.min(content.length, match.end + edit.anchorSearchRange.chars)
                : content.length;
            const following = content.substring(match.end, searchEnd);
            const contextFuzziness = edit.contextFuzziness ?? "normal";
            if (!matchesContext(edit.afterContext, following, contextFuzziness, edit.normalizationConfig)) {
                return false;
            }
        }
        return true;
    });

    for (const match of filteredMatches) {
        match.confidence = computeMatchConfidence(
            match,
            edit,
            match.normalizationLevel ?? 'exact'
        );
    }

    if (filteredMatches.length === 0) {
        throw new MatchNotFoundError(
            generateMatchFailureDiagnostics(edit, matches, filteredMatches, {
                normalizationAttempts: normalizationDiagnostics
            })
        );
    }
    if (filteredMatches.length > 1) {
        const resolved = resolveAmbiguousMatches(filteredMatches, edit);
        if (!resolved) {
            throw generateAmbiguousMatchError(content, edit, filteredMatches);
        }
        return resolved;
    }

    return filteredMatches[0];
};

export const matchesContext = (
    expectedContext: string,
    actualContext: string,
    fuzziness: ContextFuzziness,
    normalizationConfig?: NormalizationConfig
): boolean => {
    switch (fuzziness) {
        case "strict":
            return actualContext.includes(expectedContext);
        case "normal": {
            const normalizeWhitespace = (value: string) =>
                value.replace(/\s+/g, " ").trim();
            return normalizeWhitespace(actualContext).includes(normalizeWhitespace(expectedContext));
        }
        case "loose": {
            const normalizedActual = normalizeString(actualContext, "structural", normalizationConfig);
            const normalizedExpected = normalizeString(expectedContext, "structural", normalizationConfig);
            return normalizedActual.includes(normalizedExpected);
        }
        default:
            return actualContext.includes(expectedContext);
    }
};

export const resolveAmbiguousMatches = (
    matches: Match[],
    edit: Edit
): Match | undefined => {
    const scoredMatches = matches.map(match => ({
        match,
        confidence: computeMatchConfidence(match, edit, match.normalizationLevel ?? 'exact')
    })).sort((a, b) => b.confidence.score - a.confidence.score);

    if (scoredMatches.length < 2) {
        return scoredMatches[0]?.match;
    }

    const best = scoredMatches[0];
    const second = scoredMatches[1];

    if (best.confidence.score >= 0.85 && (best.confidence.score - second.confidence.score) >= 0.15) {
        if (process.env.KAIRO_DEBUG === 'true') {
            console.debug(
                `[EditorEngine] Auto-selected ambiguous match at line ${best.match.lineNumber} ` +
                `(score ${(best.confidence.score * 100).toFixed(1)}%, second ${(second.confidence.score * 100).toFixed(1)}%)`
            );
        }
        return best.match;
    }

    return undefined;
};
