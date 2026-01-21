use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use fs2::FileExt;
use napi::bindgen_prelude::Result;
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tantivy::collector::TopDocs;
use tantivy::merge_policy::LogMergePolicy;
use tantivy::query::{BooleanQuery, Occur, Query, QueryParser, TermQuery};
use tantivy::schema::{
    Field, IndexRecordOption, Schema, TextFieldIndexing, TextOptions, FAST, STORED, STRING,
};
use tantivy::tokenizer::{
    AsciiFoldingFilter, LowerCaser, NgramTokenizer, RemoveLongFilter, SimpleTokenizer, TextAnalyzer,
    Token, TokenStream, Tokenizer,
};
use tantivy::{Document, Index, IndexReader, IndexWriter, ReloadPolicy, Term};

const SCHEMA_VERSION: u32 = 1;
const INDEX_VERSION: u32 = 1;
const DEFAULT_WRITER_MEMORY_MB: usize = 256;
const KAIRO_META_FILENAME: &str = "kairo_meta.json";
const TANTIVY_META_FILENAME: &str = "meta.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct IndexMeta {
    schema_version: u32,
    index_version: u32,
    created_at: u64,
    kairo_version: Option<String>,
    core_rs_version: String,
    repo_id: Option<String>,
}

#[derive(Clone)]
struct IdentifierTokenizer;

struct IdentifierTokenStream<'a> {
    text: &'a str,
    tokens: Vec<(usize, usize)>,
    index: usize,
    token: Token,
}

impl<'a> IdentifierTokenStream<'a> {
    fn new(text: &'a str) -> Self {
        let mut tokens: Vec<(usize, usize)> = Vec::new();
        let mut start: Option<usize> = None;
        let mut prev: Option<char> = None;
        let mut prev_idx: usize = 0;

        for (idx, ch) in text.char_indices() {
            if ch.is_alphanumeric() {
                if start.is_none() {
                    start = Some(idx);
                } else if let Some(prev_ch) = prev {
                    if is_identifier_boundary(prev_ch, ch) {
                        if let Some(s) = start {
                            if s < idx {
                                tokens.push((s, idx));
                            }
                        }
                        start = Some(idx);
                    }
                }
                prev = Some(ch);
                prev_idx = idx;
            } else {
                if let Some(s) = start {
                    if s < idx {
                        tokens.push((s, idx));
                    }
                }
                start = None;
                prev = None;
            }
        }

        if let Some(s) = start {
            let end = text.len();
            if s < end {
                tokens.push((s, end));
            } else if s == end && prev_idx == end {
                tokens.push((s, end));
            }
        }

        Self {
            text,
            tokens,
            index: 0,
            token: Token::default(),
        }
    }
}

impl<'a> TokenStream for IdentifierTokenStream<'a> {
    fn advance(&mut self) -> bool {
        if self.index >= self.tokens.len() {
            return false;
        }
        let (start, end) = self.tokens[self.index];
        self.index += 1;
        self.token.offset_from = start;
        self.token.offset_to = end;
        self.token.position = self.index;
        self.token.text = self.text[start..end].to_string();
        true
    }

    fn token(&self) -> &Token {
        &self.token
    }

    fn token_mut(&mut self) -> &mut Token {
        &mut self.token
    }
}

impl Tokenizer for IdentifierTokenizer {
    type TokenStream<'a> = IdentifierTokenStream<'a>;

    fn token_stream<'a>(&'a mut self, text: &'a str) -> Self::TokenStream<'a> {
        IdentifierTokenStream::new(text)
    }
}

fn is_identifier_boundary(prev: char, next: char) -> bool {
    if prev.is_lowercase() && next.is_uppercase() {
        return true;
    }
    if prev.is_alphabetic() && next.is_numeric() {
        return true;
    }
    if prev.is_numeric() && next.is_alphabetic() {
        return true;
    }
    false
}

#[derive(Clone)]
struct SearchSchema {
    schema: Schema,
    kind: Field,
    repo_id: Field,
    path: Field,
    doc_path: Field,
    chunk_id: Field,
    scope: Field,
    ext: Field,
    basename: Field,
    path_tokens: Field,
    symbols: Field,
    content: Field,
    content_ngram: Field,
    text: Field,
    text_ngram: Field,
    heading_path: Field,
    content_hash: Field,
    mtime_ms: Field,
    path_depth: Field,
    callgraph_rank: Field,
    doc_key: Field,
}

