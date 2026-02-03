import type { NormalizationConfig, NormalizationLevel } from "../../types.js";
import { escapeRegExp } from "./EditPlanningEscapes.js";
import { normalizeString } from "./EditPlanningNormalization.js";

export const createExactRegex = (
    target: string,
    normalization: NormalizationLevel = "exact",
    config?: NormalizationConfig
): RegExp => {
    const normalizedTarget = normalizeString(target, normalization, config);

    switch (normalization) {
        case "exact":
            return new RegExp(escapeRegExp(normalizedTarget), "g");
        case "line-endings": {
            const parts = normalizedTarget.split("\n").map(part => escapeRegExp(part));
            const pattern = parts.join("(\\r\\n|\\r|\\n)");
            return new RegExp(pattern, "g");
        }
        case "trailing": {
            const parts = normalizedTarget.split("\n").map(part => escapeRegExp(part));
            const pattern = parts.join("\\s*(\\r\\n|\\r|\\n)\\s*");
            return new RegExp(`${pattern}\\s*`, "g");
        }
        case "indentation": {
            const lines = normalizedTarget.split("\n");
            const pattern = lines
                .map(line => {
                    if (!line.length) return "";
                    const match = line.match(/^(\s*)(.*)$/);
                    const content = match ? match[2] : line;
                    const escapedContent = escapeRegExp(content);
                    const indentPattern = match && match[1].length > 0 ? "\\s*" : "";
                    return `${indentPattern}${escapedContent}`;
                })
                .join("\\s*(\\r\\n|\\r|\\n)");
            return new RegExp(pattern, "g");
        }
        case "whitespace": {
            const parts = normalizedTarget
                .split("\n")
                .map(line => {
                    const escaped = escapeRegExp(line.trim());
                    return escaped.replace(/ /g, "\\s+");
                });
            const pattern = parts.join("\\s*(\\r\\n|\\r|\\n)\\s*");
            return new RegExp(pattern, "g");
        }
        case "structural":
        default: {
            const tokens = normalizedTarget.replace(/([^a-zA-Z0-9_])/g, " $1 ").split(/\s+/).filter(t => t.length > 0);
            const pattern = tokens
                .map(token => {
                    if (token === '"' || token === "'" || token === "`") {
                        return "[\"'`]";
                    }
                    return escapeRegExp(token);
                })
                .join("\\s*");
            return new RegExp(pattern, "g");
        }
    }
};

export const createFuzzyRegex = (target: string): RegExp => {
    const normalized = target.trim().replace(/\s+/g, ' ');
    const escaped = escapeRegExp(normalized);
    const words = escaped.split(/\s/).filter((word) => word.length > 0);

    if (words.length === 0) {
        return /\s+/g;
    }

    const corePattern = words.join("\\s+");

    const needsStart = /^[a-zA-Z0-9_]/.test(words[0]);
    const needsEnd = /[a-zA-Z0-9_]$/.test(words[words.length - 1]);
    const supportsLookbehind = (() => { try { new RegExp('(?<=a)'); return true; } catch { return false; } })();

    let finalPattern = corePattern;
    if (needsStart) {
        finalPattern = supportsLookbehind ? `(?<![a-zA-Z0-9_])${finalPattern}` : `\\b${finalPattern}`;
    }
    if (needsEnd) {
        finalPattern = `${finalPattern}(?![a-zA-Z0-9_])`;
    }

    return new RegExp(finalPattern, "g");
};

export const isBoundaryPosition = (content: string, index: number): boolean => {
    if (index === 0) return true;
    if (index >= content.length) return false;

    const prev = content[index - 1];
    const curr = content[index];

    const isWordBoundary = (
        /\s/.test(prev) && !/\s/.test(curr)
    ) || (
        /[^\w]/.test(prev) && /\w/.test(curr)
    );

    return isWordBoundary;
};
