import fs from "fs";
import path from "path";
import url from "url";

export type ModelPathOptions = {
    modelId?: string;
    modelDir?: string;
    modelCacheDir?: string;
};

export type ModelPathDiagnostics = {
    candidates: string[];
    resolved?: string;
};

export function resolveEmbeddingModelSearchPaths(options: ModelPathOptions): ModelPathDiagnostics {
    const modelId = options.modelId?.trim();
    if (!modelId) {
        return { candidates: [] };
    }

    const candidates: string[] = [];
    const seen = new Set<string>();

    const addCandidate = (candidate?: string) => {
        if (!candidate) return;
        const normalized = path.resolve(candidate);
        if (seen.has(normalized)) return;
        seen.add(normalized);
        candidates.push(normalized);
    };

    const explicit = options.modelDir?.trim() || process.env.KAIRO_MODEL_DIR?.trim();
    if (explicit) {
        addCandidate(explicit);
        addCandidate(path.join(explicit, modelId));
    }

    const packageRoot = resolvePackageRoot();
    addCandidate(path.join(packageRoot, "dist", "models", modelId));
    addCandidate(path.join(packageRoot, "models", modelId));

    const cacheDir = options.modelCacheDir?.trim() || process.env.KAIRO_MODEL_CACHE_DIR?.trim();
    if (cacheDir) {
        addCandidate(cacheDir);
        addCandidate(path.join(cacheDir, modelId));
    }

    const transformersCache = process.env.TRANSFORMERS_CACHE?.trim();
    if (transformersCache) {
        addCandidate(transformersCache);
        addCandidate(path.join(transformersCache, modelId));
    }

    const hfHome = process.env.HF_HOME?.trim();
    if (hfHome) {
        addCandidate(path.join(hfHome, "hub", modelId.replace(/\//g, "--")));
    }

    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    if (homeDir) {
        addCandidate(path.join(homeDir, ".cache", "huggingface", "hub", modelId.replace(/\//g, "--")));
        addCandidate(path.join(homeDir, ".cache", "huggingface", "hub", `models--${modelId.replace(/\//g, "--")}`));
    }

    addCandidate(path.join(packageRoot, "node_modules", "@xenova", "transformers", ".cache", modelId));

    const resolved = findFirstExistingModelRoot(candidates);
    return { candidates, resolved };
}

export function findFirstExistingModelRoot(candidates: string[]): string | undefined {
    for (const candidate of candidates) {
        if (!candidate) continue;
        if (looksLikeModelRoot(candidate)) {
            return candidate;
        }
    }
    return undefined;
}

export function looksLikeModelRoot(candidate: string): boolean {
    try {
        const stat = fs.statSync(candidate);
        if (!stat.isDirectory()) return false;
        const configPath = path.join(candidate, "config.json");
        const tokenizerPath = path.join(candidate, "tokenizer.json");
        if (!fs.existsSync(configPath)) return false;
        if (!fs.existsSync(tokenizerPath)) return false;
        return true;
    } catch {
        return false;
    }
}

function resolvePackageRoot(): string {
    const currentDir = path.dirname(url.fileURLToPath(import.meta.url));
    return path.resolve(currentDir, "..", "..");
}