impl SearchSchema {
    fn new() -> Self {
        let text_indexing = TextFieldIndexing::default()
            .set_tokenizer("code_content")
            .set_index_option(IndexRecordOption::WithFreqsAndPositions);
        let text_options = TextOptions::default().set_indexing_options(text_indexing.clone());

        let ngram_indexing = TextFieldIndexing::default()
            .set_tokenizer("ngram3")
            .set_index_option(IndexRecordOption::WithFreqsAndPositions);
        let ngram_options = TextOptions::default().set_indexing_options(ngram_indexing.clone());

        let path_indexing = TextFieldIndexing::default()
            .set_tokenizer("path")
            .set_index_option(IndexRecordOption::WithFreqsAndPositions);
        let path_options = TextOptions::default().set_indexing_options(path_indexing.clone());

        let identifier_indexing = TextFieldIndexing::default()
            .set_tokenizer("identifier")
            .set_index_option(IndexRecordOption::WithFreqsAndPositions);
        let identifier_options = TextOptions::default().set_indexing_options(identifier_indexing.clone());

        let mut builder = Schema::builder();
        let kind = builder.add_text_field("kind", STRING | STORED);
        let repo_id = builder.add_text_field("repo_id", STRING | STORED);
        let path = builder.add_text_field("path", STRING | STORED);
        let doc_path = builder.add_text_field("doc_path", STRING | STORED);
        let chunk_id = builder.add_text_field("chunk_id", STRING | STORED);
        let scope = builder.add_text_field("scope", STRING | STORED);
        let ext = builder.add_text_field("ext", STRING | STORED);
        let basename = builder.add_text_field("basename", path_options.clone());
        let path_tokens = builder.add_text_field("path_tokens", path_options.clone());
        let symbols = builder.add_text_field("symbols", identifier_options.clone());
        let content = builder.add_text_field("content", text_options.clone());
        let content_ngram = builder.add_text_field("content_ngram", ngram_options.clone());
        let text = builder.add_text_field("text", text_options.clone());
        let text_ngram = builder.add_text_field("text_ngram", ngram_options.clone());
        let heading_path = builder.add_text_field("heading_path", path_options.clone());
        let content_hash = builder.add_text_field("content_hash", STRING | STORED);
        let mtime_ms = builder.add_u64_field("mtime_ms", FAST);
        let path_depth = builder.add_u64_field("path_depth", FAST);
        let callgraph_rank = builder.add_f64_field("callgraph_rank", FAST);
        let doc_key = builder.add_text_field("doc_key", STRING);

        Self {
            schema: builder.build(),
            kind,
            repo_id,
            path,
            doc_path,
            chunk_id,
            scope,
            ext,
            basename,
            path_tokens,
            symbols,
            content,
            content_ngram,
            text,
            text_ngram,
            heading_path,
            content_hash,
            mtime_ms,
            path_depth,
            callgraph_rank,
            doc_key,
        }
    }
}

#[napi(object)]
pub struct NativeSearchCoreOptions {
    pub writer_memory_mb: Option<u32>,
    pub kairo_version: Option<String>,
    pub repo_id: Option<String>,
}

#[napi(object)]
pub struct NativeIndexDoc {
    pub kind: String,
    pub repo_id: String,
    pub path: Option<String>,
    pub ext: Option<String>,
    pub mtime_ms: Option<i64>,
    pub content_hash: Option<String>,
    pub content: Option<String>,
    pub symbols: Option<Vec<String>>,
    pub path_depth: Option<u32>,
    pub callgraph_rank: Option<f64>,
    pub chunk_id: Option<String>,
    pub doc_path: Option<String>,
    pub heading_path: Option<Vec<String>>,
    pub scope: Option<String>,
    pub text: Option<String>,
}

#[napi(object)]
pub struct NativeDeleteTarget {
    pub kind: String,
    pub repo_id: String,
    pub path: Option<String>,
    pub chunk_id: Option<String>,
}

#[napi(object)]
pub struct NativeSearchQuery {
    pub kind: String,
    pub query: String,
    pub repo_ids: Option<Vec<String>>,
    pub limit: u32,
    pub file_types: Option<Vec<String>>,
    pub scopes: Option<Vec<String>>,
    pub debug: Option<bool>,
}

#[napi(object)]
pub struct NativeSearchHit {
    pub kind: String,
    pub repo_id: String,
    pub path: String,
    pub chunk_id: Option<String>,
    pub score: f64,
    pub scope: Option<String>,
    pub signals: Option<Vec<String>>,
    pub meta: Option<HashMap<String, String>>,
}

#[napi(object)]
pub struct NativeSearchStats {
    pub doc_count: u32,
    pub segment_count: u32,
    pub index_version: u32,
    pub schema_version: u32,
}

#[napi]
pub struct NativeSearchCore {
    index: Index,
    schema: SearchSchema,
    reader: IndexReader,
    writer: Mutex<Option<IndexWriter>>,
    _index_dir: PathBuf,
    meta: IndexMeta,
    lock_file: Mutex<Option<fs::File>>,
    write_enabled: bool,
}

