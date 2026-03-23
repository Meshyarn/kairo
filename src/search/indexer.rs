use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use tantivy::collector::TopDocs;
use tantivy::query::{BooleanQuery, Occur, QueryParser};
use tantivy::schema::*;
use tantivy::{doc, Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument};

use crate::common::fs::{self, SourceFile};
use crate::search::chunker;
use crate::search::embedder::{Embedder, EMBED_DIM};
use crate::search::query::SearchResult;
use crate::search::tokenizer;
use crate::search::vecstore::{VecEntry, VecStore};

/// The core search index backed by Tantivy + optional vector store
pub struct SearchIndex {
    index: Index,
    reader: IndexReader,
    schema: SearchSchema,
    root: PathBuf,
    vec_store: Option<VecStore>,
    /// Persisted file hashes for incremental indexing
    file_hashes: HashMap<String, u64>,
}

impl std::fmt::Debug for SearchIndex {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SearchIndex")
            .field("root", &self.root)
            .finish()
    }
}

/// Schema field handles for quick access
#[derive(Clone)]
struct SearchSchema {
    path: Field,
    basename: Field,
    content: Field,
    symbols: Field,
    kind: Field,
    extension: Field,
}

/// Result of a build operation
pub struct BuildResult {
    pub total_files: usize,
    pub added: usize,
    pub updated: usize,
    pub deleted: usize,
    /// Paths that need (re-)embedding
    pub needs_embedding: Vec<String>,
}

impl SearchIndex {
    /// Create or open an index for the given project root
    pub fn open(root: &Path) -> Result<Self> {
        let index_dir = root.join(".kairo").join("index");
        std::fs::create_dir_all(&index_dir)
            .context("Failed to create .kairo/index directory")?;

        let schema = build_schema();
        let dir = tantivy::directory::MmapDirectory::open(&index_dir)
            .context("Failed to open index directory")?;

        let index = Index::open_or_create(dir, schema.schema.clone())
            .context("Failed to open or create index")?;

        tokenizer::register_tokenizers(&index);

        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()
            .context("Failed to create index reader")?;

        // Load existing vector store
        let vec_dir = root.join(".kairo").join("vectors");
        let vec_store = VecStore::load(&vec_dir, EMBED_DIM)
            .unwrap_or_else(|e| {
                tracing::warn!("Failed to load vector store: {}", e);
                None
            });

        // Load persisted file hashes
        let file_hashes = load_hashes(root);

        Ok(Self {
            index,
            reader,
            schema: schema.fields,
            root: root.to_path_buf(),
            vec_store,
            file_hashes,
        })
    }

    /// Incremental BM25 index build. Fast — only processes changed files.
    /// Returns which files need embedding.
    pub fn build_index(&mut self) -> Result<BuildResult> {
        let files = fs::walk_directory(&self.root)?;
        self.build_index_from(&files)
    }

