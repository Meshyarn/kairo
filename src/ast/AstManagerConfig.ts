import * as path from "path";
import type { AstBackend } from "./AstBackend.js";
import { WebTreeSitterBackend } from "./WebTreeSitterBackend.js";
import { JsAstBackend } from "./JsAstBackend.js";
import { SnapshotBackend } from "./SnapshotBackend.js";
import type { EngineConfig } from "../types.js";
import type { LanguageConfigLoader } from "../config/LanguageConfig.js";
import { BUILTIN_LANGUAGE_MAPPINGS } from "../config/LanguageConfig.js";

export function resolveConfig(overrides: EngineConfig | undefined, engineConfig: EngineConfig): EngineConfig {
  const envMode = process.env.KAIRO_ENGINE_MODE as EngineConfig["mode"] | undefined;
  const envBackend = process.env.KAIRO_PARSER_BACKEND as EngineConfig["parserBackend"] | undefined;
  const envSnapshot = process.env.KAIRO_SNAPSHOT_DIR;
  const envRoot = process.env.KAIRO_ROOT_PATH || process.env.KAIRO_ROOT;
  const isTestEnv = process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID !== undefined;

  return {
    mode: overrides?.mode ?? envMode ?? engineConfig.mode ?? (isTestEnv ? "test" : "prod"),
    parserBackend: overrides?.parserBackend ?? envBackend ?? engineConfig.parserBackend ?? "auto",
    snapshotDir: overrides?.snapshotDir ?? envSnapshot ?? engineConfig.snapshotDir,
    rootPath: overrides?.rootPath ?? engineConfig.rootPath ?? envRoot ?? process.cwd()
  };
}

export function getBackendPriority(engineConfig: EngineConfig): Array<NonNullable<EngineConfig["parserBackend"]>> {
  const mode = engineConfig.mode ?? "prod";
  const requested = engineConfig.parserBackend ?? "auto";

  if (requested !== "auto") {
    return [requested];
  }

  switch (mode) {
    case "test":
      if (engineConfig.snapshotDir && engineConfig.rootPath) {
        return ["snapshot", "js", "wasm"];
      }
      return ["js", "wasm"];
    case "ci":
      return ["wasm", "js"];
    case "prod":
    default:
      return ["wasm", "js"];
  }
}

export function instantiateBackend(kind: string, engineConfig: EngineConfig): AstBackend {
  switch (kind) {
    case "wasm":
      return new WebTreeSitterBackend();
    case "js":
      return new JsAstBackend();
    case "snapshot":
      if (!engineConfig.snapshotDir || !engineConfig.rootPath) {
        throw new Error("Snapshot backend requires snapshotDir and rootPath");
      }
      return new SnapshotBackend({
        snapshotDir: engineConfig.snapshotDir,
        rootPath: engineConfig.rootPath
      });
    default:
      throw new Error(`Unknown parser backend: ${kind}`);
  }
}

export async function initializeBackend(
  engineConfig: EngineConfig,
  currentBackend: AstBackend | undefined,
  setState: (next: { backend: AstBackend; activeBackend: string }) => void
): Promise<void> {
  const candidates = getBackendPriority(engineConfig);
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      const backend = instantiateBackend(candidate, engineConfig);
      await backend.initialize();
      setState({ backend, activeBackend: candidate });
      (currentBackend as any)?.dispose?.();
      return;
    } catch (error: any) {
      errors.push(`${candidate}: ${error.message}`);
    }
  }

  throw new Error(`Failed to initialize AST backend. Attempts: ${errors.join("; ")}`);
}

export function resolveLanguageId(filePath: string, languageConfig?: LanguageConfigLoader): string {
  const mapping = getLanguageMapping(filePath, languageConfig);
  if (mapping?.languageId) {
    return mapping.languageId;
  }
  return "plain_text";
}

export function getLanguageMapping(filePath: string, languageConfig?: LanguageConfigLoader) {
  const ext = path.extname(filePath).toLowerCase();
  return languageConfig?.getLanguageMapping(ext) ?? BUILTIN_LANGUAGE_MAPPINGS[ext];
}
