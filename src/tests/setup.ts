import { NativeModuleLoader } from "../orchestration/capabilities/NativeModuleLoader.js";
import { NativeSearchCoreStub } from "./utils/NativeSearchCoreStub.js";

process.env.KAIRO_RUST_CHUNKING_ENABLED = "false";
process.env.KAIRO_RUST_DIFF_ENABLED = "false";
process.env.KAIRO_RUST_SYNTAX_ENABLED = "false";
process.env.KAIRO_RUST_VECTOR_ENABLED = "false";
process.env.KAIRO_RUST_SYMBOLIC_SOLVER_ENABLED = "false";

const installNativeSearchStub = () => {
  NativeModuleLoader.setTestLoader(() => ({
    NativeSearchCore: class {
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
  }));
};

installNativeSearchStub();

beforeEach(() => {
  installNativeSearchStub();
});

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