    /// Incremental BM25 index build from pre-walked files.
    pub fn build_index_from(&mut self, files: &[SourceFile]) -> Result<BuildResult> {
        let total_files = files.len();

        // Build a map of current files
        let current: HashMap<String, &SourceFile> = files
            .iter()
            .map(|f| (f.relative_path.clone(), f))
            .collect();

        // Detect changes
        let mut added_paths = Vec::new();
        let mut updated_paths = Vec::new();
        let mut deleted_paths = Vec::new();

        // Find added/updated files
        for (path, file) in &current {
            match self.file_hashes.get(path) {
                None => added_paths.push(path.clone()),
                Some(&old_hash) if old_hash != file.content_hash => {
                    updated_paths.push(path.clone());
                }
                _ => {} // unchanged
            }
        }

        // Find deleted files
        for path in self.file_hashes.keys() {
            if !current.contains_key(path) {
                deleted_paths.push(path.clone());
            }
        }

        let changed = !added_paths.is_empty() || !updated_paths.is_empty() || !deleted_paths.is_empty();

        if !changed && !self.is_empty() {
            tracing::info!("Index up to date ({} files, no changes)", total_files);
            return Ok(BuildResult {
                total_files,
                added: 0,
                updated: 0,
                deleted: 0,
                needs_embedding: Vec::new(),
            });
        }

        // If first build (empty index), do full index
        if self.is_empty() {
            return self.full_build(&files);
        }

        // Incremental update
        let mut writer: IndexWriter = self
            .index
            .writer(50_000_000)
            .context("Failed to create index writer")?;

        // Delete changed/removed docs
        for path in deleted_paths.iter().chain(updated_paths.iter()) {
            writer.delete_term(tantivy::Term::from_field_text(self.schema.path, path));
        }

        // Add new/updated docs
        let paths_to_add: Vec<&str> = added_paths.iter().chain(updated_paths.iter())
            .map(|s| s.as_str())
            .collect();

        for path in &paths_to_add {
            if let Some(file) = current.get(*path) {
                let kind = if file.is_code { "code" } else { "docs" };
                let basename = file
                    .path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("");
                let symbols = extract_symbols(&file.content);

                writer.add_document(doc!(
                    self.schema.path => file.relative_path.as_str(),
                    self.schema.basename => basename,
                    self.schema.content => file.content.as_str(),
                    self.schema.symbols => symbols.as_str(),
                    self.schema.kind => kind,
                    self.schema.extension => file.extension.as_str(),
                ))?;
            }
        }

        writer.commit().context("Failed to commit index")?;
        self.reader.reload()?;

        // Update hashes
        for path in &deleted_paths {
            self.file_hashes.remove(path);
        }
        for (path, file) in &current {
            self.file_hashes.insert(path.clone(), file.content_hash);
        }
        save_hashes(&self.root, &self.file_hashes);

        // Remove deleted paths from vec_store
        if let Some(ref mut vs) = self.vec_store {
            for path in &deleted_paths {
                vs.remove_path(path);
            }
        }

        let needs_embedding: Vec<String> = added_paths.iter()
            .chain(updated_paths.iter())
            .cloned()
            .collect();

        tracing::info!(
            "Incremental update: {} added, {} updated, {} deleted (of {} total)",
            added_paths.len(), updated_paths.len(), deleted_paths.len(), total_files
        );

        Ok(BuildResult {
            total_files,
            added: added_paths.len(),
            updated: updated_paths.len(),
            deleted: deleted_paths.len(),
            needs_embedding,
        })
    }

    /// Full BM25 rebuild (used on first run)
    fn full_build(&mut self, files: &[SourceFile]) -> Result<BuildResult> {
        let count = files.len();
        tracing::info!("Full index build: {} files from {}", count, self.root.display());

        let mut writer: IndexWriter = self
            .index
            .writer(50_000_000)
            .context("Failed to create index writer")?;

        writer.delete_all_documents()?;

        let mut needs_embedding = Vec::new();

        for file in files {
            let kind = if file.is_code { "code" } else { "docs" };
            let basename = file
                .path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");
            let symbols = extract_symbols(&file.content);

            writer.add_document(doc!(
                self.schema.path => file.relative_path.as_str(),
                self.schema.basename => basename,
                self.schema.content => file.content.as_str(),
                self.schema.symbols => symbols.as_str(),
                self.schema.kind => kind,
                self.schema.extension => file.extension.as_str(),
            ))?;

            needs_embedding.push(file.relative_path.clone());
            self.file_hashes.insert(file.relative_path.clone(), file.content_hash);
        }

        writer.commit().context("Failed to commit index")?;
        self.reader.reload()?;
        save_hashes(&self.root, &self.file_hashes);

        tracing::info!("Full BM25 indexing complete: {} files", count);

        Ok(BuildResult {
            total_files: count,
            added: count,
            updated: 0,
            deleted: 0,
            needs_embedding,
        })
    }

