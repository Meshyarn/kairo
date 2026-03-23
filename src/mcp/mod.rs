use anyhow::Result;
use rmcp::{
    ServerHandler, schemars, tool, tool_router,
    handler::server::{router::Router, wrapper::Parameters},
    model::{ServerCapabilities, ServerInfo},
    transport::io::stdio,
};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use crate::common::fs;
use crate::graph::ProjectGraph;
use crate::search::embedder::{self, EmbedderState};
use crate::search::SearchIndex;
use crate::watcher::FileWatcher;

/// Input parameters for kairo_search
#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct SearchParams {
    /// Natural language query
    #[schemars(description = "Natural language query")]
    query: String,

    /// Search scope (default: code)
    #[schemars(description = "Search scope: 'code', 'docs', or 'all'")]
    scope: Option<String>,

    /// Max results (default: 10)
    #[schemars(description = "Max results (default: 10)")]
    limit: Option<usize>,
}

/// Input parameters for kairo_status
#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct StatusParams {
    /// Action to perform
    #[schemars(description = "check: view status, reindex: rebuild index (BM25 instant + embeddings in background), download-model: download BGE-M3 embedding model (default: check)")]
    action: Option<String>,
}

/// Input parameters for kairo_graph
#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct GraphParams {
    /// Operation to perform
    #[schemars(description = "Operation: 'deps' (what does a file import?), 'dependents' (who imports this file?), 'cycles' (find circular deps), 'path' (shortest dependency path between two files)")]
    operation: String,

    /// Relative file path (required for deps, dependents, path)
    #[schemars(description = "Relative file path, e.g. 'src/main.rs'")]
    file: Option<String>,

    /// Target file for 'path' operation
    #[schemars(description = "Target file for 'path' operation")]
    target: Option<String>,
}

/// Embedding progress tracker
#[derive(Debug, Clone)]
struct EmbeddingProgress {
    /// Total chunks to embed
    total: Arc<AtomicUsize>,
    /// Chunks embedded so far
    done: Arc<AtomicUsize>,
    /// Whether embedding is currently running
    active: Arc<AtomicBool>,
    /// Cancel signal
    cancel: Arc<AtomicBool>,
}

impl EmbeddingProgress {
    fn new() -> Self {
        Self {
            total: Arc::new(AtomicUsize::new(0)),
            done: Arc::new(AtomicUsize::new(0)),
            active: Arc::new(AtomicBool::new(false)),
            cancel: Arc::new(AtomicBool::new(false)),
        }
    }
}

/// Watcher state visible to status reporting
#[derive(Debug, Clone)]
struct WatcherState {
    active: Arc<AtomicBool>,
    last_update: Arc<AtomicU64>,
    pending_count: Arc<AtomicU64>,
}

/// MCP Server for Kairo
#[derive(Debug, Clone)]
pub struct KairoServer {
    index: Arc<Mutex<Option<SearchIndex>>>,
    embedder: Arc<Mutex<EmbedderState>>,
    graph: Arc<Mutex<ProjectGraph>>,
    root: PathBuf,
    embedding_progress: EmbeddingProgress,
    watcher_state: Option<WatcherState>,
}

impl KairoServer {
    pub fn new(root: PathBuf) -> Self {
        let graph = ProjectGraph::load(&root);
        Self {
            index: Arc::new(Mutex::new(None)),
            embedder: Arc::new(Mutex::new(EmbedderState::Unavailable)),
            graph: Arc::new(Mutex::new(graph)),
            root,
            embedding_progress: EmbeddingProgress::new(),
            watcher_state: None,
        }
    }

