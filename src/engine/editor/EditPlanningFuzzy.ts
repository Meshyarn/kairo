import levenshtein from "fast-levenshtein";
import type { LineRange, NormalizationLevel } from "../../types.js";
import { LineCounter } from "../LineCounter.js";
import { isBoundaryPosition } from "./EditPlanningRegex.js";
import { getCharRangeForLineRange, getLineEndIndex } from "./EditPlanningLineUtils.js";
import type { Match } from "./EditTypes.js";

const normalizeTrigramQuery = (input: string): string => {
    return String(input ?? "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
};

export const trigramKeys = (value: string): Set<string> => {
    const normalized = normalizeTrigramQuery(value);
    if (normalized.length < 3) return new Set();
    const keys = new Set<string>();
    for (let i = 0; i <= normalized.length - 3; i++) {
        keys.add(normalized.substring(i, i + 3));
    }
    return keys;
};

export const jaccardSimilarity = (a: Set<string>, b: Set<string>): number => {
    if (a.size === 0 && b.size === 0) {
        return 1;
    }
    let intersection = 0;
    for (const token of a) {
        if (b.has(token)) {
            intersection++;
        }
    }
    const union = a.size + b.size - intersection;
    if (union === 0) {
        return 0;
    }
    return intersection / union;
};

export const findLevenshteinCandidates = (
    content: string,
    target: string,
    replacement: string,
    lineCounter: LineCounter,
    lineRange?: LineRange
): Match[] => {
    const targetLen = target.length;
    const targetHasNewline = /[\r\n]/.test(target.replace(/\r?\n$/, ""));

    if (targetLen >= 256) {
        throw new Error(
            `Levenshtein fuzzy matching works best with strings under 256 characters.\n` +
            `Your target is ${targetLen} characters.\n` +
            `Suggestions:\n` +
            `- Break into smaller edits\n` +
            `- Use fuzzyMode: "whitespace" instead\n` +
            `- Use indexRange for precise character-based replacement`
        );
    }

    const tolerance = targetLen < 10
        ? Math.max(1, Math.floor(targetLen * 0.2))
        : Math.floor(targetLen * 0.3);

    const timeoutMs = 5000;
    const deadline = Date.now() + timeoutMs;
    const targetTrigrams = trigramKeys(target);
    const { start: searchStart, end: searchEnd } = lineRange
        ? getCharRangeForLineRange(lineRange, lineCounter, content.length)
        : { start: 0, end: content.length };

    const lines = content.split(/\r?\n/);
    const strongCandidates: Array<{ lineNumber: number; similarity: number }> = [];
    const allCandidates: Array<{ lineNumber: number; similarity: number }> = [];

    for (let i = 0; i < lines.length; i++) {
        const lineNumber = i + 1;
        if (lineRange && (lineNumber < lineRange.start || lineNumber > lineRange.end)) {
            continue;
        }
        const lineTrigrams = trigramKeys(lines[i]);
        const similarity = jaccardSimilarity(targetTrigrams, lineTrigrams);
        const entry = { lineNumber, similarity };
        allCandidates.push(entry);
        if (similarity >= 0.3) {
            strongCandidates.push(entry);
        }
    }

    if (allCandidates.length === 0) {
        const fallbackLine = Math.min(
            Math.max(1, lineRange?.start ?? 1),
            Math.max(1, lineCounter.lineCount)
        );
        allCandidates.push({ lineNumber: fallbackLine, similarity: 0 });
    }

    let candidates = strongCandidates.length > 0 ? strongCandidates : allCandidates;
    candidates = [...candidates]
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 50);

    const matches: { start: number; end: number; distance: number; original: string }[] = [];
    const MAX_OPS = 100000;
    let ops = 0;
    const minLen = Math.max(1, targetLen - tolerance);
    const maxWindow = targetLen + tolerance;

    for (const candidate of candidates) {
        const lineStart = lineCounter.getCharIndexForLine(candidate.lineNumber);
        const lineEnd = getLineEndIndex(candidate.lineNumber, content.length, lineCounter);
        let windowStart = Math.max(searchStart, Math.max(0, lineStart - maxWindow));
        let windowEnd = Math.min(searchEnd, Math.min(content.length, lineStart + maxWindow * 2));

        if (!targetHasNewline) {
            windowStart = Math.max(searchStart, lineStart);
            windowEnd = Math.min(searchEnd, lineEnd);
        }

        if (windowEnd <= windowStart) {
            continue;
        }

        for (let position = windowStart; position <= windowEnd - minLen; position++) {
            if (!isBoundaryPosition(content, position)) continue;

            const maxCandidateEnd = Math.min(windowEnd, position + maxWindow);
            const usableLength = maxCandidateEnd - position;
            const maxLen = Math.min(usableLength, targetLen + tolerance);

            for (let len = minLen; len <= maxLen; len++) {
                if (Date.now() > deadline) {
                    throw new Error(
                        `Fuzzy match exceeded ${timeoutMs}ms timeout.\n` +
                        `Suggestions:\n` +
                        `- Narrow the search scope with lineRange\n` +
                        `- Use more specific targetString\n` +
                        `- Try fuzzyMode: "whitespace" instead`
                    );
                }

                ops++;
                if (ops > MAX_OPS) {
                    throw new Error(
                        `Fuzzy search exceeded computational limit.\n` +
                        `Suggestions:\n` +
                        `- Add lineRange to narrow search scope\n` +
                        `- Use more specific targetString\n` +
                        `- Try fuzzyMode: "whitespace" instead`
                    );
                }

                const candidateStr = content.substring(position, position + len);
                if (!candidateStr) {
                    continue;
                }

                const localTrigrams = trigramKeys(candidateStr);
                const similarity = jaccardSimilarity(targetTrigrams, localTrigrams);
                if (similarity < 0.2) {
                    continue;
                }

                const distance = levenshtein.get(target, candidateStr);
                if (distance <= tolerance) {
                    matches.push({
                        start: position,
                        end: position + len,
                        distance,
                        original: candidateStr
                    });
                }
            }
        }
    }

    matches.sort((a, b) => a.distance - b.distance || a.start - b.start);
    const uniqueMatches: Match[] = [];

    for (const cand of matches) {
        const isOverlapping = uniqueMatches.some(m =>
            (cand.start >= m.start && cand.start < m.end) ||
            (cand.end > m.start && cand.end <= m.end)
        );

        if (!isOverlapping) {
            const lineNumber = lineCounter.getLineNumber(cand.start);
            uniqueMatches.push({
                start: cand.start,
                end: cand.end,
                replacement,
                original: cand.original,
                lineNumber,
                matchType: 'levenshtein',
                normalizationLevel: 'exact' as NormalizationLevel
            });
        }
    }

    return uniqueMatches;
};