    /// Build vector embeddings for specified paths.
    /// This is the slow operation — designed to run in a background thread.
    pub fn build_embeddings(
        &mut self,
        embedder: &mut Embedder,
        paths: &[String],
        progress: &Arc<AtomicUsize>,
        cancel: &Arc<AtomicBool>,
    ) -> Result<usize> {
        if paths.is_empty() {
            return Ok(0);
        }

        let vec_dir = self.root.join(".kairo").join("vectors");

        // Get or create vec_store
        let vec_store = self.vec_store.get_or_insert_with(|| VecStore::new(vec_dir.clone(), EMBED_DIM));

        // Remove old vectors for paths we're about to re-embed
        for path in paths {
            vec_store.remove_path(path);
        }

        // Read files and chunk them
        let mut file_chunks: Vec<(String, Vec<chunker::Chunk>)> = Vec::new();
        for path in paths {
            let full_path = self.root.join(path);
            if let Ok(content) = std::fs::read_to_string(&full_path) {
                let chunks = chunker::chunk_file(&content);
                if !chunks.is_empty() {
                    file_chunks.push((path.clone(), chunks));
                }
            }
        }

        let total_chunks: usize = file_chunks.iter().map(|(_, c)| c.len()).sum();
        tracing::info!("Embedding {} chunks from {} files...", total_chunks, file_chunks.len());

        let batch_size = 8;
        let mut batch_texts: Vec<String> = Vec::new();
        let mut batch_entries: Vec<VecEntry> = Vec::new();
        let mut embedded = 0usize;

        for (path, chunks) in &file_chunks {
            if cancel.load(Ordering::Relaxed) {
                tracing::info!("Embedding cancelled at {}/{}", embedded, total_chunks);
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
                    let text_refs: Vec<&str> = batch_texts.iter().map(|s| s.as_str()).collect();
                    match embedder.embed_batch(&text_refs) {
                        Ok(vectors) => {
                            for (vec, entry) in vectors.into_iter().zip(batch_entries.drain(..)) {
                                vec_store.push(vec, entry);
                            }
                            embedded += batch_size;
                            progress.store(embedded, Ordering::Relaxed);
                        }
                        Err(e) => {
                            tracing::warn!("Embedding batch failed: {}. Skipping.", e);
                        }
                    }
                    batch_texts.clear();
                }
            }
        }

        // Flush remaining batch
        if !batch_texts.is_empty() && !cancel.load(Ordering::Relaxed) {
            let remaining = batch_texts.len();
            let text_refs: Vec<&str> = batch_texts.iter().map(|s| s.as_str()).collect();
            match embedder.embed_batch(&text_refs) {
                Ok(vectors) => {
                    for (vec, entry) in vectors.into_iter().zip(batch_entries.drain(..)) {
                        vec_store.push(vec, entry);
                    }
                    embedded += remaining;
                    progress.store(embedded, Ordering::Relaxed);
                }
                Err(e) => {
                    tracing::warn!("Embedding final batch failed: {}", e);
                }
            }
        }

        tracing::info!("Embedding complete: {} vectors total", vec_store.len());
        vec_store.save().context("Failed to save vector store")?;

