import * as path from "path";
import { PathManager } from "../utils/PathManager.js";
import type { EmbeddingKey } from "./IndexStore.js";

export type PackPaths = {
    dir: string;
    metaPath: string;
    indexPath: string;
    tombstonesPath: string;
    readyPath: string;
    indexBinPath: string;
    f32Path: string;
    q8Path: string;
};

export const resolveEmbeddingPackDir = (key: EmbeddingKey): string => {
    return path.join(PathManager.getStorageDir(), "v1", "embeddings", key.provider, key.model);
};

export const getPackPaths = (key: EmbeddingKey): PackPaths => {
    const dir = resolveEmbeddingPackDir(key);
    return {
        dir,
        metaPath: path.join(dir, "meta.json"),
        indexPath: path.join(dir, "embeddings.index.json"),
        tombstonesPath: path.join(dir, "tombstones.json"),
        readyPath: path.join(dir, "ready.json"),
        indexBinPath: path.join(dir, "embeddings.index.bin"),
        f32Path: path.join(dir, "embeddings.f32.bin"),
        q8Path: path.join(dir, "embeddings.q8.bin")
    };
};
