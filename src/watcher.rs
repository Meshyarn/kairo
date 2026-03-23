use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;

use crate::common::fs::{self, SourceFile};
use crate::graph::ProjectGraph;
use crate::search::SearchIndex;

/// File watcher that keeps the search index and dependency graph up to date.
/// Runs in the background, debounces filesystem events, and processes changes incrementally.
pub struct FileWatcher {
    root: PathBuf,
    index: Arc<Mutex<Option<SearchIndex>>>,
    graph: Arc<Mutex<ProjectGraph>>,
    /// Called with paths of files that need re-embedding after a change.
    /// Allows the MCP layer to trigger background embedding without the watcher
    /// needing to know about the embedder directly.
    re_embed: Arc<dyn Fn(Vec<String>) + Send + Sync>,
    /// Epoch millis of last successful index update
    pub last_update: Arc<AtomicU64>,
    /// Number of pending changes not yet processed
    pub pending_count: Arc<AtomicU64>,
    /// Whether the watcher is actively running
    pub active: Arc<AtomicBool>,
}

impl FileWatcher {
    pub fn new(
        root: PathBuf,
        index: Arc<Mutex<Option<SearchIndex>>>,
        graph: Arc<Mutex<ProjectGraph>>,
        re_embed: Arc<dyn Fn(Vec<String>) + Send + Sync>,
    ) -> Self {
        Self {
            root,
            index,
            graph,
            re_embed,
            last_update: Arc::new(AtomicU64::new(0)),
            pending_count: Arc::new(AtomicU64::new(0)),
            active: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Start watching in a background tokio task.
    /// Returns immediately — the watcher runs until the process exits.
    pub fn start(&self) {
        let root = self.root.clone();
        let index = self.index.clone();
        let graph = self.graph.clone();
        let re_embed = self.re_embed.clone();
        let last_update = self.last_update.clone();
        let pending_count = self.pending_count.clone();
        let active = self.active.clone();

        tokio::spawn(async move {
            if let Err(e) = run_watcher(root, index, graph, re_embed, last_update, pending_count, active).await {
                tracing::error!("File watcher stopped: {}", e);
            }
        });
    }
}

async fn run_watcher(
    root: PathBuf,
    index: Arc<Mutex<Option<SearchIndex>>>,
    graph: Arc<Mutex<ProjectGraph>>,
    re_embed: Arc<dyn Fn(Vec<String>) + Send + Sync>,
    last_update: Arc<AtomicU64>,
    pending_count: Arc<AtomicU64>,
    active: Arc<AtomicBool>,
) -> anyhow::Result<()> {
    let (tx, mut rx) = mpsc::channel::<PathBuf>(1024);

    // Create filesystem watcher
    let tx_clone = tx.clone();
    let root_clone = root.clone();
    let _watcher = {
        let mut watcher = RecommendedWatcher::new(
            move |res: Result<notify::Event, notify::Error>| {
                if let Ok(event) = res {
                    match event.kind {
                        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) => {
                            for path in event.paths {
                                // Convert to relative path
                                if let Ok(rel) = path.strip_prefix(&root_clone) {
                                    let rel_str = rel.to_string_lossy().to_string();
                                    // Filter: skip hidden, skip dirs, check extension
                                    if !fs::should_skip_path(&rel_str) {
                                        let _ = tx_clone.try_send(path);
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
            },
            Config::default(),
        )?;

        watcher.watch(root.as_ref(), RecursiveMode::Recursive)?;
        active.store(true, Ordering::Relaxed);
        tracing::info!("File watcher active for {}", root.display());

        watcher // must keep alive
    };

    // Debounce + batch processing loop
    let debounce_ms = 150;
    let mut pending: HashSet<PathBuf> = HashSet::new();

    loop {
        // Wait for first event or timeout
        let maybe_path = if pending.is_empty() {
            // No pending events — block until next event
            rx.recv().await
        } else {
            // Have pending events — use timeout for debounce
            tokio::select! {
                path = rx.recv() => path,
                _ = tokio::time::sleep(Duration::from_millis(debounce_ms)) => None,
            }
        };

        match maybe_path {
            Some(path) => {
                pending.insert(path);
                pending_count.store(pending.len() as u64, Ordering::Relaxed);
                // Continue collecting events (debounce window)
                continue;
            }
            None if !pending.is_empty() => {
                // Timeout expired or channel closed — flush batch
                let batch: Vec<PathBuf> = pending.drain().collect();
                pending_count.store(0, Ordering::Relaxed);

                process_batch(&root, &batch, &index, &graph, &re_embed).await;

                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;
                last_update.store(now, Ordering::Relaxed);
            }
            None if pending.is_empty() => {
                // Channel closed — watcher shutting down
                break;
            }
            _ => {}
        }
    }

    active.store(false, Ordering::Relaxed);
    Ok(())
}

async fn process_batch(
    root: &Path,
    paths: &[PathBuf],
    index: &Arc<Mutex<Option<SearchIndex>>>,
    graph: &Arc<Mutex<ProjectGraph>>,
    re_embed: &Arc<dyn Fn(Vec<String>) + Send + Sync>,
) {
    let mut updated_files: Vec<SourceFile> = Vec::new();
    let mut deleted_paths: Vec<String> = Vec::new();

    for path in paths {
        let rel = match path.strip_prefix(root) {
            Ok(r) => r.to_string_lossy().to_string(),
            Err(_) => continue,
        };

        if path.exists() {
            // File created or modified
            if let Some(file) = fs::read_source_file(root, &rel) {
                updated_files.push(file);
            }
        } else {
            // File deleted
            deleted_paths.push(rel);
        }
    }

    let changes = updated_files.len() + deleted_paths.len();
    if changes == 0 {
        return;
    }

    // Update search index; collect paths that actually changed content for re-embedding
    let mut re_embed_paths: Vec<String> = Vec::new();
    if let Ok(mut idx_guard) = index.lock() {
        if let Some(ref mut idx) = *idx_guard {
            for path in &deleted_paths {
                if let Err(e) = idx.remove_file(path) {
                    tracing::warn!("Watcher: failed to remove {} from index: {}", path, e);
                }
            }
            for file in &updated_files {
                match idx.update_file(file) {
                    Ok(true) => re_embed_paths.push(file.relative_path.clone()),
                    Ok(false) => {} // content unchanged, skip
                    Err(e) => tracing::warn!("Watcher: failed to update {} in index: {}", file.relative_path, e),
                }
            }
        }
    }

    // Update graph
    if let Ok(mut graph_guard) = graph.lock() {
        let known_files: HashSet<String> = graph_guard
            .file_hashes
            .keys()
            .cloned()
            .collect();

        for path in &deleted_paths {
            graph_guard.remove_file(path);
        }
        graph_guard.update_batch(&updated_files, &known_files);

        if let Err(e) = graph_guard.save(root) {
            tracing::warn!("Watcher: failed to save graph: {}", e);
        }
    }

    // Re-embed files whose content actually changed
    if !re_embed_paths.is_empty() {
        tracing::info!("Watcher: re-embedding {} changed file(s)", re_embed_paths.len());
        re_embed(re_embed_paths);
    }

    tracing::info!(
        "Watcher: processed {} change(s) ({} updated, {} deleted)",
        changes,
        updated_files.len(),
        deleted_paths.len()
    );
}