        Ok(embedded)
    }

    /// Check if the index has any documents
    pub fn is_empty(&self) -> bool {
        let searcher = self.reader.searcher();
        searcher.num_docs() == 0
    }

    /// Search the index with a natural language query.
    /// Uses hybrid BM25 + vector RRF when embeddings are available.
    pub fn search(
        &self,
        query_str: &str,
        scope: &str,
        limit: usize,
        embedder: Option<&mut Embedder>,
    ) -> Result<Vec<SearchResult>> {
        let fetch_limit = limit * 3;

        // --- BM25 search ---
        let bm25_results = self.bm25_search(query_str, scope, fetch_limit)?;

        // --- Vector search (if available) ---
        let vec_results = if let (Some(vec_store), Some(embedder)) = (&self.vec_store, embedder) {
            if vec_store.is_empty() {
                HashMap::new()
            } else {
                match embedder.embed(query_str) {
                    Ok(query_vec) => {
                        let hits = vec_store.search_cosine(&query_vec, fetch_limit);
                        let mut best_per_file: HashMap<String, (f32, String)> = HashMap::new();
                        for (idx, cosine_score) in hits {
                            if let Some(entry) = vec_store.entry(idx) {
                                let existing = best_per_file.get(&entry.path);
                                if existing.map_or(true, |(s, _)| cosine_score > *s) {
                                    let snippet = read_chunk_snippet(
                                        &self.root,
                                        &entry.path,
                                        entry.snippet_offset,
                                        entry.snippet_len,
                                    );
                                    best_per_file.insert(
                                        entry.path.clone(),
                                        (cosine_score, snippet),
                                    );
                                }
                            }
                        }
                        best_per_file
                    }
                    Err(e) => {
                        tracing::warn!("Query embedding failed: {}. Using BM25 only.", e);
                        HashMap::new()
                    }
                }
            }
        } else {
            HashMap::new()
        };

        // --- RRF fusion ---
        if vec_results.is_empty() {
            let mut results = bm25_results;
            results.truncate(limit);
            return Ok(results);
        }

        const RRF_K: f32 = 60.0;
        let mut rrf_scores: HashMap<String, (f32, String)> = HashMap::new();

        for (rank, result) in bm25_results.iter().enumerate() {
            let rrf_score = 1.0 / (RRF_K + rank as f32 + 1.0);
            let entry = rrf_scores
                .entry(result.path.clone())
                .or_insert((0.0, result.snippet.clone()));
            entry.0 += rrf_score;
        }

        let mut vec_ranked: Vec<_> = vec_results.iter().collect();
        vec_ranked.sort_by(|a, b| b.1 .0.partial_cmp(&a.1 .0).unwrap_or(std::cmp::Ordering::Equal));
        for (rank, (path, (_, snippet))) in vec_ranked.iter().enumerate() {
            let rrf_score = 1.0 / (RRF_K + rank as f32 + 1.0);
            let entry = rrf_scores
                .entry(path.to_string())
                .or_insert((0.0, snippet.clone()));
            entry.0 += rrf_score;
            if !bm25_results.iter().any(|r| &r.path == *path) {
                entry.1 = snippet.clone();
            }
        }

        let mut fused: Vec<_> = rrf_scores.into_iter().collect();
        fused.sort_by(|a, b| b.1 .0.partial_cmp(&a.1 .0).unwrap_or(std::cmp::Ordering::Equal));
        fused.truncate(limit);

        Ok(fused
            .into_iter()
            .map(|(path, (score, snippet))| SearchResult {
                path,
                score,
                snippet,
            })
            .collect())
    }

    /// Pure BM25 search (internal)
    fn bm25_search(
        &self,
        query_str: &str,
        scope: &str,
        limit: usize,
    ) -> Result<Vec<SearchResult>> {
        let searcher = self.reader.searcher();
        let intent = detect_intent(query_str);

        let (symbol_boost, basename_boost, content_boost) = match intent {
            QueryIntent::Symbol => (12.0, 4.0, 1.0),
            QueryIntent::Path => (4.0, 9.0, 1.0),
            QueryIntent::General => (8.0, 6.0, 1.0),
        };

        let mut query_parser = QueryParser::for_index(
            &self.index,
            vec![self.schema.content, self.schema.symbols, self.schema.basename],
        );
        query_parser.set_field_boost(self.schema.symbols, symbol_boost);
        query_parser.set_field_boost(self.schema.basename, basename_boost);
        query_parser.set_field_boost(self.schema.content, content_boost);

        let text_query = query_parser
            .parse_query(query_str)
            .context("Failed to parse query")?;

        let final_query = match scope {
            "code" => {
                let kind_query = tantivy::query::TermQuery::new(
                    tantivy::Term::from_field_text(self.schema.kind, "code"),
                    IndexRecordOption::Basic,
                );
                BooleanQuery::new(vec![
                    (Occur::Must, Box::new(text_query)),
                    (Occur::Must, Box::new(kind_query)),
                ])
            }
            "docs" => {
                let kind_query = tantivy::query::TermQuery::new(
                    tantivy::Term::from_field_text(self.schema.kind, "docs"),
                    IndexRecordOption::Basic,
                );
                BooleanQuery::new(vec![
                    (Occur::Must, Box::new(text_query)),
                    (Occur::Must, Box::new(kind_query)),
                ])
            }
            _ => BooleanQuery::new(vec![(Occur::Must, Box::new(text_query))]),
        };

        let top_docs = searcher
            .search(&final_query, &TopDocs::with_limit(limit))
            .context("Search failed")?;

        // Collect query words for filename boosting
        let query_lower = query_str.to_lowercase();
        let query_words: Vec<&str> = query_lower.split_whitespace().collect();

        let mut results = Vec::new();
        for (score, doc_address) in top_docs {
            let doc: TantivyDocument = searcher
                .doc(doc_address)
                .context("Failed to retrieve document")?;

            let path = doc
                .get_first(self.schema.path)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let content = doc
                .get_first(self.schema.content)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let snippet = extract_snippet(&content, query_str, 5);

            // Filename/path boosting
            let basename = std::path::Path::new(&path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            let path_lower = path.to_lowercase();

            let mut boosted_score = score;
            for word in &query_words {
                if basename == *word || basename.contains(word) {
                    boosted_score *= 2.0;
                    break;
                }
                if path_lower.split('/').any(|seg| seg == *word) {
                    boosted_score *= 1.3;
                    break;
                }
            }

            results.push(SearchResult {
                path,
                score: boosted_score,
                snippet,
            });
        }

        // Re-sort by boosted score
        results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

        Ok(results)
    }

    /// Get or create the vec_store (used by background embedding)
    pub fn get_or_create_vec_store(&mut self, vec_dir: PathBuf) -> &mut VecStore {
        self.vec_store.get_or_insert_with(|| VecStore::new(vec_dir, EMBED_DIM))
    }

    /// Get all known file paths (for embedding when vec_store is empty)
    pub fn file_hashes_keys(&self) -> Vec<String> {
        self.file_hashes.keys().cloned().collect()
    }

    /// Number of vectors in the store
    pub fn vector_count(&self) -> usize {
        self.vec_store.as_ref().map_or(0, |v| v.len())
    }

    /// Remove a single file from the index (for watcher delete events)
    pub fn remove_file(&mut self, relative_path: &str) -> Result<()> {
        let mut writer: IndexWriter = self
            .index
            .writer(50_000_000)
            .context("Failed to create index writer")?;

        writer.delete_term(tantivy::Term::from_field_text(self.schema.path, relative_path));
        writer.commit().context("Failed to commit deletion")?;
        self.reader.reload()?;

        self.file_hashes.remove(relative_path);
        save_hashes(&self.root, &self.file_hashes);

        // Remove from vector store
        if let Some(ref mut vs) = self.vec_store {
            vs.remove_path(relative_path);
        }

        Ok(())
    }

    /// Incrementally update a single file in the index (for watcher modify/create events)
    pub fn update_file(&mut self, file: &SourceFile) -> Result<bool> {
        // Check if content changed
        if let Some(&old_hash) = self.file_hashes.get(&file.relative_path) {
            if old_hash == file.content_hash {
                return Ok(false); // unchanged
            }
        }

        let mut writer: IndexWriter = self
            .index
            .writer(50_000_000)
            .context("Failed to create index writer")?;

        // Delete old doc if exists
        writer.delete_term(tantivy::Term::from_field_text(self.schema.path, &file.relative_path));

        // Add new doc
        let kind = if file.is_code { "code" } else { "docs" };
        let basename = file
            .path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        let symbols = extract_symbols(&file.content);

        writer.add_document(doc!(
            self.schema.path => file.relative_path.as_str(),
            self.schema.basename => basename,
            self.schema.content => file.content.as_str(),
            self.schema.symbols => symbols.as_str(),
            self.schema.kind => kind,
            self.schema.extension => file.extension.as_str(),
        ))?;

        writer.commit().context("Failed to commit update")?;
        self.reader.reload()?;

        self.file_hashes.insert(file.relative_path.clone(), file.content_hash);
        save_hashes(&self.root, &self.file_hashes);

        // Remove old vectors (watcher will re-embed later)
        if let Some(ref mut vs) = self.vec_store {
            vs.remove_path(&file.relative_path);
        }

        Ok(true)
    }

    /// Get index statistics
    pub fn stats(&self) -> (u64, usize) {
        let searcher = self.reader.searcher();
        let doc_count = searcher.num_docs();
        let segment_count = searcher.segment_readers().len();
        (doc_count, segment_count)
    }
}

