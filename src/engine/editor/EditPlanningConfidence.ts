import levenshtein from "fast-levenshtein";
import type { Edit, MatchConfidence, NormalizationLevel } from "../../types.js";
import type { Match } from "./EditTypes.js";

const getConfidenceReason = (score: number, matchType: Match['matchType']): string => {
    if (score >= 0.95 && matchType === 'exact') {
        return 'Exact match with high certainty';
    }
    if (score >= 0.85) {
        return 'High confidence after constraints';
    }
    if (score >= 0.7) {
        return 'Likely match after normalization';
    }
    if (score >= 0.5) {
        return 'Possible match, review suggested';
    }
    return 'Low confidence match';
};

export const computeMatchConfidence = (
    match: Match,
    edit: Edit,
    normalizationLevel: NormalizationLevel = 'exact'
): MatchConfidence => {
    let baseScore = 0.5;

    switch (match.matchType) {
        case 'exact':
            baseScore = 1.0;
            break;
        case 'normalization': {
            const levelWeights: Record<NormalizationLevel, number> = {
                exact: 1.0,
                "line-endings": 0.95,
                trailing: 0.9,
                indentation: 0.87,
                whitespace: 0.82,
                structural: 0.75
            };
            baseScore = levelWeights[normalizationLevel] ?? 0.7;
            break;
        }
        case 'whitespace-fuzzy':
            baseScore = 0.8;
            break;
        case 'levenshtein': {
            const distance = levenshtein.get(edit.targetString, match.original);
            const maxAllowed = Math.floor(edit.targetString.length * 0.3) || 1;
            baseScore = 0.5 + 0.5 * Math.max(0, 1 - distance / maxAllowed);
            break;
        }
    }

    let contextBoost = 0;
    if (edit.beforeContext) contextBoost += 0.1;
    if (edit.afterContext) contextBoost += 0.1;
    const lineRangeBoost = edit.lineRange ? 0.1 : 0;
    const indexRangeBoost = edit.indexRange ? 0.15 : 0;

    const finalScore = Math.min(1, baseScore + contextBoost + lineRangeBoost + indexRangeBoost);

    return {
        score: finalScore,
        matchType: match.matchType,
        normalizationLevel: normalizationLevel,
        contextBoost,
        lineRangeBoost,
        indexRangeBoost,
        reason: getConfidenceReason(finalScore, match.matchType)
    };
};
