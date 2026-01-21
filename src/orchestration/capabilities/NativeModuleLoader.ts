import path from "path";
import { createRequire } from "module";
import { PatienceDiff } from "../../engine/PatienceDiff.js";
import { EngineManager } from "./EngineManager.js";

export type RustCoreModule = {
    SmartChunker: new (tokenizerPath: string) => {
        chunk: (text: string, maxTokens: number, overlapTokens: number) => Array<{
            text: string;
            startByte: number;
            endByte: number;
            startToken: number;
            endToken: number;
        }>;
    };
    diffUnified: (oldText: string, newText: string, contextLines: number) => { diff: string; added: number; removed: number };
    validateSyntax: (language: string, content: string) => Array<{ line: number; column: number; message: string }>;
    cosineScores: (query: Float32Array, vectors: Float32Array[]) => number[];
    symbolicSolve?: (input: unknown) => unknown;
    NativeSearchCore?: new (indexDir: string, options?: { writerMemoryMb?: number; kairoVersion?: string; repoId?: string }) => {
        upsert: (doc: unknown) => void;
        upsertMany: (docs: unknown[]) => void;
        deleteDoc: (target: unknown) => void;
        commit: () => void;
        search: (query: unknown) => unknown[];
        close: () => void;
        stats: () => { docCount: number; segmentCount: number; indexVersion: number; schemaVersion: number };
        reset?: () => void;
    };
};

export type RustCoreLoader = () => RustCoreModule;

const require = createRequire(import.meta.url);

export class NativeModuleLoader {
    private static instance: NativeModuleLoader | null = null;
    private static testLoader: RustCoreLoader | null = null;
    private module: RustCoreModule | null = null;
    private loadAttempted = false;
    private loadError: Error | null = null;
    private warned = false;

    private constructor() {}

    static getShared(): NativeModuleLoader {
        if (!this.instance) {
            this.instance = new NativeModuleLoader();
        }
        return this.instance;
    }

    static setTestLoader(loader: RustCoreLoader | null): void {
        this.testLoader = loader;
        this.instance = null;
    }

    static resetForTesting(): void {
        this.testLoader = null;
        this.instance = null;
    }

    getRustCore(): RustCoreModule | null {
        if (this.loadAttempted) {
            return this.module;
        }

        this.loadAttempted = true;
        try {
            const loader = NativeModuleLoader.testLoader ?? this.resolveLoader();
            this.module = loader();
            this.loadError = null;
            EngineManager.setRustCoreStatus(true);
        } catch (error: any) {
            this.loadError = error instanceof Error ? error : new Error(String(error));
            EngineManager.setRustCoreStatus(false, this.loadError.message);
            this.warnOnce(`Rust core unavailable (${this.loadError.message}); falling back to JS/WASM.`);
            this.module = null;
        }
        return this.module;
    }

    isAvailable(): boolean {
        return this.getRustCore() !== null;
    }

    getLoadError(): Error | null {
        this.getRustCore();
        return this.loadError;
    }

    private warnOnce(message: string): void {
        if (this.warned) return;
        this.warned = true;
        console.warn(`[NativeModuleLoader] ${message}`);
    }

    private resolveLoader(): RustCoreLoader {
        if (NativeModuleLoader.testLoader) {
            return NativeModuleLoader.testLoader;
        }
        if (shouldUseTestStub()) {
            return () => createTestRustCoreStub();
        }
        return () => require("@kairo/core-rs") as RustCoreModule;
    }
}

type StoredDoc =
    | { kind: "code_file"; repoId: string; path: string; ext?: string; content: string; symbols?: string[] }
    | { kind: "doc_chunk"; repoId: string; chunkId: string; docPath: string; scope?: "docs" | "comments" | "logs" | "metrics"; text: string; headingPath?: string[] };

