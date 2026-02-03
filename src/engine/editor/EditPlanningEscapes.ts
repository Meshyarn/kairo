const containsUnescapedQuote = (value: string, quote: '"' | "'" | "`"): boolean => {
    for (let i = 0; i < value.length; i++) {
        if (value[i] !== quote) {
            continue;
        }

        if (!isEscapedCharacter(value, i)) {
            return true;
        }
    }

    return false;
};

const stripEscapedQuotes = (value: string, quote: '"' | "'" | "`"): string => {
    let result = "";

    for (let i = 0; i < value.length; i++) {
        const char = value[i];

        if (char === "\\" && value[i + 1] === quote) {
            if (!isEscapedCharacter(value, i)) {
                result += quote;
                i++; // skip the quote we just consumed
                continue;
            }
        }

        result += char;
    }

    return result;
};

export const decodeStructuralEscapeSequences = (value: string): string => {
    if (!value.includes("\\n") && !value.includes("\\r") && !value.includes("\\t")) {
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

            result += char;
            continue;
        }

        if (char === '"' || char === "'" || char === "`") {
            const escaped = isEscapedCharacter(value, i);
            if (!escaped) {
                if (activeQuote === char) {
                    activeQuote = null;
                } else if (!activeQuote) {
                    activeQuote = char as '"' | "'" | "`";
                }
            }
            result += char;
            continue;
        }

        result += char;
    }

    return result;
};

export const isEscapedCharacter = (value: string, index: number): boolean => {
    let backslashCount = 0;
    for (let i = index - 1; i >= 0 && value[i] === "\\"; i--) {
        backslashCount++;
    }
    return backslashCount % 2 === 1;
};

export const escapeRegExp = (value: string): string => {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

export const normalizeReplacementString = (value: string | undefined): string => {
    if (!value || !value.includes("\\")) {
        return value ?? "";
    }

    let normalized = value;
    const quoteChars: Array<'"' | "'" | "`"> = ['"', "'", "`"];

    for (const quote of quoteChars) {
        if (containsUnescapedQuote(normalized, quote)) {
            continue;
        }

        if (!normalized.includes(`\\${quote}`)) {
            continue;
        }

        normalized = stripEscapedQuotes(normalized, quote);
    }

    return decodeStructuralEscapeSequences(normalized);
};

export const decodeEscapeSequences = (value: string): string => {
    if (!value.includes("\\")) {
        return value;
    }
    let result = "";
    for (let i = 0; i < value.length; i++) {
        const char = value[i];
        if (char !== "\\" || i === value.length - 1) {
            result += char;
            continue;
        }
        const next = value[i + 1];
        switch (next) {
            case "n":
                result += "\n";
                i++;
                break;
            case "r":
                result += "\r";
                i++;
                break;
            case "t":
                result += "\t";
                i++;
                break;
            case "0":
                result += "\0";
                i++;
                break;
            case "b":
                result += "\b";
                i++;
                break;
            case "f":
                result += "\f";
                i++;
                break;
            case "v":
                result += "\v";
                i++;
                break;
            case "\\":
                result += "\\";
                i++;
                break;
            case "\"":
                result += "\"";
                i++;
                break;
            case "'":
                result += "'";
                i++;
                break;
            case "`":
                result += "`";
                i++;
                break;
            case "x": {
                const hex = value.substring(i + 2, i + 4);
                if (/^[0-9a-fA-F]{2}$/.test(hex)) {
                    result += String.fromCharCode(parseInt(hex, 16));
                    i += 3;
                    break;
                }
                result += "\\" + next;
                i++;
                break;
            }
            case "u": {
                const hex = value.substring(i + 2, i + 6);
                if (/^[0-9a-fA-F]{4}$/.test(hex)) {
                    result += String.fromCharCode(parseInt(hex, 16));
                    i += 5;
                    break;
                }
                result += "\\" + next;
                i++;
                break;
            }
            default:
                result += "\\" + next;
                i++;
                break;
        }
    }
    return result;
};

export const encodeEscapeSequences = (value: string): string => {
    let changed = false;
    let result = "";
    for (const char of value) {
        switch (char) {
            case "\n":
                result += "\\n";
                changed = true;
                break;
            case "\r":
                result += "\\r";
                changed = true;
                break;
            case "\t":
                result += "\\t";
                changed = true;
                break;
            case "\0":
                result += "\\0";
                changed = true;
                break;
            default:
                result += char;
                break;
        }
    }
    return changed ? result : value;
};
