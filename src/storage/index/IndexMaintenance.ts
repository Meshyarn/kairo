import type { IndexStore, StorageMode } from "./IndexTypes.js";
import { FileIndexStore, MemoryIndexStore } from "./IndexStore.js";

export function resolveStorageMode(): StorageMode {
    const raw = (process.env.KAIRO_STORAGE_MODE ?? "").trim().toLowerCase();
    if (raw === "memory") return "memory";
    return "file";
}

export function createIndexStore(rootPath: string, repoId?: string): IndexStore {
    const mode = resolveStorageMode();
    if (mode === "memory") {
        return new MemoryIndexStore(rootPath, "memory");
    }
    return new FileIndexStore(rootPath, repoId);
}
