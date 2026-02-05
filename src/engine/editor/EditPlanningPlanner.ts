import type { Edit, NormalizationLevel } from "../../types.js";
import { LineCounter } from "../LineCounter.js";
import { createExactRegex, createFuzzyRegex } from "./EditPlanningRegex.js";
import { getNormalizationAttempts } from "./EditPlanningNormalization.js";
import { findLevenshteinCandidates } from "./EditPlanningFuzzy.js";
import { matchesContext, findMatchWithEscapeVariants } from "./EditPlanningMatchFinder.js";
import { computeMatchConfidence } from "./EditPlanningConfidence.js";
import { getLineEndIndex } from "./EditPlanningLineUtils.js";
import type { Match } from "./EditTypes.js";

export const planInsertOperation = (
    content: string,
    edit: Edit,
    lineCounter: LineCounter
): Match => {
    const replacement = edit.replacementString ?? "";
    if (edit.insertMode === "at") {
        const lineNumber = edit.insertLineRange?.start ?? 1;
        if (lineNumber < 1 || lineNumber > lineCounter.lineCount + 1) {
            throw new Error(
                `insertMode "at" requires insertLineRange.start between 1 and ${lineCounter.lineCount + 1}.`
            );
        }
        const insertIndex = lineNumber > lineCounter.lineCount
            ? content.length
            : lineCounter.getCharIndexForLine(lineNumber);
        return {
            start: insertIndex,
            end: insertIndex,
            replacement,
            original: "",
            lineNumber,
            matchType: 'exact'
        };
    }

    if (!edit.targetString) {
        throw new Error(`insertMode "${edit.insertMode}" requires 'targetString' as an anchor.`);
    }

    const anchorEdit: Edit = {
        targetString: edit.targetString,
        replacementString: edit.targetString,
        lineRange: edit.lineRange,
        beforeContext: edit.beforeContext,
        afterContext: edit.afterContext,
        fuzzyMode: edit.fuzzyMode,
        anchorSearchRange: edit.anchorSearchRange,
        indexRange: edit.indexRange,
        normalization: edit.normalization,
        normalizationConfig: edit.normalizationConfig,
        expectedHash: edit.expectedHash,
        contextFuzziness: edit.contextFuzziness
    };

    const anchorMatch = findMatchWithEscapeVariants(content, anchorEdit, lineCounter);
    const anchorLine = anchorMatch.lineNumber;
    let insertIndex: number;
    let lineNumber = anchorLine;

    if (edit.insertMode === "before") {
        insertIndex = lineCounter.getCharIndexForLine(anchorLine);
    } else {
        insertIndex = getLineEndIndex(anchorLine, content.length, lineCounter);
        lineNumber = Math.min(lineCounter.lineCount + 1, anchorLine + 1);
    }

    return {
        start: insertIndex,
        end: insertIndex,
        replacement,
        original: "",
        lineNumber,
        matchType: 'exact'
    };
};

export const findAllMatches = (
    content: string,
    edit: Edit,
    lineCounter: LineCounter
): Match[] => {
    let matches: Match[] = [];

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

    return filteredMatches;
};
