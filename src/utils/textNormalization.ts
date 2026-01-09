export type LineEnding = "\n" | "\r\n" | "\r";

export interface TextNormalizationOptions {
    unescapeNewlines?: boolean;
    trimTrailing?: boolean;
    targetEOL?: LineEnding;
}

export class TextNormalizer {
    static normalizeForFileSystem(text: string, options: TextNormalizationOptions = {}): string {
        let normalized = text ?? "";
        const targetEOL = options.targetEOL ?? "\n";

        if (options.unescapeNewlines !== false) {
            normalized = this.unescapeOutsideQuotes(normalized);
        }

        normalized = normalized.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

        if (options.trimTrailing) {
            normalized = normalized
                .split("\n")
                .map(line => line.trimEnd())
                .join("\n");
        }

        if (targetEOL === "\r\n") {
            normalized = normalized.replace(/\n/g, "\r\n");
        } else if (targetEOL === "\r") {
            normalized = normalized.replace(/\n/g, "\r");
        }

        return normalized;
    }

    static detectEOL(content: string): LineEnding | null {
        if (!content) return null;
        const crlfCount = (content.match(/\r\n/g) ?? []).length;
        const lfCount = (content.match(/\n/g) ?? []).length - crlfCount;
        const crCount = (content.match(/\r(?!\n)/g) ?? []).length;

        if (crlfCount > 0 && crlfCount >= lfCount && crlfCount >= crCount) {
            return "\r\n";
        }
        if (crCount > 0 && crCount >= lfCount) {
            return "\r";
        }
        if (lfCount > 0) {
            return "\n";
        }
        return null;
    }

    private static unescapeOutsideQuotes(value: string): string {
        if (!value.includes("\\")) {
            return value;
        }
        let result = "";
        let activeQuote: '"' | "'" | "`" | null = null;

        for (let i = 0; i < value.length; i++) {
            const char = value[i];
            if (char === "\\" && i < value.length - 1) {
                const next = value[i + 1];
                if (!activeQuote) {
                    if (next === "n") {
                        result += "\n";
                        i++;
                        continue;
                    }
                    if (next === "r") {
                        result += "\r";
                        i++;
                        continue;
                    }
                    if (next === "t") {
                        result += "\t";
                        i++;
                        continue;
                    }
                }
            }

            if (char === '"' || char === "'" || char === "`") {
                if (!this.isEscapedCharacter(value, i)) {
                    if (activeQuote === char) {
                        activeQuote = null;
                    } else if (!activeQuote) {
                        activeQuote = char as '"' | "'" | "`";
                    }
                }
            }

            result += char;
        }

        return result;
    }

    private static isEscapedCharacter(value: string, index: number): boolean {
        let backslashCount = 0;
        for (let i = index - 1; i >= 0 && value[i] === "\\"; i--) {
            backslashCount++;
        }
        return backslashCount % 2 === 1;
    }
}