// --- Hash persistence ---

fn hashes_path(root: &Path) -> PathBuf {
    root.join(".kairo").join("file_hashes.json")
}

fn load_hashes(root: &Path) -> HashMap<String, u64> {
    let path = hashes_path(root);
    match std::fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        Err(_) => HashMap::new(),
    }
}

fn save_hashes(root: &Path, hashes: &HashMap<String, u64>) {
    let path = hashes_path(root);
    if let Ok(json) = serde_json::to_string(hashes) {
        let _ = std::fs::write(path, json);
    }
}

// --- Schema ---

fn build_schema() -> SchemaWithFields {
    let mut builder = Schema::builder();

    let path = builder.add_text_field("path", STRING | STORED);
    let basename = builder.add_text_field(
        "basename",
        TextOptions::default()
            .set_indexing_options(
                TextFieldIndexing::default()
                    .set_tokenizer("path")
                    .set_index_option(IndexRecordOption::WithFreqsAndPositions),
            )
            .set_stored(),
    );
    let content = builder.add_text_field(
        "content",
        TextOptions::default()
            .set_indexing_options(
                TextFieldIndexing::default()
                    .set_tokenizer("code_content")
                    .set_index_option(IndexRecordOption::WithFreqsAndPositions),
            )
            .set_stored(),
    );
    let symbols = builder.add_text_field(
        "symbols",
        TextOptions::default().set_indexing_options(
            TextFieldIndexing::default()
                .set_tokenizer("identifier")
                .set_index_option(IndexRecordOption::WithFreqsAndPositions),
        ),
    );
    let kind = builder.add_text_field("kind", STRING | STORED);
    let extension = builder.add_text_field("extension", STRING | STORED);

    let schema = builder.build();

    SchemaWithFields {
        schema,
        fields: SearchSchema {
            path,
            basename,
            content,
            symbols,
            kind,
            extension,
        },
    }
}