    fn ensure_index(&self) -> std::result::Result<(), String> {
        let mut guard = self.index.lock().unwrap_or_else(|e| e.into_inner());
        if guard.is_none() {
            let mut idx = SearchIndex::open(&self.root).map_err(|e| e.to_string())?;
            if idx.is_empty() {
                let files = fs::walk_directory(&self.root).map_err(|e| e.to_string())?;
                idx.build_index_from(&files).map_err(|e| e.to_string())?;

                let mut graph = self.graph.lock().unwrap_or_else(|e| e.into_inner());
                let changed = graph.update(&files);
                if changed > 0 {
                    let _ = graph.save(&self.root);
                }
            }
            *guard = Some(idx);
        }

        // Ensure graph is populated even if index already existed
        {
            let graph = self.graph.lock().unwrap_or_else(|e| e.into_inner());
            if graph.edge_count() == 0 && graph.file_hashes.is_empty() {
                drop(graph);
                let files = fs::walk_directory(&self.root).map_err(|e| e.to_string())?;
                let mut graph = self.graph.lock().unwrap_or_else(|e| e.into_inner());
                let changed = graph.update(&files);
                if changed > 0 {
                    let _ = graph.save(&self.root);
                    tracing::info!("Graph built: {} files parsed", changed);
                }
            }
        }

        Ok(())
    }

    /// Spawn background embedding task for the given paths.
    /// Designed to hold locks only during short bursts (per-batch),
    /// so search/status remain responsive during embedding.
    fn spawn_embedding(&self, paths: Vec<String>) {
        if paths.is_empty() {
            return;
        }

        let progress = self.embedding_progress.clone();

        // Cancel any running embedding
        progress.cancel.store(true, Ordering::Relaxed);
        std::thread::sleep(std::time::Duration::from_millis(50));

        progress.cancel.store(false, Ordering::Relaxed);
        progress.done.store(0, Ordering::Relaxed);
        progress.active.store(true, Ordering::Relaxed);

        let root = self.root.clone();
        let index = self.index.clone();
        let embedder = self.embedder.clone();

        tokio::task::spawn_blocking(move || {
            use crate::search::chunker;
            use crate::search::vecstore::{VecEntry, VecStore};
            use crate::search::embedder::EMBED_DIM;

            // Phase 1: Read files + chunk (NO locks needed)
            let mut file_chunks: Vec<(String, Vec<chunker::Chunk>)> = Vec::new();
            for path in &paths {
                let full_path = root.join(path);
                if let Ok(content) = std::fs::read_to_string(&full_path) {
                    let chunks = chunker::chunk_file(&content);
                    if !chunks.is_empty() {
                        file_chunks.push((path.clone(), chunks));
                    }
                }
            }

            let total_chunks: usize = file_chunks.iter().map(|(_, c)| c.len()).sum();
            progress.total.store(total_chunks, Ordering::Relaxed);
            tracing::info!("Embedding {} chunks from {} files...", total_chunks, file_chunks.len());

            // Phase 2: Embed in batches, locking embedder only per-batch
            let batch_size = 8;
            let mut all_vectors: Vec<(Vec<f32>, VecEntry)> = Vec::new();
            let mut batch_texts: Vec<String> = Vec::new();
            let mut batch_entries: Vec<VecEntry> = Vec::new();
            let mut embedded = 0usize;

            for (path, chunks) in &file_chunks {
                if progress.cancel.load(Ordering::Relaxed) {
                    break;
                }

                for (chunk_idx, chunk) in chunks.iter().enumerate() {
                    batch_texts.push(chunk.text.clone());
                    batch_entries.push(VecEntry {
                        path: path.clone(),
                        chunk_idx: chunk_idx as u32,
                        snippet_offset: chunk.offset,
                        snippet_len: chunk.len,
                    });

                    if batch_texts.len() >= batch_size {
                        // Lock embedder for just this batch
                        if let Ok(mut emb_guard) = embedder.lock() {
                            if let EmbedderState::Ready(ref mut emb) = &mut *emb_guard {
                                let text_refs: Vec<&str> = batch_texts.iter().map(|s| s.as_str()).collect();
                                match emb.embed_batch(&text_refs) {
                                    Ok(vectors) => {
                                        for (vec, entry) in vectors.into_iter().zip(batch_entries.drain(..)) {
                                            all_vectors.push((vec, entry));
                                        }
                                        embedded += batch_size;
                                        progress.done.store(embedded, Ordering::Relaxed);
                                    }
                                    Err(e) => {
                                        tracing::warn!("Embedding batch failed: {}", e);
                                    }
                                }
                            }
                        }
                        // Lock released here — search/status can proceed
                        batch_texts.clear();
                        // Yield to let other threads grab the lock
                        std::thread::yield_now();
                    }
                }
            }

            // Flush remaining
            if !batch_texts.is_empty() && !progress.cancel.load(Ordering::Relaxed) {
                let remaining = batch_texts.len();
                if let Ok(mut emb_guard) = embedder.lock() {
                    if let EmbedderState::Ready(ref mut emb) = &mut *emb_guard {
                        let text_refs: Vec<&str> = batch_texts.iter().map(|s| s.as_str()).collect();
                        match emb.embed_batch(&text_refs) {
                            Ok(vectors) => {
                                for (vec, entry) in vectors.into_iter().zip(batch_entries.drain(..)) {
                                    all_vectors.push((vec, entry));
                                }
                                embedded += remaining;
                                progress.done.store(embedded, Ordering::Relaxed);
                            }
                            Err(e) => {
                                tracing::warn!("Embedding final batch failed: {}", e);
                            }
                        }
                    }
                }
            }

            // Phase 3: Save to vec_store (lock index briefly)
            if !all_vectors.is_empty() {
                if let Ok(mut idx_guard) = index.lock() {
                    if let Some(ref mut idx) = *idx_guard {
                        let vec_dir = root.join(".kairo").join("vectors");
                        let vec_store = idx.get_or_create_vec_store(vec_dir);

                        // Remove old vectors for updated paths
                        for path in &paths {
                            vec_store.remove_path(path);
                        }

                        for (vec, entry) in all_vectors {
                            vec_store.push(vec, entry);
                        }

                        if let Err(e) = vec_store.save() {
                            tracing::warn!("Failed to save vector store: {}", e);
                        } else {
                            tracing::info!("Background embedding complete: {} vectors saved", embedded);
                        }
                    }
                }
            }

            progress.active.store(false, Ordering::Relaxed);
        });
    }
}

