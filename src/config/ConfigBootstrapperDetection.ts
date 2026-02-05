import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { BUILTIN_LANGUAGE_MAPPINGS } from "./LanguageConfig.js";
import { getSupportForLanguageId, SupportLevel } from "./LanguageSupportLevels.js";
import { LANGUAGE_PARITY_MATRIX, resolveRequiredQueries } from "./LanguageParityMatrix.js";
import type { BootstrapDetected, ConfigFinding, LanguageShare } from "./ConfigBootstrapperTypes.js";

export const detectWasm = (languageIds: string[], rootPath: string) => {
    const required = Array.from(new Set(languageIds));
    const found: string[] = [];
    const missing: string[] = [];
    const suggestedWasmDir = path.join(rootPath, "wasm");

    for (const languageId of required) {
        const wasmPath = resolveWasmPath(languageId, rootPath);
        if (wasmPath && fs.existsSync(wasmPath)) {
            found.push(languageId);
        } else {
            missing.push(languageId);
        }
    }

    return { required, found, missing, suggestedWasmDir };
};

export const resolveWasmPath = (languageId: string, rootPath: string): string | null => {
    const overrideDir = (process.env.KAIRO_WASM_DIR || "").trim();
    if (overrideDir) {
        return path.resolve(overrideDir, `tree-sitter-${languageId}.wasm`);
    }

    const candidates: string[] = [];
    const localRequire = createRequire(import.meta.url);
    try {
        const pkgPath = localRequire.resolve("tree-sitter-wasms/package.json");
        const pkgDir = path.dirname(pkgPath);
        candidates.push(path.join(pkgDir, "out", `tree-sitter-${languageId}.wasm`));
    } catch {
        // ignore
    }

    candidates.push(path.join(rootPath, "node_modules", "tree-sitter-wasms", "out", `tree-sitter-${languageId}.wasm`));
    candidates.push(path.join(rootPath, "wasm", `tree-sitter-${languageId}.wasm`));

    return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[candidates.length - 1] ?? null;
};

export const detectQueryGaps = (languageIds: string[]) => {
    const queriesRoot = resolveQueriesRoot();
    const gaps: Array<{ languageId: string; missing: string[]; supportLevel?: "L2" | "L3" }> = [];
    if (!queriesRoot) {
        return gaps;
    }
    const uniqueIds = Array.from(new Set(languageIds));
    for (const languageId of uniqueIds) {
        const support = getSupportForLanguageId(languageId);
        const required = support?.editPolicy.requireQueries ?? [];
        if (required.length === 0) continue;
        const missing: string[] = [];
        const candidates = resolveQueryCandidates(languageId);
        for (const query of required) {
            let found = false;
            for (const candidate of candidates) {
                const queryPath = path.join(queriesRoot, candidate, `${query}.scm`);
                if (fs.existsSync(queryPath)) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                missing.push(query);
            }
        }
        if (missing.length > 0) {
            gaps.push({
                languageId,
                missing,
                supportLevel: support?.level === SupportLevel.L3 ? "L3" : support ? "L2" : undefined
            });
        }
    }
    return gaps;
};

export const resolveQueriesRoot = (): string | null => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    let queriesRoot = path.resolve(__dirname, "..", "queries");
    if (!fs.existsSync(queriesRoot)) {
        queriesRoot = path.resolve(process.cwd(), "src", "queries");
    }
    if (!fs.existsSync(queriesRoot)) {
        return null;
    }
    return queriesRoot;
};

export const resolveQueryCandidates = (languageId: string): string[] => {
    const normalized = (languageId ?? "").toLowerCase();
    const aliases: Record<string, string[]> = {
        ts: ["typescript"],
        tsx: ["typescript"],
        javascript: ["typescript"],
        js: ["typescript"],
        md: ["markdown"],
        mdx: ["markdown"],
        py: ["python"],
        rs: ["rust"]
    };
    return [normalized, ...(aliases[normalized] ?? [])];
};