struct SchemaWithFields {
    schema: Schema,
    fields: SearchSchema,
}

#[derive(Debug)]
enum QueryIntent {
    Path,
    Symbol,
    General,
}

fn detect_intent(query: &str) -> QueryIntent {
    if query.contains('/') || query.contains('\\') {
        QueryIntent::Path
    } else if query.contains("::") || query.contains('.') || query.chars().any(|c| c.is_uppercase())
    {
        QueryIntent::Symbol
    } else {
        QueryIntent::General
    }
}

fn extract_symbols(content: &str) -> String {
    let mut symbols = Vec::new();
    let mut current = String::new();

    for ch in content.chars() {
        if ch.is_alphanumeric() || ch == '_' {
            current.push(ch);
        } else {
            if current.len() >= 3 {
                symbols.push(current.clone());
            }
            current.clear();
        }
    }
    if current.len() >= 3 {
        symbols.push(current);
    }

    symbols.sort();
    symbols.dedup();
    symbols.join(" ")
}

fn read_chunk_snippet(root: &Path, rel_path: &str, offset: u32, len: u32) -> String {
    let file_path = root.join(rel_path);
    match std::fs::read_to_string(&file_path) {
        Ok(content) => {
            let start = offset as usize;
            let end = (offset + len) as usize;
            if end <= content.len() {
                content[start..end].to_string()
            } else if start < content.len() {
                content[start..].to_string()
            } else {
                content.chars().take(500).collect()
            }
        }
        Err(_) => format!("[could not read {}]", rel_path),
    }
}

/// Block-start patterns for scope-aware snippet extraction
const BLOCK_STARTERS: &[&str] = &[
    "fn ", "pub fn ", "pub(crate) fn ", "async fn ", "pub async fn ",
    "struct ", "pub struct ", "enum ", "pub enum ",
    "impl ", "trait ", "pub trait ",
    "class ", "export class ", "export default class ",
    "function ", "export function ", "export default function ", "async function ",
    "const ", "let ", "export const ", "export let ",
    "def ", "async def ",
    "func ", // Go
];

fn extract_snippet(content: &str, query: &str, context_lines: usize) -> String {
    let query_lower = query.to_lowercase();
    let query_words: Vec<&str> = query_lower.split_whitespace().collect();
    let lines: Vec<&str> = content.lines().collect();

    let mut best_line = 0;
    let mut best_score = 0;

    for (i, line) in lines.iter().enumerate() {
        let line_lower = line.to_lowercase();
        let score: usize = query_words
            .iter()
            .filter(|word| line_lower.contains(*word))
            .count();
        if score > best_score {
            best_score = score;
            best_line = i;
        }
    }

    // Try to expand to enclosing block boundary
    let mut start = best_line.saturating_sub(context_lines);

    // Look backward for a block-starting line
    for i in (0..best_line).rev() {
        let trimmed = lines[i].trim_start();
        if BLOCK_STARTERS.iter().any(|s| trimmed.starts_with(s)) {
            start = i;
            break;
        }
        // Don't look back more than 10 lines from best_line
        if best_line - i > 10 {
            break;
        }
    }

    // Cap snippet at 15 lines
    let max_lines = 15;
    let end = (start + max_lines).min(lines.len());

    lines[start..end].join("\n")
}
