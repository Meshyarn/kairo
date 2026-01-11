import { createRequire } from "module";
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
            const loader = NativeModuleLoader.testLoader ?? (() => require("@kairo/core-rs") as RustCoreModule);
            this.module = loader();
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
}