#[napi]
impl NativeSearchCore {
    #[napi(constructor)]
    pub fn new(index_dir: String, options: Option<NativeSearchCoreOptions>) -> Result<Self> {
        let index_dir = PathBuf::from(index_dir);
        fs::create_dir_all(&index_dir).map_err(|error| {
            napi::Error::from_reason(format!("INDEX_DIR_CREATE_FAILED: {error}"))
        })?;

        let lock_path = index_dir.join(".lock");
        let lock_file = fs::OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(&lock_path)
            .map_err(|error| napi::Error::from_reason(format!("INDEX_LOCK_OPEN_FAILED: {error}")))?;

        let mut write_enabled = true;
        if let Err(error) = lock_file.try_lock_exclusive() {
            write_enabled = false;
            if !index_dir.join(TANTIVY_META_FILENAME).exists() {
                return Err(napi::Error::from_reason(format!(
                    "INDEX_WRITE_LOCKED: {error}"
                )));
            }
        }

        if write_enabled {
            let _ = migrate_legacy_meta(&index_dir);
        }

        let schema = SearchSchema::new();
        let meta = load_or_init_meta(
            &index_dir,
            options.as_ref().and_then(|opt| opt.repo_id.clone()),
            options.as_ref().and_then(|opt| opt.kairo_version.clone()),
        )
        .map_err(|error| napi::Error::from_reason(format!("INDEX_META_FAILED: {error}")))?;

        let index = if write_enabled {
            let directory = tantivy::directory::MmapDirectory::open(&index_dir).map_err(|error| {
                napi::Error::from_reason(format!("INDEX_DIR_OPEN_FAILED: {error}"))
            })?;
            Index::open_or_create(directory, schema.schema.clone()).map_err(|error| {
                napi::Error::from_reason(format!("INDEX_OPEN_FAILED: {error}"))
            })?
        } else {
            Index::open_in_dir(&index_dir).map_err(|error| {
                napi::Error::from_reason(format!("INDEX_OPEN_FAILED: {error}"))
            })?
        };

        register_tokenizers(&index);

        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::OnCommit)
            .try_into()
            .map_err(|error| napi::Error::from_reason(format!("INDEX_READER_FAILED: {error}")))?;

        let writer = if write_enabled {
            let memory_mb = options
                .as_ref()
                .and_then(|opt| opt.writer_memory_mb)
                .map(|value| value as usize)
                .unwrap_or(DEFAULT_WRITER_MEMORY_MB);
            let memory_bytes = memory_mb.saturating_mul(1024 * 1024);
            let writer = index
                .writer_with_num_threads(1, memory_bytes)
                .map_err(|error| napi::Error::from_reason(format!("INDEX_WRITER_FAILED: {error}")))?;
            let policy = LogMergePolicy::default();
            writer.set_merge_policy(Box::new(policy));
            Some(writer)
        } else {
            None
        };

