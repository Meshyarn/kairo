import fs from "fs";
import path from "path";
import type { EmbeddingConfig } from "../types.js";
import { resolveEmbeddingConfigFromEnv } from "./EmbeddingConfig.js";
import { resolveEmbeddingModelSearchPaths } from "./ModelPaths.js";

export type OfflineBaselineLevel = "none" | "A-core" | "B-embeddings-ready";

export type EmbeddingDiagnostics = {
    providerRequested: "auto" | "local" | "remote" | "disabled";
    remoteDownloadsAllowed: boolean;
    modelId?: string;
    quantized: boolean;
    resolvedModelRoot?: string;
    searchedModelRoots: string[];
    missingAssets?: string[];
    offlineBaselineLevel: OfflineBaselineLevel;
};

export function computeEmbeddingDiagnostics(options?: { config?: EmbeddingConfig }): EmbeddingDiagnostics {
    const config = options?.config ?? resolveEmbeddingConfigFromEnv();
    const providerRequested = (config.provider ?? "auto") as EmbeddingDiagnostics["providerRequested"];
    const remoteDownloadsAllowed = providerRequested === "remote";
    const modelId = config.local?.model;
    const quantized = config.local?.quantized !== false;
    const searched = resolveEmbeddingModelSearchPaths({
        modelId,
        modelDir: config.modelDir,
        modelCacheDir: config.modelCacheDir
    });

    const isHash = isHashModel(modelId);
    const missingAssets = !isHash && modelId
        ? resolveMissingAssets(searched.resolved, quantized)
        : [];

    let offlineBaselineLevel: OfflineBaselineLevel = remoteDownloadsAllowed ? "none" : "A-core";
    if (!remoteDownloadsAllowed && modelId && !isHash && missingAssets.length === 0 && searched.resolved) {
        offlineBaselineLevel = "B-embeddings-ready";
    }

    return {
        providerRequested,
        remoteDownloadsAllowed,
        modelId,
        quantized,
        resolvedModelRoot: searched.resolved,
        searchedModelRoots: searched.candidates,
        missingAssets: missingAssets.length > 0 ? missingAssets : undefined,
        offlineBaselineLevel
    };
}

export function isHashModel(modelId?: string): boolean {
    if (!modelId) return false;
    const normalized = modelId.trim().toLowerCase();
    return normalized === "hash" || normalized.startsWith("hash-");
}

function resolveMissingAssets(modelRoot: string | undefined, quantized: boolean): string[] {
    const required: string[] = [
        "config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        quantized ? path.join("onnx", "model_quantized.onnx") : path.join("onnx", "model.onnx")
    ];
    if (!modelRoot) {
        return required;
    }
    const missing: string[] = [];
    for (const file of required) {
        if (!fs.existsSync(path.join(modelRoot, file))) {
            missing.push(file);
        }
    }
    return missing;
}