export const buildQueryGapFindings = (
    gaps: Array<{ languageId: string; missing: string[]; supportLevel?: "L2" | "L3" }>
): ConfigFinding[] => {
    return gaps.map((gap) => ({
        code: "LANGUAGE_GAP",
        severity: gap.supportLevel === "L3" ? "error" : "warn",
        message: `Missing query packs for ${gap.languageId}: ${gap.missing.join(", ")}.`,
        action: "add_query_packs",
        evidence: { languageId: gap.languageId, missing: gap.missing }
    }));
};

export const buildWasmFindings = (wasm: BootstrapDetected["wasm"], languages: LanguageShare[]): ConfigFinding[] => {
    const findings: ConfigFinding[] = [];
    const languageMap = new Map(languages.map((lang) => [lang.languageId, lang.supportLevel]));
    for (const missing of wasm.missing) {
        const level = languageMap.get(missing);
        findings.push({
            code: "WASM_MISSING",
            severity: level === "L3" ? "error" : "warn",
            message: `Missing tree-sitter WASM for ${missing}.`,
            action: "add_wasm",
            evidence: { languageId: missing }
        });
    }
    return findings;
};

export const buildParityFindings = (rootPath: string): { findings: ConfigFinding[]; hints: string[] } => {
    const findings: ConfigFinding[] = [];
    const hints: string[] = [];
    const mappedLanguageIds = new Set(
        Object.values(BUILTIN_LANGUAGE_MAPPINGS)
            .map((mapping) => mapping.languageId)
            .filter((id): id is string => typeof id === "string")
    );
    const queriesRoot = resolveQueriesRoot();
    for (const entry of LANGUAGE_PARITY_MATRIX.languages) {
        const severity = entry.supportLevel === "L3" ? "error" : "warn";
        if (!mappedLanguageIds.has(entry.languageId)) {
            findings.push({
                code: "LANGUAGE_SUPPORT_GAP",
                severity,
                message: `No LanguageConfig mapping for "${entry.languageId}".`,
                action: "add_language_mappings",
                evidence: { languageId: entry.languageId }
            });
        }

        if (entry.requiredQueryPack) {
            const missing: string[] = [];
            const candidates = resolveQueryCandidates(entry.languageId);
            const requiredQueries = resolveRequiredQueries(entry);
            for (const query of requiredQueries) {
                let found = false;
                if (queriesRoot) {
                    for (const candidate of candidates) {
                        const queryPath = path.join(queriesRoot, candidate, `${query}.scm`);
                        if (fs.existsSync(queryPath)) {
                            found = true;
                            break;
                        }
                    }
                }
                if (!found) {
                    missing.push(query);
                }
            }
            if (missing.length > 0) {
                findings.push({
                    code: "MISSING_QUERY_PACK",
                    severity,
                    message: `Missing query packs for ${entry.languageId}: ${missing.join(", ")}.`,
                    action: "add_query_packs",
                    evidence: { languageId: entry.languageId, missing }
                });
                hints.push(`Missing query packs for ${entry.languageId}. Add ${missing.join(", ")} under ${path.join("src", "queries", entry.languageId)}.`);
            }
        }

        if (entry.requiredWasmGrammar) {
            const wasmPath = resolveWasmPath(entry.languageId, rootPath);
            if (!wasmPath || !fs.existsSync(wasmPath)) {
                findings.push({
                    code: "MISSING_WASM_GRAMMAR",
                    severity,
                    message: `Missing tree-sitter WASM for ${entry.languageId}.`,
                    action: "add_wasm",
                    evidence: { languageId: entry.languageId }
                });
                hints.push(`Missing WASM for ${entry.languageId}. Set KAIRO_WASM_DIR or add tree-sitter-${entry.languageId}.wasm to ${path.join(rootPath, "wasm")}.`);
            }
        }

        if (entry.requiredSyntaxValidator && !mappedLanguageIds.has(entry.languageId)) {
            findings.push({
                code: "MISSING_VALIDATOR",
                severity,
                message: `Missing syntax validator mapping for ${entry.languageId}.`,
                action: "add_language_mappings",
                evidence: { languageId: entry.languageId }
            });
        }
    }

    return { findings, hints };
};