        Ok(Self {
            index,
            schema,
            reader,
            writer: Mutex::new(writer),
            _index_dir: index_dir,
            meta,
            lock_file: Mutex::new(Some(lock_file)),
            write_enabled,
        })
    }

    #[napi]
    pub fn upsert(&self, doc: NativeIndexDoc) -> Result<()> {
        self.upsert_many(vec![doc])
    }

    #[napi]
    pub fn upsert_many(&self, docs: Vec<NativeIndexDoc>) -> Result<()> {
        if !self.write_enabled {
            return Err(napi::Error::from_reason("INDEX_WRITE_LOCKED"));
        }
        let mut writer_guard = self.writer.lock().unwrap();
        let writer = writer_guard.as_mut().ok_or_else(|| {
            napi::Error::from_reason("INDEX_WRITE_DISABLED")
        })?;

        for doc in docs {
            let doc_key = doc_key_for(&doc)?;
            let term = Term::from_field_text(self.schema.doc_key, &doc_key);
            writer.delete_term(term);
            let document = build_document(&self.schema, doc, &doc_key)?;
            writer
                .add_document(document)
                .map_err(|error| napi::Error::from_reason(format!("INDEX_UPSERT_FAILED: {error}")))?;
        }

        Ok(())
    }

    #[napi]
    pub fn delete_doc(&self, target: NativeDeleteTarget) -> Result<()> {
        if !self.write_enabled {
            return Err(napi::Error::from_reason("INDEX_WRITE_LOCKED"));
        }
        let mut writer_guard = self.writer.lock().unwrap();
        let writer = writer_guard.as_mut().ok_or_else(|| {
            napi::Error::from_reason("INDEX_WRITE_DISABLED")
        })?;

        let key = match target.kind.as_str() {
            "code_file" => {
                let path = target.path.ok_or_else(|| {
                    napi::Error::from_reason("DELETE_MISSING_PATH")
                })?;
                format!("{}:code_file:{}", target.repo_id, path)
            }
            "doc_chunk" => {
                let chunk_id = target.chunk_id.ok_or_else(|| {
                    napi::Error::from_reason("DELETE_MISSING_CHUNK")
                })?;
                format!("{}:doc_chunk:{}", target.repo_id, chunk_id)
            }
            _ => return Err(napi::Error::from_reason("DELETE_INVALID_KIND")),
        };

        let term = Term::from_field_text(self.schema.doc_key, &key);
        writer.delete_term(term);
        Ok(())
    }

    #[napi]
    pub fn commit(&self) -> Result<()> {
        if !self.write_enabled {
            return Err(napi::Error::from_reason("INDEX_WRITE_LOCKED"));
        }
        let mut writer_guard = self.writer.lock().unwrap();
        let writer = writer_guard.as_mut().ok_or_else(|| {
            napi::Error::from_reason("INDEX_WRITE_DISABLED")
        })?;
        writer
            .commit()
            .map_err(|error| napi::Error::from_reason(format!("INDEX_COMMIT_FAILED: {error}")))?;
        Ok(())
    }

    #[napi]
    pub fn reset(&self) -> Result<()> {
        if !self.write_enabled {
            return Err(napi::Error::from_reason("INDEX_WRITE_LOCKED"));
        }
        let mut writer_guard = self.writer.lock().unwrap();
        let writer = writer_guard.as_mut().ok_or_else(|| {
            napi::Error::from_reason("INDEX_WRITE_DISABLED")
        })?;
        writer
            .delete_all_documents()
            .map_err(|error| napi::Error::from_reason(format!("INDEX_RESET_FAILED: {error}")))?;
        writer
            .commit()
            .map_err(|error| napi::Error::from_reason(format!("INDEX_COMMIT_FAILED: {error}")))?;
        Ok(())
    }

    #[napi]
    pub fn search(&self, query: NativeSearchQuery) -> Result<Vec<NativeSearchHit>> {
        if query.query.trim().is_empty() {
            return Ok(Vec::new());
        }
        let limit = usize::max(1, query.limit as usize);
        let debug = query.debug.unwrap_or(false);

        match query.kind.as_str() {
            "code_file" => {
                let hits = search_kind(&self, "code_file", &query, limit, debug)?;
                Ok(hits.into_iter().map(|hit| hit.output).collect())
            }
            "doc_chunk" => {
                let hits = search_kind(&self, "doc_chunk", &query, limit, debug)?;
                Ok(hits.into_iter().map(|hit| hit.output).collect())
            }
            "any" => {
                let code_hits = search_kind(&self, "code_file", &query, limit, debug)?;
                let doc_hits = search_kind(&self, "doc_chunk", &query, limit, debug)?;
                Ok(merge_rrf(code_hits, doc_hits, limit))
            }
            _ => Err(napi::Error::from_reason("QUERY_INVALID_KIND")),
        }
    }

    #[napi]
    pub fn close(&self) -> Result<()> {
        let mut writer_guard = self.writer.lock().unwrap();
        if let Some(writer) = writer_guard.as_mut() {
            let _ = writer.commit();
        }
        writer_guard.take();
        let mut lock_guard = self.lock_file.lock().unwrap();
        lock_guard.take();
        Ok(())
    }

    #[napi]
    pub fn stats(&self) -> Result<NativeSearchStats> {
        let searcher = self.reader.searcher();
        let segment_count = searcher.segment_readers().len() as u32;
        let doc_count = searcher.num_docs();
        Ok(NativeSearchStats {
            doc_count: doc_count.try_into().unwrap_or(u32::MAX),
            segment_count,
            index_version: self.meta.index_version,
            schema_version: self.meta.schema_version,
        })
    }
}

struct InternalHit {
    key: String,
    rank: usize,
    output: NativeSearchHit,
}

