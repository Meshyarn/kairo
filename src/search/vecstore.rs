use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Metadata for a single embedded chunk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VecEntry {
    pub path: String,
    pub chunk_idx: u32,
    /// Byte offset into the original file content
    pub snippet_offset: u32,
    /// Byte length of the chunk in the original file
    pub snippet_len: u32,
}

/// Persisted metadata sidecar
#[derive(Debug, Serialize, Deserialize)]
struct VecMeta {
    dim: usize,
    count: usize,
    version: u32,
    entries: Vec<VecEntry>,
}

/// Flat-file vector store with brute-force cosine search.
///
/// Vectors are stored as a contiguous `[f32 × dim]` binary blob.
/// Metadata (paths, chunk info) is stored as a JSON sidecar.
pub struct VecStore {
    vectors: Vec<Vec<f32>>,
    entries: Vec<VecEntry>,
    dim: usize,
    dir: PathBuf,
}

impl VecStore {
    /// Create a new empty vector store
    pub fn new(dir: PathBuf, dim: usize) -> Self {
        Self {
            vectors: Vec::new(),
            entries: Vec::new(),
            dim,
            dir,
        }
    }

    /// Load an existing vector store from disk
    pub fn load(dir: &Path, dim: usize) -> Result<Option<Self>> {
        let vectors_path = dir.join("vectors.bin");
        let meta_path = dir.join("vectors.meta.json");

        if !vectors_path.exists() || !meta_path.exists() {
            return Ok(None);
        }

        let meta_bytes = std::fs::read(&meta_path).context("read vectors.meta.json")?;
        let meta: VecMeta = serde_json::from_slice(&meta_bytes).context("parse vectors.meta.json")?;

        if meta.dim != dim {
            anyhow::bail!("dimension mismatch: expected {}, got {}", dim, meta.dim);
        }

        let bin_bytes = std::fs::read(&vectors_path).context("read vectors.bin")?;
        let expected_size = meta.count * dim * std::mem::size_of::<f32>();
        if bin_bytes.len() != expected_size {
            anyhow::bail!(
                "vectors.bin size mismatch: expected {} bytes, got {}",
                expected_size,
                bin_bytes.len()
            );
        }

        let floats: &[f32] = unsafe {
            std::slice::from_raw_parts(
                bin_bytes.as_ptr() as *const f32,
                bin_bytes.len() / std::mem::size_of::<f32>(),
            )
        };

        let vectors: Vec<Vec<f32>> = floats.chunks_exact(dim).map(|c| c.to_vec()).collect();

        Ok(Some(Self {
            vectors,
            entries: meta.entries,
            dim,
            dir: dir.to_path_buf(),
        }))
    }

    /// Add a vector with its metadata
    pub fn push(&mut self, vector: Vec<f32>, entry: VecEntry) {
        debug_assert_eq!(vector.len(), self.dim);
        self.vectors.push(vector);
        self.entries.push(entry);
    }

    /// Save the store to disk
    pub fn save(&self) -> Result<()> {
        std::fs::create_dir_all(&self.dir).context("create vectors directory")?;

        // Write binary vectors
        let mut bin = Vec::with_capacity(self.vectors.len() * self.dim * 4);
        for v in &self.vectors {
            for &f in v {
                bin.extend_from_slice(&f.to_le_bytes());
            }
        }
        std::fs::write(self.dir.join("vectors.bin"), &bin).context("write vectors.bin")?;

        // Write metadata
        let meta = VecMeta {
            dim: self.dim,
            count: self.vectors.len(),
            version: 1,
            entries: self.entries.clone(),
        };
        let meta_json = serde_json::to_string_pretty(&meta)?;
        std::fs::write(self.dir.join("vectors.meta.json"), meta_json)
            .context("write vectors.meta.json")?;

        Ok(())
    }

    /// Brute-force cosine similarity search
    pub fn search_cosine(&self, query: &[f32], limit: usize) -> Vec<(usize, f32)> {
        if self.vectors.is_empty() || query.len() != self.dim {
            return Vec::new();
        }

        let query_norm = norm(query);
        if query_norm < 1e-10 {
            return Vec::new();
        }

        let mut scores: Vec<(usize, f32)> = self
            .vectors
            .iter()
            .enumerate()
            .map(|(i, v)| {
                let v_norm = norm(v);
                if v_norm < 1e-10 {
                    (i, 0.0)
                } else {
                    let dot: f32 = query.iter().zip(v.iter()).map(|(a, b)| a * b).sum();
                    (i, dot / (query_norm * v_norm))
                }
            })
            .collect();

        scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        scores.truncate(limit);
        scores
    }

    /// Get entry metadata by index
    pub fn entry(&self, idx: usize) -> Option<&VecEntry> {
        self.entries.get(idx)
    }

    /// Number of vectors stored
    pub fn len(&self) -> usize {
        self.vectors.len()
    }

    pub fn is_empty(&self) -> bool {
        self.vectors.is_empty()
    }

    /// Remove all vectors belonging to a specific path
    pub fn remove_path(&mut self, path: &str) {
        let mut i = 0;
        while i < self.entries.len() {
            if self.entries[i].path == path {
                self.entries.swap_remove(i);
                self.vectors.swap_remove(i);
            } else {
                i += 1;
            }
        }
    }

    /// Get all unique paths in the store
    pub fn paths(&self) -> std::collections::HashSet<String> {
        self.entries.iter().map(|e| e.path.clone()).collect()
    }
}

/// L2 norm of a vector
fn norm(v: &[f32]) -> f32 {
    v.iter().map(|x| x * x).sum::<f32>().sqrt()
}