const createTestRustCoreStub = (): RustCoreModule => {
    class TestNativeSearchCore {
        private readonly docs = new Map<string, StoredDoc>();

        constructor(_indexDir: string, _options?: { writerMemoryMb?: number; kairoVersion?: string; repoId?: string }) {}

        upsert(doc: any) {
            const stored = normalizeDoc(doc);
            this.docs.set(docKey(stored), stored);
        }

        upsertMany(docs: any[]) {
            for (const doc of docs) {
                this.upsert(doc);
            }
        }

        deleteDoc(target: any) {
            const key = deleteKey(target);
            if (key) {
                this.docs.delete(key);
            }
        }

        commit() {}

        search(query: any) {
            const tokens = tokenizeQuery(String(query?.query ?? ""));
            if (tokens.length === 0) return [];

            const repoIds = Array.isArray(query?.repoIds) && query.repoIds.length > 0
                ? new Set(query.repoIds.map(String))
                : null;
            const fileTypes = Array.isArray(query?.fileTypes) && query.fileTypes.length > 0
                ? new Set(query.fileTypes.map((ext: string) => normalizeExt(ext)))
                : null;
            const scopes = Array.isArray(query?.scopes) && query.scopes.length > 0
                ? new Set(query.scopes.map(String))
                : null;
            const kinds = query?.kind === "any"
                ? new Set(["code_file", "doc_chunk"])
                : new Set([query?.kind ?? "code_file"]);

            const hits: Array<{ score: number; hit: any }> = [];
            for (const stored of this.docs.values()) {
                if (!kinds.has(stored.kind)) continue;
                if (repoIds && !repoIds.has(stored.repoId)) continue;
                if (stored.kind === "code_file" && fileTypes) {
                    const ext = normalizeExt(stored.ext ?? path.extname(stored.path));
                    if (!fileTypes.has(ext)) continue;
                }
                if (stored.kind === "doc_chunk" && scopes) {
                    const scope = stored.scope ?? "docs";
                    if (!scopes.has(scope)) continue;
                }

                const haystack = buildHaystack(stored).toLowerCase();
                const score = scoreTokens(tokens, haystack);
                if (score <= 0) continue;
                hits.push({
                    score,
                    hit: {
                        kind: stored.kind,
                        repoId: stored.repoId,
                        path: stored.kind === "doc_chunk" ? stored.docPath : stored.path,
                        chunkId: stored.kind === "doc_chunk" ? stored.chunkId : undefined,
                        score,
                        scope: stored.kind === "doc_chunk" ? stored.scope : undefined
                    }
                });
            }

            hits.sort((a, b) => b.score - a.score);
            const limit = typeof query?.limit === "number" && Number.isFinite(query.limit) ? Math.max(1, query.limit) : 20;
            return hits.slice(0, limit).map((entry) => entry.hit);
        }

        close() {}

        stats() {
            return {
                docCount: this.docs.size,
                segmentCount: 1,
                indexVersion: 1,
                schemaVersion: 1
            };
        }

        reset() {
            this.docs.clear();
        }
    }

    return {
        SmartChunker: class {
            constructor(_tokenizerPath: string) {}

            chunk(
                text: string,
                maxTokens: number,
                overlapTokens: number
            ): Array<{ text: string; startByte: number; endByte: number; startToken: number; endToken: number }> {
                const tokens = collectTokens(text);
                if (tokens.length === 0 || maxTokens <= 0) return [];
                const step = Math.max(1, maxTokens - Math.max(0, overlapTokens));
                const chunks: Array<{ text: string; startByte: number; endByte: number; startToken: number; endToken: number }> = [];
                for (let startToken = 0; startToken < tokens.length; startToken += step) {
                    const endToken = Math.min(tokens.length, startToken + maxTokens);
                    const slice = tokens.slice(startToken, endToken);
                    const startByte = slice[0]?.start ?? 0;
                    const endByte = slice[slice.length - 1]?.end ?? startByte;
                    chunks.push({
                        text: text.slice(startByte, endByte),
                        startByte,
                        endByte,
                        startToken,
                        endToken
                    });
                    if (endToken >= tokens.length) break;
                }
                return chunks;
            }
        },
        diffUnified: (oldText: string, newText: string, contextLines: number) => {
            const hunks = PatienceDiff.diff(oldText, newText, { contextLines, semantic: true });
            const summary = PatienceDiff.summarize(hunks);
            return { diff: PatienceDiff.formatUnified(hunks), added: summary.added, removed: summary.removed };
        },
        validateSyntax: (_language: string, content: string) => detectSyntaxIssues(content),
        cosineScores: (query: Float32Array, vectors: Float32Array[]) => cosineScores(query, vectors),
        NativeSearchCore: TestNativeSearchCore
    };
};

type TokenSpan = { start: number; end: number };

const collectTokens = (text: string): TokenSpan[] => {
    const tokens: TokenSpan[] = [];
    const regex = /\S+/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
        tokens.push({ start: match.index, end: match.index + match[0].length });
    }
    return tokens;
};

const detectSyntaxIssues = (content: string): Array<{ line: number; column: number; message: string }> => {
    const issues: Array<{ line: number; column: number; message: string }> = [];
    if (hasMissingAssignmentRhs(content) || hasUnbalancedParens(content)) {
        issues.push({ line: 1, column: 1, message: "Syntax error detected." });
    }
    return issues;
};

