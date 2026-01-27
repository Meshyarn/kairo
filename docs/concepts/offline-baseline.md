# Offline Baseline: native search + embeddings

Kairo is designed to be useful without external APIs.

## Two search layers

- **Lexical search** (fast, reliable): backed by the native core (`@kairo/core-rs`).
- **Vector search** (semantic): optional; requires embeddings and (optionally) a vector index.

## Lexical vs Vector comparison

| Aspect | Lexical | Vector |
|--------|---------|--------|
| **Speed** | Fast (< 100ms) | Slower (may require GPU for inference) |
| **Setup** | Built-in, no config | Requires model + embeddings |
| **Accuracy** | Keyword matching, exact phrases | Semantic similarity, paraphrases |
| **Use case** | Function names, class lookups, file paths | Conceptual searches, cross-language patterns |
| **False negatives** | High (misses synonyms) | Low (catches similar concepts) |
| **Offline capable** | ✅ Yes (native core) | ✅ Yes (local embeddings) |
| **External deps** | None | Optional (HuggingFace for model download) |

**Recommendation:**
- Start with **lexical search only** (default). It's fast and covers 80% of real queries.
- Enable **vector search** when you need semantic understanding (e.g., finding auth patterns across different naming conventions).

## Embeddings: local by default

Kairo assumes offline-first operation unless you explicitly opt in to remote embeddings.

Practical guidance:

- Start with lexical search + evidence packs.
- Enable local embeddings when semantic recall matters for your workflows.
- Prebuild a vector index for large repos if startup rebuild is too slow.

If you're evaluating the offline baseline, start with:

- [Search & Embeddings](/guides/search-and-embeddings) (model packaging + index build steps)
- [Search & embeddings config](/reference/configuration/search-and-embeddings)

