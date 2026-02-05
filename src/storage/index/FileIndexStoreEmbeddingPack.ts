import * as fs from "fs";
import * as path from "path";
import { EmbeddingPackManager, type EmbeddingPackConfig } from "../EmbeddingPack.js";
import { decodeVector } from "./IndexCache.js";
import { readJson } from "./IndexReader.js";
import type { PersistedEmbedding } from "./IndexTypes.js";

type EmbeddingPackState = {
    storageDir: string;
    embeddingsPath: string;
    embeddingPackConfig: EmbeddingPackConfig;
    embeddingPacks: Map<string, EmbeddingPackManager>;
    hasLegacyEmbeddingsOnDisk: boolean;
    hasEmbeddingPackOnDisk: boolean;
};

export const getEmbeddingPack = (store: EmbeddingPackState, key: { provider: string; model: string }): EmbeddingPackManager => {
    const mapKey = `${key.provider}::${key.model}`;
    const existing = store.embeddingPacks.get(mapKey);
    if (existing) return existing;
    const pack = new EmbeddingPackManager(key, store.embeddingPackConfig);
    store.embeddingPacks.set(mapKey, pack);
    return pack;
};

export const detectEmbeddingPackOnDisk = (store: EmbeddingPackState): boolean => {
    const v1Dir = path.join(store.storageDir, "v1", "embeddings");
    if (!fs.existsSync(v1Dir)) return false;
    try {
        const providers = fs.readdirSync(v1Dir);
        for (const provider of providers) {
            const providerDir = path.join(v1Dir, provider);
            if (!fs.statSync(providerDir).isDirectory()) continue;
            const models = fs.readdirSync(providerDir);
            for (const model of models) {
                const dir = path.join(providerDir, model);
                if (!fs.statSync(dir).isDirectory()) continue;
                const readyPath = path.join(dir, "ready.json");
                if (fs.existsSync(readyPath)) return true;
            }
        }
    } catch {
        return false;
    }
    return false;
};

export const maybeMigrateEmbeddingPack = (store: EmbeddingPackState): void => {
    if (!store.embeddingPackConfig.enabled || !store.hasLegacyEmbeddingsOnDisk) return;
    if (store.embeddingPackConfig.rebuild === "manual") return;
    const hasReadyPack = detectEmbeddingPackOnDisk(store);
    if (store.embeddingPackConfig.rebuild === "auto" && hasReadyPack) {
        store.hasEmbeddingPackOnDisk = true;
        return;
    }

    try {
        if (store.embeddingPackConfig.rebuild === "on_start") {
            const v1Dir = path.join(store.storageDir, "v1", "embeddings");
            fs.rmSync(v1Dir, { recursive: true, force: true });
        }

        const embeddings = readJson<Record<string, Record<string, PersistedEmbedding>>>(store.embeddingsPath, {});
        const packs = new Map<string, EmbeddingPackManager>();
        let wrote = false;

        for (const [chunkId, variants] of Object.entries(embeddings)) {
            for (const [variantKey, payload] of Object.entries(variants ?? {})) {
                if (!payload?.vector) continue;
                const [provider, model] = variantKey.split("::", 2);
                if (!provider || !model) continue;
                const packKey = `${provider}::${model}`;
                let pack = packs.get(packKey);
                if (!pack) {
                    pack = new EmbeddingPackManager({ provider, model }, store.embeddingPackConfig);
                    packs.set(packKey, pack);
                }
                const vector = decodeVector(payload.vector);
                pack.upsertEmbedding(chunkId, { dims: payload.dims, vector, norm: payload.norm });
                wrote = true;
            }
        }

        for (const pack of packs.values()) {
            pack.markReady();
            pack.close();
        }

        if (wrote) {
            store.hasEmbeddingPackOnDisk = true;
        }
    } catch (err) {
        console.warn("[embedding-pack] Failed to migrate legacy embeddings pack:", err);
    }
};
