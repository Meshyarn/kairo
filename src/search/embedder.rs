use anyhow::{Context, Result};
use ort::session::Session;
use ort::value::Tensor;
use std::path::{Path, PathBuf};
use tokenizers::Tokenizer;

/// Embedding dimension for bge-small-en-v1.5
pub const EMBED_DIM: usize = 384;

/// Maximum token length
const MAX_TOKENS: usize = 512;

/// State of the embedding model
#[derive(Debug)]
pub enum EmbedderState {
    Unavailable,
    Ready(Embedder),
}

/// bge-small-en-v1.5 embedding model via ONNX Runtime
pub struct Embedder {
    session: Session,
    tokenizer: Tokenizer,
}

impl std::fmt::Debug for Embedder {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Embedder").finish()
    }
}

impl Embedder {
    pub fn load(model_dir: &Path) -> Result<Self> {
        // Accept either model.onnx or model_quantized.onnx
        let model_path = if model_dir.join("model.onnx").exists() {
            model_dir.join("model.onnx")
        } else if model_dir.join("model_quantized.onnx").exists() {
            model_dir.join("model_quantized.onnx")
        } else {
            anyhow::bail!("No ONNX model found in {}", model_dir.display());
        };
        let tokenizer_path = model_dir.join("tokenizer.json");
        if !tokenizer_path.exists() {
            anyhow::bail!("tokenizer.json not found in {}", model_dir.display());
        }

        tracing::info!("Loading ONNX model from {}", model_path.display());

        // CoreML disabled — overhead exceeds gains for small models (32MB)
        // CPU with ORT graph optimization is faster for bge-small
        let session = Session::builder()
            .map_err(|e| anyhow::anyhow!("create ONNX session builder: {}", e))?
            .with_optimization_level(ort::session::builder::GraphOptimizationLevel::Level3)
            .map_err(|e| anyhow::anyhow!("set optimization level: {}", e))?
            .with_intra_threads(4)
            .map_err(|e| anyhow::anyhow!("set intra threads: {}", e))?
            .commit_from_file(&model_path)
            .map_err(|e| anyhow::anyhow!("load ONNX model: {}", e))?;

        tracing::info!("Loading tokenizer from {}", tokenizer_path.display());
        let tokenizer = Tokenizer::from_file(&tokenizer_path)
            .map_err(|e| anyhow::anyhow!("load tokenizer: {}", e))?;

        tracing::info!("Embedder ready (bge-small-en-v1.5, dim={})", EMBED_DIM);
        Ok(Self { session, tokenizer })
    }

    /// Embed a search query
    pub fn embed(&mut self, text: &str) -> Result<Vec<f32>> {
        let batch = self.embed_batch(&[text])?;
        Ok(batch.into_iter().next().unwrap())
    }

    /// Embed a batch of document passages
    pub fn embed_batch(&mut self, texts: &[&str]) -> Result<Vec<Vec<f32>>> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }

        let batch_size = texts.len();

        let encodings: Vec<_> = texts
            .iter()
            .map(|t| {
                self.tokenizer
                    .encode(*t, true)
                    .map_err(|e| anyhow::anyhow!("tokenize: {}", e))
            })
            .collect::<Result<Vec<_>>>()?;

        let max_len = encodings
            .iter()
            .map(|e| e.get_ids().len().min(MAX_TOKENS))
            .max()
            .unwrap_or(0);

        if max_len == 0 {
            return Ok(vec![vec![0.0; EMBED_DIM]; batch_size]);
        }

        let mut input_ids = vec![0i64; batch_size * max_len];
        let mut attention_mask = vec![0i64; batch_size * max_len];
        let mut token_type_ids = vec![0i64; batch_size * max_len];

        for (i, encoding) in encodings.iter().enumerate() {
            let ids = encoding.get_ids();
            let mask = encoding.get_attention_mask();
            let type_ids = encoding.get_type_ids();
            let len = ids.len().min(max_len);

            for j in 0..len {
                input_ids[i * max_len + j] = ids[j] as i64;
                attention_mask[i * max_len + j] = mask[j] as i64;
                token_type_ids[i * max_len + j] = type_ids[j] as i64;
            }
        }

        let shape = vec![batch_size as i64, max_len as i64];
        let ids_tensor = Tensor::from_array((shape.clone(), input_ids.clone().into_boxed_slice()))
            .map_err(|e| anyhow::anyhow!("create input_ids tensor: {}", e))?;
        let mask_tensor = Tensor::from_array((shape.clone(), attention_mask.clone().into_boxed_slice()))
            .map_err(|e| anyhow::anyhow!("create attention_mask tensor: {}", e))?;
        let type_tensor = Tensor::from_array((shape.clone(), token_type_ids.into_boxed_slice()))
            .map_err(|e| anyhow::anyhow!("create token_type_ids tensor: {}", e))?;

        let inputs = ort::inputs! {
            "input_ids" => ids_tensor,
            "attention_mask" => mask_tensor,
            "token_type_ids" => type_tensor
        };
        let outputs = self
            .session
            .run(inputs)
            .map_err(|e| anyhow::anyhow!("ONNX inference: {}", e))?;

        let (output_shape, data) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|e| anyhow::anyhow!("extract output tensor: {}", e))?;

        if output_shape.len() != 3 {
            anyhow::bail!("unexpected output shape: {:?}", &*output_shape);
        }
        let seq_len_out = output_shape[1] as usize;
        let hidden_dim = output_shape[2] as usize;

        // Mean pooling with attention mask, then L2 normalize
        let mut results = Vec::with_capacity(batch_size);
        for i in 0..batch_size {
            let mut embedding = vec![0.0f32; hidden_dim];
            let mut total_weight = 0.0f32;

            for j in 0..seq_len_out {
                let mask_idx = j.min(max_len - 1);
                let mask_val = attention_mask[i * max_len + mask_idx] as f32;
                if mask_val > 0.0 {
                    let offset = i * seq_len_out * hidden_dim + j * hidden_dim;
                    for k in 0..hidden_dim {
                        embedding[k] += data[offset + k] * mask_val;
                    }
                    total_weight += mask_val;
                }
            }

            if total_weight > 0.0 {
                for v in &mut embedding {
                    *v /= total_weight;
                }
            }

            let norm: f32 = embedding.iter().map(|x| x * x).sum::<f32>().sqrt();
            if norm > 1e-10 {
                for v in &mut embedding {
                    *v /= norm;
                }
            }

            results.push(embedding);
        }

        Ok(results)
    }
}