const hasMissingAssignmentRhs = (content: string): boolean => {
    for (let i = 0; i < content.length; i += 1) {
        if (content[i] !== "=") continue;
        const prev = content[i - 1];
        const next = content[i + 1];
        if (prev === "=" || prev === "!" || prev === "<" || prev === ">") continue;
        if (next === "=" || next === ">") continue;
        let j = i + 1;
        while (j < content.length && /\s/.test(content[j])) {
            j += 1;
        }
        if (j >= content.length) return true;
        const nextChar = content[j];
        if (nextChar === ";" || nextChar === "," || nextChar === ")" || nextChar === "}" || nextChar === "]") {
            return true;
        }
    }
    return false;
};

const hasUnbalancedParens = (content: string): boolean => {
    let balance = 0;
    for (const ch of content) {
        if (ch === "(") balance += 1;
        if (ch === ")") balance -= 1;
        if (balance < 0) return true;
    }
    return balance !== 0;
};

const cosineScores = (query: Float32Array, vectors: Float32Array[]): number[] => {
    const queryNorm = l2Norm(query);
    return vectors.map((vector) => {
        const denom = queryNorm * l2Norm(vector);
        if (denom === 0) return 0;
        return dot(query, vector) / denom;
    });
};

const dot = (a: Float32Array, b: Float32Array): number => {
    const len = Math.min(a.length, b.length);
    let sum = 0;
    for (let i = 0; i < len; i += 1) {
        sum += a[i] * b[i];
    }
    return sum;
};

const l2Norm = (vec: Float32Array): number => {
    let sum = 0;
    for (let i = 0; i < vec.length; i += 1) {
        sum += vec[i] * vec[i];
    }
    return Math.sqrt(sum);
};

const shouldUseTestStub = (): boolean => {
    if (process.env.KAIRO_TEST_USE_NATIVE_CORE === "true") return false;
    return process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID != null;
};

const normalizeExt = (value: string): string => {
    if (!value) return "";
    const trimmed = value.replace(/^\./, "").trim().toLowerCase();
    return trimmed;
};

const tokenizeQuery = (query: string): string[] => {
    return query
        .split(/\s+/)
        .map((token) => token.trim().toLowerCase())
        .filter((token) => token.length > 0);
};

const scoreTokens = (tokens: string[], haystack: string): number => {
    let score = 0;
    for (const token of tokens) {
        const count = countOccurrences(haystack, token);
        if (count > 0) {
            score += count;
        }
    }
    return score;
};

const countOccurrences = (haystack: string, needle: string): number => {
    if (!needle) return 0;
    let count = 0;
    let index = haystack.indexOf(needle);
    while (index >= 0) {
        count += 1;
        index = haystack.indexOf(needle, index + needle.length);
    }
    return count;
};

const buildHaystack = (doc: StoredDoc): string => {
    if (doc.kind === "code_file") {
        const symbols = Array.isArray(doc.symbols) ? doc.symbols.join(" ") : "";
        return `${doc.path}\n${symbols}\n${doc.content}`;
    }
    const headings = Array.isArray(doc.headingPath) ? doc.headingPath.join(" ") : "";
    return `${doc.docPath}\n${headings}\n${doc.text}`;
};

const normalizeDoc = (doc: any): StoredDoc => {
    if (doc?.kind === "code_file") {
        return {
            kind: "code_file",
            repoId: String(doc.repoId ?? "default"),
            path: String(doc.path ?? ""),
            ext: doc.ext ? String(doc.ext) : undefined,
            content: String(doc.content ?? ""),
            symbols: Array.isArray(doc.symbols) ? doc.symbols.map(String) : undefined
        };
    }
    return {
        kind: "doc_chunk",
        repoId: String(doc.repoId ?? "default"),
        chunkId: String(doc.chunkId ?? ""),
        docPath: String(doc.docPath ?? ""),
        scope: doc.scope,
        text: String(doc.text ?? ""),
        headingPath: Array.isArray(doc.headingPath) ? doc.headingPath.map(String) : undefined
    };
};

const docKey = (doc: StoredDoc): string => {
    if (doc.kind === "code_file") {
        return `${doc.repoId}:code_file:${doc.path}`;
    }
    return `${doc.repoId}:doc_chunk:${doc.chunkId}`;
};

const deleteKey = (target: any): string | null => {
    if (!target) return null;
    if (target.kind === "code_file" && target.path) {
        return `${target.repoId ?? "default"}:code_file:${target.path}`;
    }
    if (target.kind === "doc_chunk" && target.chunkId) {
        return `${target.repoId ?? "default"}:doc_chunk:${target.chunkId}`;
    }
    return null;
};
