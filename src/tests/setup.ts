import { NativeModuleLoader } from "../orchestration/capabilities/NativeModuleLoader.js";
import type { RustCoreModule } from "../orchestration/capabilities/NativeModuleLoader.js";
import { PatienceDiff } from "../engine/PatienceDiff.js";
import { NativeSearchCoreStub } from "./utils/NativeSearchCoreStub.js";

const createMockRustCore = (): RustCoreModule => {
  class MockNativeSearchCore {
    private readonly core = new NativeSearchCoreStub();

    constructor(_indexDir: string, _options?: { writerMemoryMb?: number; kairoVersion?: string; repoId?: string }) {}

    upsert(doc: any) {
      this.core.upsert(doc);
    }

    upsertMany(docs: any[]) {
      this.core.upsertMany(docs);
    }

    deleteDoc(target: any) {
      this.core.deleteDoc(target);
    }

    commit() {
      this.core.commit();
    }

    search(query: any) {
      return this.core.search(query);
    }

    close() {
      this.core.close();
    }

    stats() {
      return this.core.stats();
    }

    reset() {
      this.core.reset();
    }
  }

  return {
    SmartChunker: class {
      constructor(_tokenizerPath: string) {}

      chunk(
        text: string,
        maxTokens: number,
        overlapTokens: number
      ): Array<{
        text: string;
        startByte: number;
        endByte: number;
        startToken: number;
        endToken: number;
      }> {
        const tokens = collectTokens(text);
        if (tokens.length === 0 || maxTokens <= 0) return [];
        const step = Math.max(1, maxTokens - Math.max(0, overlapTokens));
        const chunks: Array<{
          text: string;
          startByte: number;
          endByte: number;
          startToken: number;
          endToken: number;
        }> = [];
        for (let startToken = 0; startToken < tokens.length; startToken += step) {
          const endToken = Math.min(tokens.length, startToken + maxTokens);
          const slice = tokens.slice(startToken, endToken);
          const startByte = slice[0]?.start ?? 0;
          const endByte = slice[slice.length - 1]?.end ?? startByte;
          const chunkText = text.slice(startByte, endByte);
          chunks.push({
            text: chunkText,
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
    NativeSearchCore: MockNativeSearchCore
  };
};

const installNativeSearchStub = () => {
  NativeModuleLoader.setTestLoader(createMockRustCore);
};

installNativeSearchStub();

beforeEach(() => {
  installNativeSearchStub();
});

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

const originalWarn = console.warn.bind(console);
const originalError = console.error.bind(console);

console.warn = (...args: any[]) => {
  if (args.length === 1 && typeof args[0] === "string") {
    try {
      const parsed = JSON.parse(args[0]);
      if (parsed?.code === "TOOL_DEPRECATED") {
        return;
      }
    } catch {
      // fall through
    }
  }
  if (args.length >= 1 && typeof args[0] === "string") {
    if (args[0].startsWith("[LanguageConfig] Failed to parse ")) {
      return;
    }
    if (args[0].startsWith("[Embedding] Primary model failed; falling back")) {
      return;
    }
  }
  originalWarn(...args);
};

console.error = (...args: any[]) => {
  if (args.length >= 1 && typeof args[0] === "string") {
    const message = args[0];
    if (message.startsWith("An error occurred during model execution")) {
      return;
    }
    if (message.startsWith("Inputs given to model")) {
      return;
    }
  }
  originalError(...args);
};