fn search_kind(
    core: &NativeSearchCore,
    kind: &str,
    query: &NativeSearchQuery,
    limit: usize,
    debug: bool,
) -> Result<Vec<InternalHit>> {
    let searcher = core.reader.searcher();
    let mut filters: Vec<(Occur, Box<dyn Query>)> = Vec::new();

    filters.push((
        Occur::Must,
        Box::new(TermQuery::new(
            Term::from_field_text(core.schema.kind, kind),
            IndexRecordOption::Basic,
        )),
    ));

    if let Some(repo_ids) = query.repo_ids.as_ref().filter(|ids| !ids.is_empty()) {
        let repo_terms: Vec<(Occur, Box<dyn Query>)> = repo_ids
            .iter()
            .map(|repo_id| {
                (
                    Occur::Should,
                    Box::new(TermQuery::new(
                        Term::from_field_text(core.schema.repo_id, repo_id),
                        IndexRecordOption::Basic,
                    )) as Box<dyn Query>,
                )
            })
            .collect();
        filters.push((Occur::Must, Box::new(BooleanQuery::new(repo_terms))));
    }

    if let Some(file_types) = query.file_types.as_ref().filter(|types| !types.is_empty()) {
        let type_terms: Vec<(Occur, Box<dyn Query>)> = file_types
            .iter()
            .map(|ext| {
                (
                    Occur::Should,
                    Box::new(TermQuery::new(
                        Term::from_field_text(core.schema.ext, ext),
                        IndexRecordOption::Basic,
                    )) as Box<dyn Query>,
                )
            })
            .collect();
        filters.push((Occur::Must, Box::new(BooleanQuery::new(type_terms))));
    }

    if kind == "doc_chunk" {
        if let Some(scopes) = query.scopes.as_ref().filter(|items| !items.is_empty()) {
            let scope_terms: Vec<(Occur, Box<dyn Query>)> = scopes
                .iter()
                .map(|scope| {
                    (
                        Occur::Should,
                        Box::new(TermQuery::new(
                            Term::from_field_text(core.schema.scope, scope),
                            IndexRecordOption::Basic,
                        )) as Box<dyn Query>,
                    )
                })
                .collect();
            filters.push((Occur::Must, Box::new(BooleanQuery::new(scope_terms))));
        }
    }

    let parser = build_query_parser(core, kind, &query.query);
    let parsed = parser.parse_query(&query.query).map_err(|error| {
        napi::Error::from_reason(format!("QUERY_PARSE_FAILED: {error}"))
    })?;

    let mut clauses = vec![(Occur::Must, parsed)];
    clauses.extend(filters);
    let final_query = BooleanQuery::new(clauses);

    let top_docs = searcher
        .search(&final_query, &TopDocs::with_limit(limit))
        .map_err(|error| napi::Error::from_reason(format!("QUERY_EXEC_FAILED: {error}")))?;

    let path_depth_name = core.schema.schema.get_field_name(core.schema.path_depth);
    let callgraph_name = core.schema.schema.get_field_name(core.schema.callgraph_rank);
    let mut path_depth_readers = Vec::new();
    let mut callgraph_readers = Vec::new();
    for reader in searcher.segment_readers() {
        let fast_fields = reader.fast_fields();
        let path_depth_reader = fast_fields
            .column_first_or_default::<u64>(path_depth_name)
            .map_err(|error| napi::Error::from_reason(format!("FAST_FIELD_FAILED: {error}")))?;
        let callgraph_reader = fast_fields
            .column_first_or_default::<f64>(callgraph_name)
            .map_err(|error| napi::Error::from_reason(format!("FAST_FIELD_FAILED: {error}")))?;
        path_depth_readers.push(path_depth_reader);
        callgraph_readers.push(callgraph_reader);
    }

    let mut outputs: Vec<InternalHit> = Vec::new();

    for (rank, (score, address)) in top_docs.into_iter().enumerate() {
        let retrieved = searcher
            .doc(address)
            .map_err(|error| napi::Error::from_reason(format!("DOC_FETCH_FAILED: {error}")))?;

        let repo_id = value_text(&retrieved, core.schema.repo_id).unwrap_or_default();
        let path_value = if kind == "doc_chunk" {
            value_text(&retrieved, core.schema.doc_path).unwrap_or_default()
        } else {
            value_text(&retrieved, core.schema.path).unwrap_or_default()
        };
        let chunk_id = if kind == "doc_chunk" {
            value_text(&retrieved, core.schema.chunk_id)
        } else {
            None
        };
        let scope = if kind == "doc_chunk" {
            value_text(&retrieved, core.schema.scope)
        } else {
            None
        };
        let segment_ord = address.segment_ord as usize;
        let path_depth = path_depth_readers
            .get(segment_ord)
            .map(|reader| reader.get_val(address.doc_id))
            .unwrap_or(0);
        let callgraph_rank = callgraph_readers
            .get(segment_ord)
            .map(|reader| reader.get_val(address.doc_id))
            .unwrap_or(0.0);
        let depth_multiplier = 1.0 / (1.0 + path_depth as f64);
        let callgraph_multiplier = 1.0 + clamp(callgraph_rank, 0.0, 1.0) * 2.0;
        let final_score = score as f64 * depth_multiplier * callgraph_multiplier;

        let mut signals = None;
        if debug {
            signals = Some(vec![
                format!("bm25={:.4}", score),
                format!("depth={}", path_depth),
                format!("depth_mult={:.4}", depth_multiplier),
                format!("callgraph={:.4}", callgraph_rank),
                format!("callgraph_mult={:.4}", callgraph_multiplier),
            ]);
        }

        let key = if kind == "doc_chunk" {
            if let Some(chunk_id) = chunk_id.as_ref() {
                format!("{}:{}:{}", repo_id, kind, chunk_id)
            } else {
                format!("{}:{}:{}", repo_id, kind, path_value)
            }
        } else {
            format!("{}:{}:{}", repo_id, kind, path_value)
        };

        outputs.push(InternalHit {
            key,
            rank,
            output: NativeSearchHit {
                kind: kind.to_string(),
                repo_id,
                path: path_value,
                chunk_id,
                score: final_score,
                scope,
                signals,
                meta: None,
            },
        });
    }

    Ok(outputs)
}

