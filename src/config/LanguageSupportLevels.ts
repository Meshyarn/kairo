import path from "path";
import { BUILTIN_LANGUAGE_MAPPINGS } from "./LanguageConfig.js";

export enum SupportLevel {
    L2 = "understand-grade",
    L3 = "edit-safe"
}

export type LanguageSupportSpec = {
    level: SupportLevel;
    editPolicy: {
        requireSyntaxValidation: boolean;
        warnOnEdit: boolean;
        requireQueries?: Array<"imports" | "exports" | "symbols" | "skeleton">;
    };
};

export const DEFAULT_LANGUAGE_SUPPORT_LEVELS: Record<string, LanguageSupportSpec> = {
    typescript: {
        level: SupportLevel.L3,
        editPolicy: { requireSyntaxValidation: true, warnOnEdit: false, requireQueries: ["imports", "exports", "symbols", "skeleton"] }
    },
    tsx: {
        level: SupportLevel.L3,
        editPolicy: { requireSyntaxValidation: true, warnOnEdit: false, requireQueries: ["imports", "exports", "symbols", "skeleton"] }
    },
    python: {
        level: SupportLevel.L3,
        editPolicy: { requireSyntaxValidation: true, warnOnEdit: false, requireQueries: ["imports", "exports", "symbols", "skeleton"] }
    },
    go: {
        level: SupportLevel.L3,
        editPolicy: { requireSyntaxValidation: true, warnOnEdit: false, requireQueries: ["imports", "exports", "symbols", "skeleton"] }
    },
    rust: {
        level: SupportLevel.L3,
        editPolicy: { requireSyntaxValidation: true, warnOnEdit: false, requireQueries: ["imports", "exports", "symbols", "skeleton"] }
    },
    java: {
        level: SupportLevel.L3,
        editPolicy: { requireSyntaxValidation: true, warnOnEdit: false, requireQueries: ["imports", "exports", "symbols", "skeleton"] }
    },
    php: {
        level: SupportLevel.L3,
        editPolicy: { requireSyntaxValidation: true, warnOnEdit: false, requireQueries: ["imports", "exports", "symbols", "skeleton"] }
    },
    sql: {
        level: SupportLevel.L3,
        editPolicy: { requireSyntaxValidation: true, warnOnEdit: false, requireQueries: ["symbols", "skeleton"] }
    },
    markdown: {
        level: SupportLevel.L2,
        editPolicy: { requireSyntaxValidation: false, warnOnEdit: true }
    },
    c: {
        level: SupportLevel.L2,
        editPolicy: { requireSyntaxValidation: true, warnOnEdit: true }
    },
    cpp: {
        level: SupportLevel.L2,
        editPolicy: { requireSyntaxValidation: true, warnOnEdit: true }
    },
    c_sharp: {
        level: SupportLevel.L2,
        editPolicy: { requireSyntaxValidation: true, warnOnEdit: true }
    }
};

export function getSupportForLanguageId(languageId: string): LanguageSupportSpec | undefined {
    return DEFAULT_LANGUAGE_SUPPORT_LEVELS[languageId];
}

export function getSupportForFilePath(filePath: string): LanguageSupportSpec | undefined {
    const ext = path.extname(filePath).toLowerCase();
    const mapping = BUILTIN_LANGUAGE_MAPPINGS[ext];
    const languageId = mapping?.languageId ?? ext.replace(".", "");
    return getSupportForLanguageId(languageId);
}
