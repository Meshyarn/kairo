import { LineCounter } from "../LineCounter.js";
import type { LineRange } from "../../types.js";

export const getLineEndIndex = (
    lineNumber: number,
    contentLength: number,
    lineCounter: LineCounter
): number => {
    if (lineNumber >= lineCounter.lineCount) {
        return contentLength;
    }
    const nextLine = lineNumber + 1;
    if (nextLine > lineCounter.lineCount) {
        return contentLength;
    }
    return lineCounter.getCharIndexForLine(nextLine);
};

export const getCharRangeForLineRange = (
    lineRange: LineRange,
    lineCounter: LineCounter,
    contentLength: number
): { start: number; end: number } => {
    const startIndex = lineCounter.getCharIndexForLine(lineRange.start);
    const endIndex = lineRange.end >= lineCounter.lineCount
        ? contentLength
        : lineCounter.getCharIndexForLine(lineRange.end + 1);
    return { start: startIndex, end: endIndex };
};
