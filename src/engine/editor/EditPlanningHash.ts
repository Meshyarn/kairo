import * as crypto from "crypto";
import { createRequire } from "module";
import type { Edit } from "../../types.js";
import type { Match } from "./EditTypes.js";
import { HashMismatchError } from "./EditTypes.js";
import { LineCounter } from "../LineCounter.js";
import { getCharRangeForLineRange } from "./EditPlanningLineUtils.js";

const require = createRequire(import.meta.url);
let importedXxhash: any = null;
try {
    importedXxhash = require('xxhashjs');
} catch {
    importedXxhash = null;
}
const XXH: any = importedXxhash ? ((importedXxhash as any).default ?? importedXxhash) : null;

export const computeHash = (
    value: string,
    algorithm: 'sha256' | 'xxhash'
): string => {
    if (algorithm === 'xxhash' && XXH) {
        return XXH.h64(0xABCD).update(value).digest().toString(16);
    }
    return crypto.createHash('sha256').update(value).digest('hex');
};

export const validateExpectedHash = (
    edit: Edit,
    content: string,
    match: Match,
    lineCounter: LineCounter
): void => {
    if (!edit.expectedHash) return;

    const { algorithm, value } = edit.expectedHash;
    const range = edit.lineRange
        ? getCharRangeForLineRange(edit.lineRange, lineCounter, content.length)
        : { start: match.start, end: match.end };

    const slice = content.substring(range.start, range.end);
    const computed = computeHash(slice, algorithm);

    if (computed !== value) {
        const err = new HashMismatchError(
            `Hash mismatch detected for ${edit.lineRange ? `lines ${edit.lineRange.start}-${edit.lineRange.end}` : `target "${edit.targetString}"`}. ` +
            `Expected ${value}, computed ${computed}.`
        );
        (err as any).edit = edit;
        throw err;
    }
};
