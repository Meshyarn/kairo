use anyhow::Result;
use ignore::WalkBuilder;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

/// Known code file extensions
const CODE_EXTENSIONS: &[&str] = &[
    "rs", "ts", "tsx", "js", "jsx", "py", "go", "java", "c", "cpp", "h", "hpp",
    "rb", "php", "swift", "kt", "scala", "zig", "lua", "sh", "bash", "zsh",
    "css", "scss", "html", "vue", "svelte", "sql", "proto", "toml", "yaml", "yml",
    "json", "xml", "md", "txt", "rst", "org",
];

/// Max file size to index (1MB)
const MAX_FILE_SIZE: u64 = 1_048_576;

pub struct SourceFile {
    pub path: PathBuf,
    pub relative_path: String,
    pub content: String,
    pub extension: String,
    pub is_code: bool,
    /// Fast content hash for change detection
    pub content_hash: u64,
}

/// Compute a fast hash of file content for change detection
pub fn hash_content(content: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    content.hash(&mut hasher);
    hasher.finish()
}

/// Walk a directory respecting .gitignore and return indexable files
pub fn walk_directory(root: &Path) -> Result<Vec<SourceFile>> {
    let mut files = Vec::new();

    let walker = WalkBuilder::new(root)
        .hidden(true) // skip hidden files
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            // Skip common non-source directories
            !matches!(
                name.as_ref(),
                "node_modules" | "target" | ".git" | ".archive" | "__pycache__" | ".venv"
                    | "vendor" | "dist" | "build" | ".next" | ".kairo"
            )
        })
        .build();

    for entry in walker {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        // Skip directories
        if !entry.file_type().map_or(false, |ft| ft.is_file()) {
            continue;
        }

        let path = entry.path();

        // Check file size
        if let Ok(meta) = path.metadata() {
            if meta.len() > MAX_FILE_SIZE {
                continue;
            }
        }

        // Get extension
        let extension = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        // Only index known file types
        if !CODE_EXTENSIONS.contains(&extension.as_str()) {
            continue;
        }

        // Read content
        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue, // skip binary/unreadable files
        };

        let relative_path = path
            .strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();

        let is_code = !matches!(extension.as_str(), "md" | "txt" | "rst" | "org");

        let content_hash = hash_content(&content);

        files.push(SourceFile {
            path: path.to_path_buf(),
            relative_path,
            content,
            extension,
            is_code,
            content_hash,
        });
    }

    Ok(files)
}
