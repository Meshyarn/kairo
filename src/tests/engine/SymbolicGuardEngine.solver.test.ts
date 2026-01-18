import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { SymbolicGuardEngine } from "../../engine/validators/symbolic-guard-engine.js";
import { EngineManager } from "../../orchestration/capabilities/EngineManager.js";
import { CAP_SYMBOLIC_SOLVE } from "../../orchestration/capabilities/CapabilityIds.js";
import { AstManager } from "../../ast/AstManager.js";
import { FeatureFlags } from "../../config/FeatureFlags.js";
import { NativeModuleLoader } from "../../orchestration/capabilities/NativeModuleLoader.js";
import type { CapabilityProvider } from "../../orchestration/capabilities/EngineManager.js";
import type { ISymbolicSolverProvider } from "../../orchestration/capabilities/SymbolicSolver.js";

const originalEnv = {
    KAIRO_DIR: process.env.KAIRO_DIR,
    KAIRO_SYMBOLIC_GUARDS_ENABLED: process.env.KAIRO_SYMBOLIC_GUARDS_ENABLED,
    KAIRO_SYMBOLIC_GUARDS_MODE: process.env.KAIRO_SYMBOLIC_GUARDS_MODE
};

const writeSymbolicConfig = (rootDir: string) => {
    const configDir = path.join(rootDir, "config");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
        path.join(configDir, "symbolic-guards.json"),
        JSON.stringify({
            enabled: true,
            mode: "strict",
            solver: { enabled: true }
        }, null, 2),
        "utf-8"
    );
};

describe("SymbolicGuardEngine solver integration", () => {
    let tempDir: string | null = null;

    beforeEach(() => {
        EngineManager.resetForTesting();
        FeatureFlags.resetForTesting();
        NativeModuleLoader.resetForTesting();
        AstManager.resetForTesting();
    });

    afterEach(() => {
        EngineManager.resetForTesting();
        FeatureFlags.resetForTesting();
        NativeModuleLoader.resetForTesting();
        AstManager.resetForTesting();
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        tempDir = null;
        if (originalEnv.KAIRO_DIR === undefined) {
            delete process.env.KAIRO_DIR;
        } else {
            process.env.KAIRO_DIR = originalEnv.KAIRO_DIR;
        }
        if (originalEnv.KAIRO_SYMBOLIC_GUARDS_ENABLED === undefined) {
            delete process.env.KAIRO_SYMBOLIC_GUARDS_ENABLED;
        } else {
            process.env.KAIRO_SYMBOLIC_GUARDS_ENABLED = originalEnv.KAIRO_SYMBOLIC_GUARDS_ENABLED;
        }
        if (originalEnv.KAIRO_SYMBOLIC_GUARDS_MODE === undefined) {
            delete process.env.KAIRO_SYMBOLIC_GUARDS_MODE;
        } else {
            process.env.KAIRO_SYMBOLIC_GUARDS_MODE = originalEnv.KAIRO_SYMBOLIC_GUARDS_MODE;
        }
        jest.restoreAllMocks();
    });

    it("merges solver diagnostics in strict mode", async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-symbolic-"));
        process.env.KAIRO_DIR = tempDir;
        process.env.KAIRO_SYMBOLIC_GUARDS_ENABLED = "true";
        process.env.KAIRO_SYMBOLIC_GUARDS_MODE = "strict";
        writeSymbolicConfig(tempDir);

        const provider: CapabilityProvider<ISymbolicSolverProvider> = {
            meta: { id: "TestSymbolicSolverProvider", tier: "native", priority: 200 },
            isAvailable: () => true,
            get: () => ({
                solve: async () => ({
                    diagnostics: [{
                        code: "solver_custom",
                        severity: "high",
                        message: "Solver detected an issue.",
                        filePath: "src/example.ts",
                        line: 1,
                        column: 1
                    }]
                })
            })
        };
        EngineManager.registerProvider(CAP_SYMBOLIC_SOLVE, provider);

        const engine = new SymbolicGuardEngine();
        const result = await engine.evaluate({
            filePath: "src/example.ts",
            content: "const value = items[i];"
        });

        expect(result.stats.solverUsed).toBe(true);
        const codes = result.diagnostics.map((diag) => diag.code);
        expect(codes).toContain("solver_custom");
        expect(codes).toContain("index_bounds");
    });

    it("records solver_unavailable when no solver capability is available", async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-symbolic-"));
        process.env.KAIRO_DIR = tempDir;
        process.env.KAIRO_SYMBOLIC_GUARDS_ENABLED = "true";
        process.env.KAIRO_SYMBOLIC_GUARDS_MODE = "strict";
        writeSymbolicConfig(tempDir);

        const engine = new SymbolicGuardEngine();
        const result = await engine.evaluate({
            filePath: "src/example.ts",
            content: "const value = items[i];"
        });

        expect(result.degradedReasons).toContain("solver_unavailable");
    });
});
