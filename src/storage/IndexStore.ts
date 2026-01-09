export type {
    StorageMode,
    FileRecord,
    StoredDependency,
    StoredUnresolvedDependency,
    StoredGhostSymbol,
    StoredDocumentChunk,
    StoredEmbedding,
    EmbeddingKey,
    TransactionLogEntry,
    IndexStore
} from "./index/IndexTypes.js";

export { MemoryIndexStore, FileIndexStore } from "./index/IndexStore.js";
export { createIndexStore, resolveStorageMode } from "./index/IndexMaintenance.js";
