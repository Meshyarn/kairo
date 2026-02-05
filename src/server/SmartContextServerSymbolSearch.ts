import { SymbolEmbeddingIndex } from "../indexing/SymbolEmbeddingIndex.js";
import type { EmbeddingProviderFactory } from "../embeddings/EmbeddingProviderFactory.js";
import type { EmbeddingRepository } from "../indexing/EmbeddingRepository.js";
import type { VectorIndexManager } from "../vector/VectorIndexManager.js";
import type { SymbolIndex } from "../ast/SymbolIndex.js";
import { resolveEmbeddingProviderEnv } from "../embeddings/EmbeddingConfig.js";

export async function initSymbolSemanticSearch(args: {
  embeddingProviderFactory: EmbeddingProviderFactory;
  vectorIndexManager: VectorIndexManager;
  embeddingRepository: EmbeddingRepository;
  symbolIndex: SymbolIndex;
  parseNumberEnv: (raw: string | undefined, fallback: number) => number;
}): Promise<SymbolEmbeddingIndex | undefined> {
  const {
    embeddingProviderFactory,
    vectorIndexManager,
    embeddingRepository,
    symbolIndex,
    parseNumberEnv
  } = args;
  const enabled = (process.env.KAIRO_SYMBOL_SEMANTIC_SEARCH_ENABLED ?? "false").toLowerCase() === "true";
  const mode = (process.env.KAIRO_SYMBOL_SEMANTIC_SEARCH_MODE ?? "manual").toLowerCase();
  if (!enabled || mode === "off") {
    return undefined;
  }
  const embeddingConfig = embeddingProviderFactory.getConfig();
  const providerEnv = resolveEmbeddingProviderEnv(embeddingConfig).provider;
  const baseModel = embeddingConfig.local?.model ?? "multilingual-e5-small";
  if (providerEnv === "disabled" || baseModel === "hash" || baseModel.startsWith("hash-")) {
    return undefined;
  }
  const provider = await embeddingProviderFactory.getProvider();
  if (provider.provider === "disabled" || provider.model === "hash") {
    return undefined;
  }
  const symbolModelKey = process.env.KAIRO_SYMBOL_EMBEDDING_MODEL_KEY
    ?? `${provider.model}::symbols_v1`;
  return new SymbolEmbeddingIndex(
    symbolIndex,
    vectorIndexManager,
    embeddingRepository,
    provider,
    {
      enabled: true,
      mode: mode === "manual" ? "manual" : "off",
      batchSize: parseNumberEnv(process.env.KAIRO_SYMBOL_EMBEDDINGS_BATCH_SIZE, 10),
      minSimilarity: parseNumberEnv(process.env.KAIRO_SYMBOL_EMBEDDINGS_MIN_SIMILARITY, 0.5),
      maxResults: parseNumberEnv(process.env.KAIRO_SYMBOL_EMBEDDINGS_MAX_RESULTS, 20),
      maxTextChars: parseNumberEnv(process.env.KAIRO_SYMBOL_EMBEDDINGS_MAX_TEXT_CHARS, 2000),
      maxFiles: parseNumberEnv(process.env.KAIRO_SYMBOL_EMBEDDINGS_MAX_FILES, 2000),
      maxSymbols: parseNumberEnv(process.env.KAIRO_SYMBOL_EMBEDDINGS_MAX_SYMBOLS, 20000),
      maxBytesPerSymbol: parseNumberEnv(process.env.KAIRO_SYMBOL_EMBEDDINGS_MAX_BYTES_PER_SYMBOL, 4000),
      timeoutMs: parseNumberEnv(process.env.KAIRO_SYMBOL_EMBEDDINGS_TIMEOUT_MS, 60000),
      symbolModelKey
    }
  );
}