fn merge_rrf(code_hits: Vec<InternalHit>, doc_hits: Vec<InternalHit>, limit: usize) -> Vec<NativeSearchHit> {
    let mut merged: HashMap<String, (NativeSearchHit, f64)> = HashMap::new();
    let k = 60.0;
    let doc_weight = 0.8;

    for hit in code_hits {
        let score = 1.0 / (k + hit.rank as f64 + 1.0);
        merged.insert(hit.key, (hit.output, score));
    }

    for hit in doc_hits {
        let score = doc_weight / (k + hit.rank as f64 + 1.0);
        merged
            .entry(hit.key)
            .and_modify(|entry| entry.1 += score)
            .or_insert((hit.output, score));
    }

    let mut values: Vec<(NativeSearchHit, f64)> = merged.into_iter().map(|(_, value)| value).collect();
    values.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    values
        .into_iter()
        .take(limit)
        .map(|mut entry| {
            entry.0.score = entry.1;
            entry.0
        })
        .collect()
}

fn build_query_parser(core: &NativeSearchCore, kind: &str, query: &str) -> QueryParser {
    let intent = detect_intent(query);
    let mut fields: Vec<Field> = Vec::new();
    if kind == "code_file" {
        fields.extend_from_slice(&[
            core.schema.symbols,
            core.schema.basename,
            core.schema.path_tokens,
            core.schema.content,
            core.schema.content_ngram,
        ]);
    } else {
        fields.extend_from_slice(&[
            core.schema.text,
            core.schema.heading_path,
            core.schema.text_ngram,
        ]);
    }
    let mut parser = QueryParser::for_index(&core.index, fields);

    let mut symbol_boost = 8.0;
    let mut basename_boost = 6.0;
    let mut path_boost = 4.0;
    let content_boost = 1.0;
    let ngram_boost = 0.5;

    if intent == QueryIntent::Path {
        basename_boost *= 1.5;
        path_boost *= 1.5;
    } else if intent == QueryIntent::Symbol {
        symbol_boost *= 1.5;
    }

    if kind == "code_file" {
        parser.set_field_boost(core.schema.symbols, symbol_boost);
        parser.set_field_boost(core.schema.basename, basename_boost);
        parser.set_field_boost(core.schema.path_tokens, path_boost);
        parser.set_field_boost(core.schema.content, content_boost);
        parser.set_field_boost(core.schema.content_ngram, ngram_boost);
    } else {
        parser.set_field_boost(core.schema.text, 1.0);
        parser.set_field_boost(core.schema.heading_path, 2.5);
        parser.set_field_boost(core.schema.text_ngram, 0.4);
    }

    parser
}

#[derive(PartialEq)]
enum QueryIntent {
    Path,
    Symbol,
    General,
}

fn detect_intent(query: &str) -> QueryIntent {
    let trimmed = query.trim();
    if trimmed.contains('/') || trimmed.contains('\\') {
        return QueryIntent::Path;
    }
    if trimmed.contains("::") || trimmed.contains('.') {
        return QueryIntent::Symbol;
    }
    if trimmed.chars().any(|ch| ch.is_uppercase()) {
        return QueryIntent::Symbol;
    }
    QueryIntent::General
}

fn build_document(schema: &SearchSchema, doc: NativeIndexDoc, doc_key: &str) -> Result<Document> {
    match doc.kind.as_str() {
        "code_file" => build_code_document(schema, doc, doc_key),
        "doc_chunk" => build_doc_document(schema, doc, doc_key),
        _ => Err(napi::Error::from_reason("DOC_INVALID_KIND")),
    }
}

fn doc_key_for(doc: &NativeIndexDoc) -> Result<String> {
    match doc.kind.as_str() {
        "code_file" => {
            let path = doc
                .path
                .as_ref()
                .ok_or_else(|| napi::Error::from_reason("DOC_MISSING_PATH"))?;
            Ok(format!("{}:code_file:{}", doc.repo_id, path))
        }
        "doc_chunk" => {
            let chunk_id = doc
                .chunk_id
                .as_ref()
                .ok_or_else(|| napi::Error::from_reason("DOC_MISSING_CHUNK_ID"))?;
            Ok(format!("{}:doc_chunk:{}", doc.repo_id, chunk_id))
        }
        _ => Err(napi::Error::from_reason("DOC_INVALID_KIND")),
    }
}