#[tool_router]
impl KairoServer {
    #[tool(
        name = "kairo_search",
        description = "Semantic search across the project codebase and documents. Finds conceptually related code even when exact keywords don't match. Powered by Tantivy full-text index. Use native Grep for exact keyword/regex; use kairo_search for concept queries like \"find code that handles authentication\" or \"where is retry logic\"."
    )]
    fn search(&self, Parameters(params): Parameters<SearchParams>) -> Result<String, String> {
        self.ensure_index()?;

        let guard = self.index.lock().unwrap_or_else(|e| e.into_inner());
        let index = guard.as_ref().unwrap();
        let scope = params.scope.as_deref().unwrap_or("code");
        let limit = params.limit.unwrap_or(10);

        // Try to get embedder for hybrid search (non-blocking — skip if busy embedding)
        let mut emb_guard = self.embedder.try_lock().ok();
        let embedder_opt = emb_guard.as_mut().and_then(|g| match &mut **g {
            EmbedderState::Ready(e) => Some(e),
            _ => None,
        });

        let results = index
            .search(&params.query, scope, limit, embedder_opt)
            .map_err(|e| e.to_string())?;

        if results.is_empty() {
            return Ok(
                "No results found. Try broader terms or check if the index is up to date."
                    .to_string(),
            );
        }

        let has_vectors = index.vector_count() > 0;
        let mode = if has_vectors { "hybrid (BM25 + vector)" } else { "BM25 only" };

        let mut output = format!("_Search mode: {}_\n\n", mode);
        for (i, result) in results.iter().enumerate() {
            output.push_str(&format!(
                "### {} (score: {:.2})\n`{}`\n```\n{}\n```\n\n",
                i + 1,
                result.score,
                result.path,
                result.snippet,
            ));
        }

        // Freshness indicator
        if let Some(ref ws) = self.watcher_state {
            let pending = ws.pending_count.load(Ordering::Relaxed);
            if pending > 0 {
                output.push_str("_Indexing recent changes..._\n");
            }
        }

        Ok(output)
    }

    #[tool(
        name = "kairo_status",
        description = "Check Kairo index health and trigger reindexing. Shows search index status and file count. Use when search results seem stale. Use action=reindex to rebuild the index."
    )]
    fn status(&self, Parameters(params): Parameters<StatusParams>) -> Result<String, String> {
        let action = params.action.as_deref().unwrap_or("check");

        match action {
            "download-model" => {
                // Spawn a new thread with its own runtime to avoid nested block_on deadlock
                let download_result = std::thread::spawn(|| {
                    tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build()
                        .map_err(|e| anyhow::anyhow!("build runtime: {}", e))
                        .and_then(|rt| rt.block_on(embedder::download_model()))
                })
                .join()
                .map_err(|_| "download thread panicked".to_string())
                .and_then(|r| r.map_err(|e| e.to_string()));

                match download_result {
                    Ok(model_dir) => {
                        match embedder::try_load_embedder() {
                            Ok(state) => {
                                let mut emb_guard = self.embedder.lock().unwrap_or_else(|e| e.into_inner());
                                let ready = matches!(&state, EmbedderState::Ready(_));
                                *emb_guard = state;
                                if ready {
                                    Ok(format!(
                                        "Model downloaded to {} and loaded successfully.\n\
                                         Run `kairo_status action=reindex` to build vector embeddings.",
                                        model_dir.display()
                                    ))
                                } else {
                                    Ok(format!(
                                        "Model downloaded to {} but failed to load.",
                                        model_dir.display()
                                    ))
                                }
                            }
                            Err(e) => Err(format!("Model downloaded but load failed: {}", e)),
                        }
                    }
                    Err(e) => Err(format!("Model download failed: {}", e)),
                }
            }
            "reindex" => {
                // Walk files once, share with both index and graph
                let files = fs::walk_directory(&self.root).map_err(|e| e.to_string())?;

                // Phase 1: BM25 indexing (fast, synchronous)
                let mut guard = self.index.lock().unwrap_or_else(|e| e.into_inner());

                let result = if let Some(index) = guard.as_mut() {
                    index.build_index_from(&files).map_err(|e| e.to_string())?
                } else {
                    let mut idx = SearchIndex::open(&self.root).map_err(|e| e.to_string())?;
                    let result = idx.build_index_from(&files).map_err(|e| e.to_string())?;
                    *guard = Some(idx);
                    result
                };

                // Phase 1b: Graph update (fast, synchronous)
                {
                    let mut graph = self.graph.lock().unwrap_or_else(|e| e.into_inner());
                    let graph_changed = graph.update(&files);
                    if graph_changed > 0 {
                        let _ = graph.save(&self.root);
                        tracing::info!("Graph updated: {} files re-parsed", graph_changed);
                    }
                }

                let vec_count = guard.as_ref().map_or(0, |i| i.vector_count());

                // If vectors are empty, embed ALL files (not just changed ones)
                let paths = if vec_count == 0 {
                    guard.as_ref()
                        .map(|idx| idx.file_hashes_keys())
                        .unwrap_or_default()
                } else {
                    result.needs_embedding.clone()
                };
                let needs_embed = paths.len();

                // Release lock before spawning background task
                drop(guard);

                // Phase 2: Embeddings in background (slow, async)
                let emb_guard = self.embedder.lock().unwrap_or_else(|e| e.into_inner());
                let has_embedder = matches!(&*emb_guard, EmbedderState::Ready(_));
                drop(emb_guard);

                if has_embedder && !paths.is_empty() {
                    self.spawn_embedding(paths);
                    Ok(format!(
                        "BM25 index updated: {} files ({} added, {} updated, {} deleted).\n\
                         Existing vectors: {}.\n\
                         Background: embedding {} files — check progress with `kairo_status`.",
                        result.total_files, result.added, result.updated, result.deleted,
                        vec_count, needs_embed
                    ))
                } else if has_embedder && vec_count > 0 {
                    Ok(format!(
                        "Index up to date: {} files, {} vectors. No changes detected.",
                        result.total_files, vec_count
                    ))
                } else {
                    Ok(format!(
                        "BM25 index updated: {} files ({} added, {} updated, {} deleted).\n\
                         No embedding model loaded — run `kairo_status action=download-model` for hybrid search.",
                        result.total_files, result.added, result.updated, result.deleted
                    ))
                }
            }
            _ => {
                // Status check — use try_lock to avoid blocking during embedding
                self.ensure_index()?;
                let guard = self.index.lock().unwrap_or_else(|e| e.into_inner());

                // Don't block on embedder lock — use try_lock
                let model_status = match self.embedder.try_lock() {
                    Ok(emb_guard) => match &*emb_guard {
                        EmbedderState::Ready(_) => "loaded",
                        EmbedderState::Unavailable => "not installed (run action=download-model)",
                    },
                    Err(_) => "loaded (busy embedding)",
                };

                let embedding_status = if self.embedding_progress.active.load(Ordering::Relaxed) {
                    let done = self.embedding_progress.done.load(Ordering::Relaxed);
                    let total = self.embedding_progress.total.load(Ordering::Relaxed);
                    format!("in progress ({}/~{})", done, total)
                } else {
                    "idle".to_string()
                };

                if let Some(index) = guard.as_ref() {
                    let (doc_count, segment_count) = index.stats();
                    let vec_count = index.vector_count();

                    let graph_guard = self.graph.lock().unwrap_or_else(|e| e.into_inner());
                    let graph_nodes = graph_guard.node_count();
                    let graph_edges = graph_guard.edge_count();
                    drop(graph_guard);

                    let watcher_status = match &self.watcher_state {
                        Some(ws) if ws.active.load(Ordering::Relaxed) => {
                            let pending = ws.pending_count.load(Ordering::Relaxed);
                            if pending > 0 {
                                format!("active ({} pending)", pending)
                            } else {
                                "active".to_string()
                            }
                        }
                        Some(_) => "inactive".to_string(),
                        None => "not configured".to_string(),
                    };

                    Ok(format!(
                        "Kairo Index Status:\n\
                         - Documents: {}\n\
                         - Segments: {}\n\
                         - Vectors: {}\n\
                         - Graph: {} nodes, {} edges\n\
                         - Embedding model: {}\n\
                         - Embedding task: {}\n\
                         - File watcher: {}\n\
                         - Root: {}",
                        doc_count, segment_count, vec_count,
                        graph_nodes, graph_edges,
                        model_status, embedding_status, watcher_status,
                        self.root.display()
                    ))
                } else {
                    Ok(format!(
                        "Kairo Index Status:\n\
                         - Index: not yet initialized\n\
                         - Embedding model: {}\n\
                         - Root: {}",
                        model_status, self.root.display()
                    ))
                }
            }
        }
    }

    #[tool(
        name = "kairo_graph",
        description = "Query the project dependency graph. Shows import relationships between files. Use 'deps' to see what a file imports, 'dependents' to see who imports it, 'cycles' to find circular dependencies, 'path' to find how two files are connected, 'impact' to find all files transitively affected by a change."
    )]
    fn graph(&self, Parameters(params): Parameters<GraphParams>) -> Result<String, String> {
        self.ensure_index()?;
        let graph = self.graph.lock().unwrap_or_else(|e| e.into_inner());

        match params.operation.as_str() {
            "deps" => {
                let file = params.file.as_deref()
                    .ok_or("'file' parameter required for 'deps' operation")?;
                let deps = graph.deps(file);
                if deps.is_empty() {
                    Ok(format!("`{}` has no internal dependencies.", file))
                } else {
                    let mut out = format!("Dependencies of `{}`:\n", file);
                    for dep in &deps {
                        out.push_str(&format!("  → `{}`\n", dep));
                    }
                    out.push_str(&format!("\n({} internal dependencies)", deps.len()));
                    Ok(out)
                }
            }
            "dependents" => {
                let file = params.file.as_deref()
                    .ok_or("'file' parameter required for 'dependents' operation")?;
                let deps = graph.dependents(file);
                if deps.is_empty() {
                    Ok(format!("No files depend on `{}`.", file))
                } else {
                    let mut out = format!("Dependents of `{}`:\n", file);
                    for dep in &deps {
                        out.push_str(&format!("  ← `{}`\n", dep));
                    }
                    out.push_str(&format!("\n({} files depend on this)", deps.len()));
                    Ok(out)
                }
            }
            "cycles" => {
                let cycles = graph.cycles();
                if cycles.is_empty() {
                    Ok("No circular dependencies detected.".to_string())
                } else {
                    let mut out = format!("{} circular dependency chain(s) found:\n\n", cycles.len());
                    for (i, cycle) in cycles.iter().enumerate() {
                        out.push_str(&format!("Cycle {}:\n  ", i + 1));
                        let chain: Vec<String> = cycle.iter().map(|s| format!("`{}`", s)).collect();
                        out.push_str(&chain.join(" → "));
                        out.push_str(&format!(" → `{}`\n", cycle[0])); // close the loop
                    }
                    Ok(out)
                }
            }
            "path" => {
                let from = params.file.as_deref()
                    .ok_or("'file' parameter required for 'path' operation")?;
                let to = params.target.as_deref()
                    .ok_or("'target' parameter required for 'path' operation")?;
                match graph.path_between(from, to) {
                    Some(path) => {
                        let chain: Vec<String> = path.iter().map(|s| format!("`{}`", s)).collect();
                        Ok(format!(
                            "Dependency path ({} hops):\n  {}",
                            path.len() - 1,
                            chain.join(" → ")
                        ))
                    }
                    None => Ok(format!(
                        "No dependency path from `{}` to `{}`.",
                        from, to
                    )),
                }
            }
            "impact" => {
                let file = params.file.as_deref()
                    .ok_or("'file' parameter required for 'impact' operation")?;
                let result = graph.impact(file);
                if result.total == 0 {
                    Ok(format!("No files are affected by changes to `{}`.", file))
                } else {
                    let mut out = format!("Impact analysis for `{}`:\n\n", file);
                    for (i, layer) in result.layers.iter().enumerate() {
                        let label = if i == 0 { "direct" } else { "indirect" };
                        out.push_str(&format!("Depth {} ({}):\n", i + 1, label));
                        for dep in layer {
                            out.push_str(&format!("  ← `{}`\n", dep));
                        }
                        out.push('\n');
                    }
                    out.push_str(&format!(
                        "Total: {} files affected ({} direct, {} indirect)",
                        result.total, result.direct, result.total - result.direct
                    ));
                    Ok(out)
                }
            }
            other => Err(format!(
                "Unknown operation '{}'. Use: deps, dependents, cycles, path, impact",
                other
            )),
        }
    }
}

