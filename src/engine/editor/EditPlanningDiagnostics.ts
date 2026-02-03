import type { Edit, NormalizationLevel } from "../../types.js";
import { AmbiguousMatchError, type Match } from "./EditTypes.js";
import { computeMatchConfidence } from "./EditPlanningConfidence.js";

export const generateMatchFailureDiagnostics = (
    edit: Edit,
    matches: Match[],
    filteredMatches: Match[],
    options?: { normalizationAttempts?: { level: NormalizationLevel; matchCount: number; }[] }
): string => {
    const diagnostics: string[] = [];
    diagnostics.push(`Target not found: "${edit.targetString}"`);
    diagnostics.push(`\nDiagnostics:`);
    diagnostics.push(`- Matching mode: ${edit.fuzzyMode ?? 'exact'}`);

    if (options?.normalizationAttempts?.length) {
        diagnostics.push(`- Normalization attempts:`);
        for (const attempt of options.normalizationAttempts) {
            diagnostics.push(`  • ${attempt.level}: ${attempt.matchCount} candidate(s)`);
        }
    }

    if (matches.length === 0) {
        diagnostics.push(`- No candidates found at any normalization level.`);
    } else {
        diagnostics.push(`- Found ${matches.length} candidate(s) before filtering.`);
        diagnostics.push(`- Candidates after context filters: ${filteredMatches.length}`);

        const scored = matches.map(match => ({
            match,
            confidence: computeMatchConfidence(match, edit, match.normalizationLevel ?? 'exact')
        })).sort((a, b) => b.confidence.score - a.confidence.score);

        diagnostics.push(`\nTop candidates:`);
        for (const entry of scored.slice(0, 3)) {
            const line = entry.match.lineNumber;
            diagnostics.push(
                `  • Line ${line}: ${(entry.confidence.score * 100).toFixed(0)}% (${entry.confidence.reason})`
            );
        }
    }

    diagnostics.push(`\nSuggestions:`);
    diagnostics.push(`- Add beforeContext/afterContext to disambiguate.`);
    diagnostics.push(`- Provide lineRange or indexRange if you know the region.`);
    diagnostics.push(`- Relax normalization (e.g., normalization: "whitespace") or enable fuzzy modes.`);

    return diagnostics.join('\n');
};

export const generateAmbiguousMatchError = (
    content: string,
    edit: Edit,
    matches: Match[]
): AmbiguousMatchError => {
    const scoredMatches = matches.map(m => ({
        ...m,
        confidence: computeMatchConfidence(m, edit, m.normalizationLevel ?? 'exact')
    })).sort((a, b) => (b.confidence?.score ?? 0) - (a.confidence?.score ?? 0));

    const lines = content.split('\n');

    const contextSnippets = scoredMatches.map(m => {
        const line = lines[m.lineNumber - 1];
        const confidencePct = m.confidence ? (m.confidence.score * 100).toFixed(0) : '??';
        return `Line ${m.lineNumber} (confidence: ${confidencePct}%): "${line.trim().substring(0, 80)}..."`;
    });

    const message = [
        `Ambiguous match for "${edit.targetString}". Found ${matches.length} occurrences:`,
        '',
        ...contextSnippets.slice(0, 5),
        matches.length > 5 ? `... and ${matches.length - 5} more.` : '',
        '',
        `Best match appears to be line ${scoredMatches[0].lineNumber}.`,
        `Resolution strategies:`,
        `1. Add lineRange: { start: ${scoredMatches[0].lineNumber}, end: ${scoredMatches[0].lineNumber} }`,
        `2. Add beforeContext/afterContext`
    ].join('\n');

    return new AmbiguousMatchError(message, {
        conflictingLines: matches.map(m => m.lineNumber)
    });
};