fn build_code_document(schema: &SearchSchema, doc: NativeIndexDoc, doc_key: &str) -> Result<Document> {
    let path = doc.path.ok_or_else(|| napi::Error::from_reason("DOC_MISSING_PATH"))?;
    let content = doc
        .content
        .ok_or_else(|| napi::Error::from_reason("DOC_MISSING_CONTENT"))?;
    let repo_id = doc.repo_id;

    let basename = extract_basename(&path);
    let path_tokens = split_path_tokens(&path);
    let ext = doc.ext.unwrap_or_else(|| extract_ext(&path));

    let mut document = Document::default();
    document.add_text(schema.kind, "code_file");
    document.add_text(schema.repo_id, &repo_id);
    document.add_text(schema.path, &path);
    document.add_text(schema.ext, &ext);
    document.add_text(schema.basename, &basename);
    for token in path_tokens {
        document.add_text(schema.path_tokens, &token);
    }
    for symbol in doc.symbols.unwrap_or_default() {
        if !symbol.trim().is_empty() {
            document.add_text(schema.symbols, symbol.trim());
        }
    }
    document.add_text(schema.content, &content);
    document.add_text(schema.content_ngram, &content);

    if let Some(hash) = doc.content_hash {
        document.add_text(schema.content_hash, &hash);
    }
    if let Some(mtime) = doc.mtime_ms {
        if mtime >= 0 {
            document.add_u64(schema.mtime_ms, mtime as u64);
        }
    }
    let path_depth = doc
        .path_depth
        .map(|depth| depth as u64)
        .unwrap_or_else(|| compute_path_depth(&path));
    document.add_u64(schema.path_depth, path_depth);
    let callgraph_rank = doc.callgraph_rank.unwrap_or(0.0);
    document.add_f64(schema.callgraph_rank, callgraph_rank);

    document.add_text(schema.doc_key, doc_key);

    Ok(document)
}

fn build_doc_document(schema: &SearchSchema, doc: NativeIndexDoc, doc_key: &str) -> Result<Document> {
    let doc_path = doc
        .doc_path
        .ok_or_else(|| napi::Error::from_reason("DOC_MISSING_DOC_PATH"))?;
    let text = doc
        .text
        .ok_or_else(|| napi::Error::from_reason("DOC_MISSING_TEXT"))?;
    let chunk_id = doc
        .chunk_id
        .ok_or_else(|| napi::Error::from_reason("DOC_MISSING_CHUNK_ID"))?;
    let repo_id = doc.repo_id;

    let ext = doc.ext.unwrap_or_else(|| extract_ext(&doc_path));
    let scope = doc.scope.unwrap_or_else(|| "docs".to_string());

    let mut document = Document::default();
    document.add_text(schema.kind, "doc_chunk");
    document.add_text(schema.repo_id, &repo_id);
    document.add_text(schema.doc_path, &doc_path);
    document.add_text(schema.chunk_id, &chunk_id);
    document.add_text(schema.scope, &scope);
    document.add_text(schema.ext, &ext);
    document.add_text(schema.text, &text);
    document.add_text(schema.text_ngram, &text);
    if let Some(heading_path) = doc.heading_path {
        for heading in heading_path {
            document.add_text(schema.heading_path, heading);
        }
    }
    if let Some(hash) = doc.content_hash {
        document.add_text(schema.content_hash, &hash);
    }
    if let Some(mtime) = doc.mtime_ms {
        if mtime >= 0 {
            document.add_u64(schema.mtime_ms, mtime as u64);
        }
    }
    document.add_u64(schema.path_depth, 0);
    document.add_f64(schema.callgraph_rank, 0.0);

    document.add_text(schema.doc_key, doc_key);

    Ok(document)
}

fn value_text(document: &Document, field: Field) -> Option<String> {
    document
        .get_first(field)
        .and_then(|value| value.as_text())
        .map(|value| value.to_string())
}

fn extract_basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path)
        .to_string()
}

fn extract_ext(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .trim_start_matches('.')
        .to_lowercase()
}

fn compute_path_depth(path: &str) -> u64 {
    let segments: Vec<&str> = path.split('/').filter(|seg| !seg.is_empty()).collect();
    let depth = segments.len().saturating_sub(1);
    depth as u64
}

