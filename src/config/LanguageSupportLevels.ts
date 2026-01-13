import path from "path";
import { BUILTIN_LANGUAGE_MAPPINGS } from "./LanguageConfig.js";
import { LANGUAGE_PARITY_MATRIX } from "./LanguageParityMatrix.js";
import { resolveRequiredQueries } from "./LanguageParityMatrix.js";

export enum SupportLevel {
    L2 = "L2",
    L3 = "L3"
}

export type LanguageSupportSpec = {
    level: SupportLevel;
    editPolicy: {
        requireSyntaxValidation: boolean;
        warnOnEdit: boolean;
        requireQueries?: Array<"imports" | "exports" | "symbols" | "skeleton">;
    };
};

function buildSupportSpec(entry: (typeof LANGUAGE_PARITY_MATRIX.languages)[number]): LanguageSupportSpec {
    const level = entry.supportLevel === "L3" ? SupportLevel.L3 : SupportLevel.L2;
    const requireQueries = resolveRequiredQueries(entry);
    return {
        level,
        editPolicy: {
            requireSyntaxValidation: entry.requiredSyntaxValidator,
            warnOnEdit: level === SupportLevel.L2,
            requireQueries: requireQueries.length > 0 ? requireQueries : undefined
        }
    };
}

const supportLevels = new Map<string, LanguageSupportSpec>();
for (const entry of LANGUAGE_PARITY_MATRIX.languages) {
    const spec = buildSupportSpec(entry);
    supportLevels.set(entry.languageId, spec);
    if (Array.isArray(entry.aliases)) {
        for (const alias of entry.aliases) {
            supportLevels.set(alias, spec);
        }
    }
}

export const DEFAULT_LANGUAGE_SUPPORT_LEVELS: Record<string, LanguageSupportSpec> = Object.fromEntries(supportLevels);

export function getSupportForLanguageId(languageId: string): LanguageSupportSpec | undefined {
    const normalized = languageId.toLowerCase();
    return DEFAULT_LANGUAGE_SUPPORT_LEVELS[normalized];
}

export function getSupportForFilePath(filePath: string): LanguageSupportSpec | undefined {
    const ext = path.extname(filePath).toLowerCase();
    const mapping = BUILTIN_LANGUAGE_MAPPINGS[ext];
    const languageId = mapping?.languageId ?? ext.replace(".", "");
    return getSupportForLanguageId(languageId);
}
