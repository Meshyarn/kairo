import fs from "fs";
import path from "path";
import {
    DEFAULT_LANGUAGE_SUPPORT_LEVELS,
    SupportLevel
} from "../src/config/LanguageSupportLevels.js";
import { BUILTIN_LANGUAGE_MAPPINGS } from "../src/config/LanguageConfig.js";

type ValidationMessage = { level: "error" | "warn"; message: string };

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

function record(level: ValidationMessage["level"], message: string) {
    messages.push({ level, message });
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
        record("error", `Missing LanguageConfig mapping for ${extension}.`);
    }
}

for (const extension of optionalExtensions) {
    if (!BUILTIN_LANGUAGE_MAPPINGS[extension]) {
        record("warn", `Optional LanguageConfig mapping missing for ${extension}.`);
    }
}

for (const [languageId, spec] of Object.entries(DEFAULT_LANGUAGE_SUPPORT_LEVELS)) {
    const level = spec.level;
    const requiresQueries = spec.editPolicy.requireQueries ?? [];
    const hasMapping = languageIdToExtensions.has(languageId);

    if (!hasMapping) {
        const message = `No LanguageConfig extension mapped to languageId "${languageId}".`;
        record(level === SupportLevel.L3 ? "error" : "warn", message);
    }

    if (requiresQueries.length > 0) {
        for (const queryName of requiresQueries) {
            const filePath = queryFilePath(languageId, queryName);
            if (!fs.existsSync(filePath)) {
                record("error", `Missing query pack: ${filePath}`);
            }
        }
    } else if (!hasQueryDir(languageId)) {
        record("warn", `No query pack directory found for "${languageId}".`);
    }

    if (spec.editPolicy.requireSyntaxValidation) {
        const hasWasm = hasWasmAsset(languageId);
        if (!hasWasm) {
            const message = `Missing tree-sitter WASM for "${languageId}".`;
            record(level === SupportLevel.L3 ? "error" : "warn", message);
        }
    }
}

const errors = messages.filter((item) => item.level === "error");
const warnings = messages.filter((item) => item.level === "warn");

if (warnings.length > 0) {
    console.warn("Language support validation warnings:");
    for (const warn of warnings) {
        console.warn(`- ${warn.message}`);
    }
}

if (errors.length > 0) {
    console.error("Language support validation errors:");
    for (const error of errors) {
        console.error(`- ${error.message}`);
    }
    process.exit(1);
}

console.log("Language support validation passed.");
