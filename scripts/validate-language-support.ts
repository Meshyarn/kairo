import fs from "fs";
import path from "path";
import {
    DEFAULT_LANGUAGE_SUPPORT_LEVELS,
    SupportLevel
} from "../src/config/LanguageSupportLevels.js";
import { BUILTIN_LANGUAGE_MAPPINGS } from "../src/config/LanguageConfig.js";
import { LANGUAGE_PARITY_MATRIX } from "../src/config/LanguageParityMatrix.js";

type ValidationMessage = {
    level: "error" | "warn";
    code: string;
    message: string;
    languageId?: string;
};

const root = process.cwd();
const queriesRoot = path.join(root, "src", "queries");
const wasmCandidatesRoot = [
    path.join(root, "node_modules", "tree-sitter-wasms", "out"),
    path.join(root, "wasm")
];

const queryDirAliases: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    javascript: "typescript",
    js: "typescript",
    jsx: "typescript",
    md: "markdown",
    mdx: "markdown",
    py: "python",
    rs: "rust"
};

const requiredExtensions = [".cs", ".sql"];
const optionalExtensions = [".h", ".hpp"];

const messages: ValidationMessage[] = [];
const requiredQueries = ["imports", "exports", "symbols", "skeleton"];

function record(level: ValidationMessage["level"], code: string, message: string, languageId?: string) {
    messages.push({ level, code, message, languageId });
}

function resolveQueryDir(languageId: string): string {
    return queryDirAliases[languageId] ?? languageId;
}

function queryFilePath(languageId: string, queryName: string): string {
    const dir = resolveQueryDir(languageId);
    return path.join(queriesRoot, dir, `${queryName}.scm`);
}

function hasQueryDir(languageId: string): boolean {
    const dir = resolveQueryDir(languageId);
    return fs.existsSync(path.join(queriesRoot, dir));
}

function hasWasmAsset(languageId: string): boolean {
    const fileName = `tree-sitter-${languageId}.wasm`;
    return wasmCandidatesRoot.some((dir) => fs.existsSync(path.join(dir, fileName)));
}

const languageIdToExtensions = new Map<string, string[]>();
for (const [ext, mapping] of Object.entries(BUILTIN_LANGUAGE_MAPPINGS)) {
    if (!mapping?.languageId) continue;
    const list = languageIdToExtensions.get(mapping.languageId) ?? [];
    list.push(ext);
    languageIdToExtensions.set(mapping.languageId, list);
}

for (const extension of requiredExtensions) {
    if (!BUILTIN_LANGUAGE_MAPPINGS[extension]) {
        record("error", "LANGUAGE_SUPPORT_GAP", `Missing LanguageConfig mapping for ${extension}.`);
    }
}

for (const extension of optionalExtensions) {
    if (!BUILTIN_LANGUAGE_MAPPINGS[extension]) {
        record("warn", "LANGUAGE_SUPPORT_GAP", `Optional LanguageConfig mapping missing for ${extension}.`);
    }
}

const mappedLanguageIds = new Set(
    Object.values(BUILTIN_LANGUAGE_MAPPINGS)
        .map((mapping) => mapping.languageId)
        .filter((id): id is string => typeof id === "string")
);

for (const entry of LANGUAGE_PARITY_MATRIX.languages) {
    const severity = entry.supportLevel === "L3" ? "error" : "warn";
    if (!mappedLanguageIds.has(entry.languageId)) {
        record(severity, "LANGUAGE_SUPPORT_GAP", `No LanguageConfig mapping for "${entry.languageId}".`, entry.languageId);
    }

    if (entry.requiredQueryPack) {
        for (const queryName of requiredQueries) {
            const filePath = queryFilePath(entry.languageId, queryName);
            if (!fs.existsSync(filePath)) {
                record(severity, "MISSING_QUERY_PACK", `Missing query pack: ${filePath}`, entry.languageId);
            }
        }
    }

    if (entry.requiredWasmGrammar) {
        const hasWasm = hasWasmAsset(entry.languageId);
        if (!hasWasm) {
            record(severity, "MISSING_WASM_GRAMMAR", `Missing tree-sitter WASM for "${entry.languageId}".`, entry.languageId);
        }
    }
}

for (const [languageId, spec] of Object.entries(DEFAULT_LANGUAGE_SUPPORT_LEVELS)) {
    const level = spec.level;
    const requiresQueries = spec.editPolicy.requireQueries ?? [];
    const hasMapping = languageIdToExtensions.has(languageId);

    if (!hasMapping) {
        const message = `No LanguageConfig extension mapped to languageId "${languageId}".`;
        record(level === SupportLevel.L3 ? "error" : "warn", "LANGUAGE_SUPPORT_GAP", message, languageId);
    }

    if (requiresQueries.length > 0) {
        for (const queryName of requiresQueries) {
            const filePath = queryFilePath(languageId, queryName);
            if (!fs.existsSync(filePath)) {
                record("error", "MISSING_QUERY_PACK", `Missing query pack: ${filePath}`, languageId);
            }
        }
    } else if (!hasQueryDir(languageId)) {
        record("warn", "MISSING_QUERY_PACK", `No query pack directory found for "${languageId}".`, languageId);
    }

    if (spec.editPolicy.requireSyntaxValidation) {
        const hasWasm = hasWasmAsset(languageId);
        if (!hasWasm) {
            const message = `Missing tree-sitter WASM for "${languageId}".`;
            record(level === SupportLevel.L3 ? "error" : "warn", "MISSING_WASM_GRAMMAR", message, languageId);
        }
    }
}

const errors = messages.filter((item) => item.level === "error");
const warnings = messages.filter((item) => item.level === "warn");

if (warnings.length > 0) {
    console.warn("Language support validation warnings:");
    for (const warn of warnings) {
        const suffix = warn.languageId ? ` [${warn.languageId}]` : "";
        console.warn(`- ${warn.code}${suffix}: ${warn.message}`);
    }
}

if (errors.length > 0) {
    console.error("Language support validation errors:");
    for (const error of errors) {
        const suffix = error.languageId ? ` [${error.languageId}]` : "";
        console.error(`- ${error.code}${suffix}: ${error.message}`);
    }
    process.exit(1);
}

console.log("Language support validation passed.");
