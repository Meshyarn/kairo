# Technical Glossary

This page defines commonly used technical terms in Kairo documentation.

## A

**Artifact**  
A retrievable data package (fetched via `manage({ command: "artifact", target: "<id>" })`). Artifacts contain verification data, analysis results, or evidence packs. Identified by `artifactId` in responses.

**Adaptive LOD** (Level of Detail)  
See [LOD](#l).

## D

**Drift**  
A state where Kairo's internal file index **differs from the actual filesystem**. Drift is detected when:
- External edits happen outside Kairo (e.g., user edits, concurrent tools)
- File deletions or renames occur
- Disk contents change between calls

Kairo blocks **unsafe** edits when drift is detected. See [Mixed-workflow resilience (ADR-077)](/adr/ADR-077-mixed-workflow-resilience) and [Safe Writes](/concepts/safe-writes).

**Drift check**  
Kairo's mechanism to detect and report workspace drift. Run `manage({ command: "status" })` to check: `status.drift.workspaceDrift`.

## E

**Embeddings**  
Vector representations of text. Kairo uses embeddings for optional **vector search** (semantic similarity). Embeddings are computed locally and indexed for fast retrieval. Requires `KAIRO_GRAPHRAG_ENABLED=true` or a `.kairo/config/graphrag.json` setup. See [Search & Embeddings](/guides/search-and-embeddings).

**Evidence pack**  
A type of artifact containing verification data (file excerpts, search scores, analysis details). All evidence packs are artifacts.

## G

**GraphRAG**  
Graph-based Retrieval-Augmented Generation. In Kairo, GraphRAG powers:
- **Cluster analysis**: groups related code into semantic clusters
- **Vector embeddings**: maps code/docs into a semantic space for similarity search
- **Entity extraction**: identifies key abstractions and relationships

Enable via `KAIRO_GRAPHRAG_ENABLED=true` or by providing `.kairo/config/graphrag.json`. See [Search & Embeddings](/guides/search-and-embeddings).

## L

**LOD** (Level of Detail)  
A budget/depth parameter that controls how much context Kairo gathers:
- **Shallow**: Fast, minimal context (e.g., search only top 5 files).
- **Balanced**: Medium depth (e.g., top 20 files, shallow clustering).
- **Deep**: Expensive, full analysis (e.g., full clustering, all evidence).

Set via `budget: "lean" | "balanced" | "deep"` in tool calls. LOD affects token usage, timeout, and result quality.

**Lexical search**  
Full-text search based on keywords and exact matching. Kairo's native search core (Tantivy-backed) provides fast lexical search without external dependencies. Paired with optional vector search for richer results. See [Offline Baseline](/concepts/offline-baseline).

## M

**MCTS** (Monte Carlo Tree Search)  
A search algorithm used in Kairo's strategy evaluation:
- Explores multiple candidate solution paths.
- Ranks them by estimated quality.
- Selects the best without exhaustive enumeration.

Used internally for `plan_change` strategy selection. Configuration: `strategySearch.mcts` (see [ADR-082](/adr/ADR-082-simulate-reason-execute-mcts)).

## P

**Promptless**  
A design principle: workflows driven by **structured parameters** instead of natural-language prompts. This eliminates ambiguity, improves reliability, and makes tool behavior deterministic. All Kairo tools use promptless design.

**Public Surface**  
The set of tools exposed to the MCP host and agents:
- **Compact** (default in MCP mode): `task`, `manage`
- **Pillars** (opt-in via `KAIRO_PUBLIC_SURFACE=pillars`): `explore`, `understand`, `change`, `write`, `manage`

See [Public Surfaces](/concepts/public-surface).

## S

**Session**  
A stateful workflow context (`sessionId`) that persists artifacts and analysis across multiple tool calls:
1. **Explore** (optional research)
2. **Understand** (analysis + clustering)
3. **Change/Write** (plan first, then apply)

Sessions enable **reuse** of expensive intermediate results (embeddings, clusters). See [Sessions](/concepts/sessions).

**Stdio** (Standard Input/Output)  
The communication protocol MCP uses. Kairo runs as a stdio server, reading JSON-lines requests from stdin and writing responses to stdout. Timeouts and permissions are managed by the MCP host.

## T

**Tokenizer**  
A utility that converts text into tokens for LLM consumption:
- In Kairo context: counts tokens to enforce budget caps.
- Used internally for `output.maxTokens` enforcement.
- Prevents response overflow in constrained environments (e.g., MCP hosts with per-request limits).

## V

**Vector search**  
Semantic search using embeddings. Queries and documents are converted to vectors, and similarity is computed. Enables "search by meaning" rather than keywords. Optional in Kairo (powered by GraphRAG when enabled). See [Offline Baseline](/concepts/offline-baseline).

---

For deeper context, see:
- [Concepts](/concepts/) — explanations of core ideas
- [Architecture (ADRs)](/adr/) — design decisions and rationale
