use napi::bindgen_prelude::Result;
use napi_derive::napi;
use tokenizers::Tokenizer;

#[napi(object)]
pub struct ChunkResult {
    pub text: String,
    pub start_byte: u32,
    pub end_byte: u32,
    pub start_token: u32,
    pub end_token: u32,
}

#[napi]
pub struct SmartChunker {
    tokenizer: Tokenizer,
}

#[napi]
impl SmartChunker {
    #[napi(constructor)]
    pub fn new(model_path: String) -> Result<Self> {
        let tokenizer = Tokenizer::from_file(model_path).map_err(|error| {
            napi::Error::from_reason(format!("failed to load tokenizer: {error}"))
        })?;
        Ok(Self { tokenizer })
    }

    #[napi]
    pub fn chunk(&self, text: String, max_tokens: u32, overlap: u32) -> Result<Vec<ChunkResult>> {
        if text.is_empty() || max_tokens == 0 {
            return Ok(Vec::new());
        }
        let encoding = self.tokenizer.encode(text.as_str(), true).map_err(|error| {
            napi::Error::from_reason(format!("failed to encode text: {error}"))
        })?;
        let offsets = encoding.get_offsets();
        if offsets.is_empty() {
            return Ok(Vec::new());
        }

        let max_tokens_usize = max_tokens as usize;
        let overlap_usize = overlap as usize;
        let step = if max_tokens_usize > overlap_usize {
            max_tokens_usize - overlap_usize
        } else {
            1
        };

        let mut out: Vec<ChunkResult> = Vec::new();
        let mut start = 0usize;
        let token_count = offsets.len();

        while start < token_count {
            let end = usize::min(start + max_tokens_usize, token_count);
            if end <= start {
                break;
            }
            let (start_byte, _) = offsets[start];
            let (_, end_byte) = offsets[end - 1];
            if end_byte > start_byte && end_byte <= text.len() {
                let slice = &text[start_byte..end_byte];
                out.push(ChunkResult {
                    text: slice.to_string(),
                    start_byte: start_byte as u32,
                    end_byte: end_byte as u32,
                    start_token: start as u32,
                    end_token: end as u32,
                });
            }
            if end == token_count {
                break;
            }
            start = start.saturating_add(step);
        }

        Ok(out)
    }
}
