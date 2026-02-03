import type { NormalizationConfig, NormalizationLevel } from "../../types.js";

export const normalizeString = (
    str: string,
    level: NormalizationLevel,
    config?: NormalizationConfig
): string => {
    if (level === "exact") return str;

    const tabWidth = Math.max(1, config?.tabWidth ?? 4);
    const preserveIndentation = config?.preserveIndentation ?? true;

    switch (level) {
        case "line-endings":
            return str.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        case "trailing":
            return str
                .replace(/\r\n/g, "\n")
                .replace(/\r/g, "\n")
                .split("\n")
                .map(line => line.replace(/\s+$/g, ""))
                .join("\n");
        case "indentation":
            return str
                .replace(/\r\n/g, "\n")
                .replace(/\r/g, "\n")
                .split("\n")
                .map(line => {
                    const match = line.match(/^(\s*)(.*)$/);
                    if (!match) return line;
                    const [, indent, content] = match;
                    const normalizedIndent = indent.replace(/\t/g, " ".repeat(tabWidth));
                    return normalizedIndent + content.replace(/\s+$/g, "");
                })
                .join("\n");
        case "whitespace":
            return str
                .replace(/\r\n/g, "\n")
                .replace(/\r/g, "\n")
                .split("\n")
                .map(line => {
                    const match = line.match(/^(\s*)(.*)$/);
                    if (!match) return line.trim();
                    const [, indent, content] = match;
                    const normalizedIndent = preserveIndentation
                        ? indent.replace(/\t/g, " ".repeat(tabWidth))
                        : "";
                    const normalizedContent = content.replace(/\s+/g, " ").trim();
                    const combined = `${normalizedIndent}${normalizedContent}`;
                    return combined.trimEnd();
                })
                .join("\n");
        case "structural":
            return str
                .replace(/\r\n/g, "\n")
                .replace(/\r/g, "\n")
                .split("\n")
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .join("\n")
                .replace(/\s+/g, " ");
        default:
            return str;
    }
};

export const getNormalizationAttempts = (
    level?: NormalizationLevel
): NormalizationLevel[] => {
    const hierarchy: NormalizationLevel[] = [
        "exact",
        "line-endings",
        "trailing",
        "indentation",
        "whitespace",
        "structural"
    ];

    if (!level) {
        return hierarchy;
    }

    const maxIndex = hierarchy.indexOf(level);
    if (maxIndex === -1) {
        return ["exact"];
    }
    return hierarchy.slice(0, maxIndex + 1);
};
