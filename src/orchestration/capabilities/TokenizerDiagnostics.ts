import fs from "fs";
import path from "path";
import { resolveEmbeddingConfigFromEnv } from "../../embeddings/EmbeddingConfig.js";
import { resolveEmbeddingModelSearchPaths } from "../../embeddings/ModelPaths.js";
import { FeatureFlags } from "../../config/FeatureFlags.js";

export type TokenizerDiagnostics = {
  requiredForNativeChunking: boolean;
  resolvedPath?: string;
  searchedPaths: string[];
  missingReason?: string;
};

export function computeTokenizerDiagnostics(rootPath = process.cwd()): TokenizerDiagnostics {
  const rustCoreEnabled = FeatureFlags.isEnabled(FeatureFlags.RUST_CORE_ENABLED, FeatureFlags.getContext());
  const rustChunkingEnabled = resolveRustFeature(
    FeatureFlags.RUST_CHUNKING_ENABLED,
    rustCoreEnabled,
    process.env.KAIRO_RUST_CHUNKING
  );
  const searchedPaths: string[] = [];

  const explicit = process.env.KAIRO_TOKENIZER_PATH?.trim();
  if (explicit) {
    searchedPaths.push(explicit);
    if (fs.existsSync(explicit)) {
      return {
        requiredForNativeChunking: rustChunkingEnabled,
        resolvedPath: explicit,
        searchedPaths
      };
    }
    return {
      requiredForNativeChunking: rustChunkingEnabled,
      searchedPaths,
      missingReason: "KAIRO_TOKENIZER_PATH is set but the file does not exist."
    };
  }

  const embeddingConfig = resolveEmbeddingConfigFromEnv();
  const modelId = embeddingConfig.local?.model;
  if (!modelId) {
    return {
      requiredForNativeChunking: rustChunkingEnabled,
      searchedPaths,
      missingReason: "Local embedding model is not configured; set embedding.local.model or KAIRO_TOKENIZER_PATH."
    };
  }

  const candidates = resolveEmbeddingModelSearchPaths({
    modelId,
    modelDir: embeddingConfig.modelDir,
    modelCacheDir: embeddingConfig.modelCacheDir
  }).candidates;

  for (const dir of candidates) {
    const fullPath = path.join(dir, "tokenizer.json");
    searchedPaths.push(fullPath);
    if (fs.existsSync(fullPath)) {
      return {
        requiredForNativeChunking: rustChunkingEnabled,
        resolvedPath: fullPath,
        searchedPaths
      };
    }
  }

  return {
    requiredForNativeChunking: rustChunkingEnabled,
    searchedPaths,
    missingReason: `tokenizer.json not found for model "${modelId}". Set KAIRO_TOKENIZER_PATH or configure the local model cache.`
  };
}

function resolveRustFeature(flag: string, coreEnabled: boolean, legacyEnv?: string): boolean {
  if (!coreEnabled) return false;
  if (FeatureFlags.isExplicit(flag)) {
    return FeatureFlags.isEnabled(flag, FeatureFlags.getContext());
  }
  if (legacyEnv !== undefined) {
    return parseBoolish(legacyEnv);
  }
  return true;
}

function parseBoolish(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "on" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "off" || normalized === "no") return false;
  return false;
}