pub fn try_load_embedder() -> Result<EmbedderState> {
    // Try bundled model first (next to binary), then user-local cache
    let model_dir = find_model_dir()?;

    match model_dir {
        Some(dir) => match Embedder::load(&dir) {
            Ok(embedder) => Ok(EmbedderState::Ready(embedder)),
            Err(e) => {
                tracing::warn!("Failed to load embedding model: {}. Falling back to BM25-only.", e);
                Ok(EmbedderState::Unavailable)
            }
        },
        None => {
            tracing::info!("Embedding model not found. Running in BM25-only mode. Use `kairo_status action=download-model` to enable hybrid search.");
            Ok(EmbedderState::Unavailable)
        }
    }
}

/// Search for model files in multiple locations
fn find_model_dir() -> Result<Option<PathBuf>> {
    let model_subdir = "bge-small-en-v1.5";

    // 1. Bundled: models/ next to the binary
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let bundled = exe_dir.join("models").join(model_subdir);
            if has_model_files(&bundled) {
                tracing::info!("Using bundled model at {}", bundled.display());
                return Ok(Some(bundled));
            }
            // Also check one level up (for cargo run from target/release/)
            if let Some(parent) = exe_dir.parent() {
                if let Some(grandparent) = parent.parent() {
                    let bundled = grandparent.join("models").join(model_subdir);
                    if has_model_files(&bundled) {
                        tracing::info!("Using bundled model at {}", bundled.display());
                        return Ok(Some(bundled));
                    }
                }
            }
        }
    }

    // 2. User-local: ~/.kairo/models/
    let user_dir = default_model_dir()?;
    if has_model_files(&user_dir) {
        return Ok(Some(user_dir));
    }

    Ok(None)
}

fn has_model_files(dir: &Path) -> bool {
    // Accept either model.onnx or model_quantized.onnx
    let has_model = dir.join("model.onnx").exists() || dir.join("model_quantized.onnx").exists();
    let has_tokenizer = dir.join("tokenizer.json").exists();
    has_model && has_tokenizer
}

/// Download bge-small-en-v1.5 int8 quantized model from HuggingFace
pub async fn download_model() -> Result<PathBuf> {
    let model_dir = default_model_dir()?;
    std::fs::create_dir_all(&model_dir).context("create model directory")?;

    tracing::info!(
        "Downloading bge-small-en-v1.5 (int8, ~32MB) from HuggingFace to {}",
        model_dir.display()
    );

    let api = hf_hub::api::tokio::ApiBuilder::new()
        .build()
        .context("create HuggingFace API")?;

    let repo = api.model("Xenova/bge-small-en-v1.5".to_string());

    tracing::info!("Downloading model_quantized.onnx (~32MB)...");
    let model_path = repo
        .get("onnx/model_quantized.onnx")
        .await
        .context("download model_quantized.onnx")?;

    tracing::info!("Downloading tokenizer.json...");
    let tokenizer_path = repo
        .get("tokenizer.json")
        .await
        .context("download tokenizer.json")?;

    let target_model = model_dir.join("model.onnx");
    let target_tokenizer = model_dir.join("tokenizer.json");

    std::fs::copy(&model_path, &target_model).context("copy model.onnx")?;
    std::fs::copy(&tokenizer_path, &target_tokenizer).context("copy tokenizer.json")?;

    tracing::info!("Model download complete.");
    Ok(model_dir)
}

/// Default model directory: ~/.kairo/models/bge-small-en-v1.5/
fn default_model_dir() -> Result<PathBuf> {
    let home = dirs::home_dir().context("cannot determine home directory")?;
    Ok(home.join(".kairo").join("models").join("bge-small-en-v1.5"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_has_model_files_empty_dir() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!has_model_files(dir.path()));
    }

    #[test]
    fn test_has_model_files_with_quantized() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("model_quantized.onnx"), "fake").unwrap();
        std::fs::write(dir.path().join("tokenizer.json"), "{}").unwrap();
        assert!(has_model_files(dir.path()));
    }

    #[test]
    fn test_has_model_files_with_regular() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("model.onnx"), "fake").unwrap();
        std::fs::write(dir.path().join("tokenizer.json"), "{}").unwrap();
        assert!(has_model_files(dir.path()));
    }

    #[test]
    fn test_has_model_files_missing_tokenizer() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("model.onnx"), "fake").unwrap();
        assert!(!has_model_files(dir.path()));
    }

    #[test]
    fn test_find_model_dir_returns_some_if_available() {
        // This test checks that find_model_dir doesn't panic
        // Result depends on whether model is installed
        let result = find_model_dir();
        assert!(result.is_ok());
    }

    #[test]
    fn test_try_load_embedder_doesnt_panic() {
        // Just ensure it returns a valid state, not a panic
        let result = try_load_embedder();
        assert!(result.is_ok());
    }
}
