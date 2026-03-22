/// A chunk of file content suitable for embedding
pub struct Chunk {
    pub text: String,
    /// Byte offset in the original file
    pub offset: u32,
    /// Byte length in the original file
    pub len: u32,
}

/// Split file content into chunks for embedding.
///
/// Strategy: split on double-newline boundaries (paragraph/function gaps),
/// then merge adjacent short chunks to reach ~512 token target.
/// No AST parsing — works across all languages.
const TARGET_TOKENS: usize = 512;
const MAX_TOKENS: usize = 1024;

/// Rough token count estimate (1 token ≈ 4 bytes for code)
fn estimate_tokens(text: &str) -> usize {
    text.len() / 4
}

pub fn chunk_file(content: &str) -> Vec<Chunk> {
    if content.is_empty() {
        return Vec::new();
    }

    // If the entire file fits in one chunk, return it whole
    if estimate_tokens(content) <= MAX_TOKENS {
        return vec![Chunk {
            text: content.to_string(),
            offset: 0,
            len: content.len() as u32,
        }];
    }

    // Split on double-newline boundaries
    let paragraphs = split_paragraphs(content);

    // Merge small paragraphs into target-sized chunks
    let mut chunks = Vec::new();
    let mut current_text = String::new();
    let mut current_offset: usize = 0;
    let mut chunk_start: usize = 0;

    for (para_text, para_offset) in &paragraphs {
        let para_tokens = estimate_tokens(para_text);
        let current_tokens = estimate_tokens(&current_text);

        // If adding this paragraph would exceed MAX, flush current chunk
        if !current_text.is_empty() && current_tokens + para_tokens > MAX_TOKENS {
            chunks.push(Chunk {
                text: current_text.clone(),
                offset: chunk_start as u32,
                len: (current_offset - chunk_start) as u32,
            });
            current_text.clear();
            chunk_start = *para_offset;
        }

        // If this single paragraph exceeds MAX, split it by lines
        if para_tokens > MAX_TOKENS {
            if !current_text.is_empty() {
                chunks.push(Chunk {
                    text: current_text.clone(),
                    offset: chunk_start as u32,
                    len: (current_offset - chunk_start) as u32,
                });
                current_text.clear();
            }

            // Hard split by lines
            let sub_chunks = split_long_paragraph(para_text, *para_offset);
            chunks.extend(sub_chunks);
            chunk_start = para_offset + para_text.len();
            current_offset = chunk_start;
            continue;
        }

        if current_text.is_empty() {
            chunk_start = *para_offset;
        } else {
            current_text.push_str("\n\n");
        }
        current_text.push_str(para_text);
        current_offset = para_offset + para_text.len();

        // If we've reached the target, flush
        if estimate_tokens(&current_text) >= TARGET_TOKENS {
            chunks.push(Chunk {
                text: current_text.clone(),
                offset: chunk_start as u32,
                len: (current_offset - chunk_start) as u32,
            });
            current_text.clear();
            chunk_start = current_offset;
        }
    }

    // Flush remaining
    if !current_text.is_empty() {
        chunks.push(Chunk {
            text: current_text,
            offset: chunk_start as u32,
            len: (current_offset - chunk_start) as u32,
        });
    }

    chunks
}

/// Split content into paragraphs on double-newline boundaries.
/// Returns (text, byte_offset) pairs.
fn split_paragraphs(content: &str) -> Vec<(String, usize)> {
    let mut result = Vec::new();
    let mut start = 0;

    for (i, _) in content.match_indices("\n\n") {
        let text = content[start..i].trim();
        if !text.is_empty() {
            result.push((text.to_string(), start));
        }
        start = i + 2;
    }

    // Last paragraph
    let text = content[start..].trim();
    if !text.is_empty() {
        result.push((text.to_string(), start));
    }

    result
}

/// Split an oversized paragraph into line-based chunks
fn split_long_paragraph(text: &str, base_offset: usize) -> Vec<Chunk> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut chunk_start = 0;
    let mut pos = 0;

    for line in text.lines() {
        let line_tokens = estimate_tokens(line);
        let current_tokens = estimate_tokens(&current);

        if !current.is_empty() && current_tokens + line_tokens > MAX_TOKENS {
            chunks.push(Chunk {
                text: current.clone(),
                offset: (base_offset + chunk_start) as u32,
                len: (pos - chunk_start) as u32,
            });
            current.clear();
            chunk_start = pos;
        }

        if !current.is_empty() {
            current.push('\n');
        }
        current.push_str(line);
        pos += line.len() + 1; // +1 for newline
    }

    if !current.is_empty() {
        chunks.push(Chunk {
            text: current,
            offset: (base_offset + chunk_start) as u32,
            len: (pos.saturating_sub(1) - chunk_start) as u32,
        });
    }

    chunks
}
