import type { IntegrityGuardrailsConfig } from "./IntegrityGuardrailsTypes.js";
import { DEFAULT_FORBIDDEN_TOKENS } from "./IntegrityGuardrailsConfig.js";
import { matchGlob } from "./IntegrityGuardrailsCycles.js";
import { normalizePath, toRelativePath } from "../../utils/PathHelpers.js";

export const evaluateProtocolViolations = (args: {
    filePath: string;
    content: string;
    config: IntegrityGuardrailsConfig["protocolProtection"];
}): { violations: Array<Record<string, unknown>>; blocked: boolean } => {
    if (!args.config.files || args.config.files.length === 0) {
        return { violations: [], blocked: false };
    }
    const normalizedPath = normalizePath(toRelativePath(process.cwd(), args.filePath));
    const isProtected = args.config.files.some(pattern => matchGlob(normalizedPath, pattern));
    if (!isProtected) {
        return { violations: [], blocked: false };
    }
    const allowlist = args.config.allowlist ?? [];
    const lines = args.content.split(/\r?\n/);
    const violations: Array<Record<string, unknown>> = [];
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        for (const token of args.config.forbiddenTokens ?? DEFAULT_FORBIDDEN_TOKENS) {
            const matchIndex = line.indexOf(token);
            if (matchIndex === -1) continue;
            if (isTokenAllowed(normalizedPath, token, allowlist)) {
                continue;
            }
            if (isCommentOrString(line, matchIndex)) {
                continue;
            }
            violations.push({
                filePath: normalizedPath,
                line: lineIndex + 1,
                column: matchIndex + 1,
                token,
                snippet: line.trim()
            });
        }
    }
    return { violations, blocked: violations.length > 0 };
};

const isTokenAllowed = (filePath: string, token: string, allowlist: Array<{ file: string; tokens: string[] }>): boolean => {
    return allowlist.some(entry => matchGlob(filePath, entry.file) && entry.tokens.includes(token));
};

const isCommentOrString = (line: string, tokenIndex: number): boolean => {
    const before = line.slice(0, tokenIndex);
    const lineCommentIndex = before.indexOf("//");
    if (lineCommentIndex !== -1) {
        return true;
    }
    if (before.includes("/*")) {
        return true;
    }
    const quoteCount = (before.match(/"/g) ?? []).length + (before.match(/'/g) ?? []).length;
    return quoteCount % 2 === 1;
};