fn split_path_tokens(path: &str) -> Vec<String> {
    let normalized = path.replace('\\', "/");
    let mut tokens: Vec<String> = normalized
        .split('/')
        .filter(|seg| !seg.is_empty())
        .map(|seg| seg.to_lowercase())
        .collect();
    if let Some(basename) = Path::new(&normalized)
        .file_name()
        .and_then(|name| name.to_str())
    {
        let base = basename.to_lowercase();
        if !tokens.contains(&base) {
            tokens.push(base.clone());
        }
        if let Some(stem) = Path::new(&normalized)
            .file_stem()
            .and_then(|name| name.to_str())
        {
            let stem_lower = stem.to_lowercase();
            if !tokens.contains(&stem_lower) {
                tokens.push(stem_lower);
            }
        }
    }
    tokens
}

fn register_tokenizers(index: &Index) {
    let manager = index.tokenizers();
    let ngram3 = NgramTokenizer::new(3, 3, false).expect("Failed to build ngram tokenizer");
    manager.register(
        "code_content",
        TextAnalyzer::builder(SimpleTokenizer::default())
            .filter(RemoveLongFilter::limit(40))
            .filter(LowerCaser)
            .filter(AsciiFoldingFilter)
            .build(),
    );
    manager.register(
        "ngram3",
        TextAnalyzer::builder(ngram3).filter(LowerCaser).build(),
    );
    manager.register(
        "path",
        TextAnalyzer::builder(SimpleTokenizer::default())
            .filter(LowerCaser)
            .build(),
    );
    manager.register(
        "identifier",
        TextAnalyzer::builder(IdentifierTokenizer)
            .filter(LowerCaser)
            .build(),
    );
}

fn is_tantivy_meta(value: &Value) -> bool {
    value.get("segments").is_some()
}

fn migrate_legacy_meta(index_dir: &Path) -> std::io::Result<()> {
    let legacy_path = index_dir.join(TANTIVY_META_FILENAME);
    let new_path = index_dir.join(KAIRO_META_FILENAME);
    if !legacy_path.exists() || new_path.exists() {
        return Ok(());
    }
    let raw = fs::read_to_string(&legacy_path)?;
    let value: Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => {
            let _ = fs::rename(&legacy_path, index_dir.join("meta.json.legacy"));
            return Ok(());
        }
    };
    if is_tantivy_meta(&value) {
        return Ok(());
    }
    if let Ok(meta) = serde_json::from_value::<IndexMeta>(value.clone()) {
        write_meta(index_dir, &meta)?;
        let _ = fs::remove_file(&legacy_path);
        return Ok(());
    }
    let backup_path = index_dir.join("meta.json.legacy");
    if fs::rename(&legacy_path, &backup_path).is_err() {
        let _ = fs::remove_file(&legacy_path);
    }
    Ok(())
}

fn load_or_init_meta(
    index_dir: &Path,
    repo_id: Option<String>,
    kairo_version: Option<String>,
) -> std::io::Result<IndexMeta> {
    let meta_path = index_dir.join(KAIRO_META_FILENAME);
    if meta_path.exists() {
        let raw = fs::read_to_string(&meta_path)?;
        let meta: IndexMeta = serde_json::from_str(&raw).map_err(|error| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, error)
        })?;
        if meta.schema_version != SCHEMA_VERSION || meta.index_version != INDEX_VERSION {
            purge_index_dir(index_dir)?;
            return init_meta(index_dir, repo_id, kairo_version);
        }
        return Ok(meta);
    }
    init_meta(index_dir, repo_id, kairo_version)
}

fn init_meta(
    index_dir: &Path,
    repo_id: Option<String>,
    kairo_version: Option<String>,
) -> std::io::Result<IndexMeta> {
    let meta = IndexMeta {
        schema_version: SCHEMA_VERSION,
        index_version: INDEX_VERSION,
        created_at: now_ms(),
        kairo_version,
        core_rs_version: env!("CARGO_PKG_VERSION").to_string(),
        repo_id,
    };
    write_meta(index_dir, &meta)?;
    Ok(meta)
}

fn write_meta(index_dir: &Path, meta: &IndexMeta) -> std::io::Result<()> {
    let meta_path = index_dir.join(KAIRO_META_FILENAME);
    let mut file = fs::File::create(meta_path)?;
    let encoded = serde_json::to_string_pretty(meta).map_err(|error| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, error)
    })?;
    file.write_all(encoded.as_bytes())?;
    Ok(())
}

fn purge_index_dir(index_dir: &Path) -> std::io::Result<()> {
    if !index_dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(index_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.file_name().and_then(|name| name.to_str()) == Some(".lock") {
            continue;
        }
        if path.is_dir() {
            fs::remove_dir_all(&path)?;
        } else {
            fs::remove_file(&path)?;
        }
    }
    Ok(())
}

fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn clamp(value: f64, min: f64, max: f64) -> f64 {
    if value < min {
        min
    } else if value > max {
        max
    } else {
        value
    }
}
