import { createRequire } from "module";

type RustDiffResult = {
    diff: string;
    added: number;
    removed: number;
};

type RustDiffModule = {
    diffUnified: (oldText: string, newText: string, contextLines: number) => RustDiffResult;
};

const require = createRequire(import.meta.url);

export class RustDiff {
    private static instance: RustDiff | null = null;
    private static warned = false;
    private module: RustDiffModule | null = null;

    private constructor() {
        try {
            this.module = require("@kairo/core-rs") as RustDiffModule;
        } catch (error: any) {
            this.warnOnce(`Rust diff unavailable (${error?.message ?? "unknown error"}); falling back to JS diff.`);
            this.module = null;
        }
    }

    static getShared(): RustDiff {
        if (!this.instance) {
            this.instance = new RustDiff();
        }
        return this.instance;
    }

    isAvailable(): boolean {
        return this.module !== null;
    }

    diffUnified(oldText: string, newText: string, contextLines: number): RustDiffResult {
        if (!this.module) {
            return { diff: "", added: 0, removed: 0 };
        }
        return this.module.diffUnified(oldText, newText, contextLines);
    }

    private warnOnce(message: string): void {
        if (RustDiff.warned) return;
        RustDiff.warned = true;
        console.warn(`[RustDiff] ${message}`);
    }
}