impl ServerHandler for KairoServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            instructions: Some(
                "Kairo provides semantic code intelligence. Use kairo_search for concept-based \
                 code search (when Grep isn't enough). Use kairo_status to check index health."
                    .into(),
            ),
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            ..Default::default()
        }
    }
}

/// Start the MCP server on stdio with the given project root
pub async fn serve_stdio_with_root(root: PathBuf) -> Result<()> {
    tracing::info!("Starting Kairo MCP server for {}", root.display());

    let mut server = KairoServer::new(root.clone());

    // Start file watcher
    let watcher = FileWatcher::new(
        root.clone(),
        server.index.clone(),
        server.graph.clone(),
    );
    server.watcher_state = Some(WatcherState {
        active: watcher.active.clone(),
        last_update: watcher.last_update.clone(),
        pending_count: watcher.pending_count.clone(),
    });
    watcher.start();

    // Try to load embedding model in background
    let emb_clone = server.embedder.clone();
    tokio::task::spawn_blocking(move || {
        match embedder::try_load_embedder() {
            Ok(state) => {
                if let Ok(mut guard) = emb_clone.lock() {
                    let is_ready = matches!(&state, EmbedderState::Ready(_));
                    *guard = state;
                    if is_ready {
                        tracing::info!("Embedding model loaded successfully.");
                    }
                }
            }
            Err(e) => {
                tracing::warn!("Failed to load embedding model: {}", e);
            }
        }
    });

    let mut router = Router::new(server);
    router.tool_router = KairoServer::tool_router();
    let transport = stdio();

    let service = rmcp::serve_server(router, transport).await?;
    service.waiting().await?;

    Ok(())
}
