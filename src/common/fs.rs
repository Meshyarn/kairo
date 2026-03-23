use anyhow::Result;
use ignore::WalkBuilder;
use std::path::{Path, PathBuf};

/// Known code file extensions
pub const CODE_EXTENSIONS: &[&str] = &[
    "rs", "ts", "tsx", "js", "jsx", "mjs", "py", "go", "java", "c", "cpp", "h", "hpp",
    "rb", "php", "swift", "kt", "scala", "zig", "lua", "sh", "bash", "zsh",
    "css", "scss", "html", "vue", "svelte", "sql", "proto", "toml", "yaml", "yml",
    "json", "xml", "md", "txt", "rst", "org",
];

/// Max file size to index (1MB)
pub const MAX_FILE_SIZE: u64 = 1_048_576;

/// Directories to always skip during walks
pub const SKIP_DIRS: &[&str] = &[
    "node_modules", "target", ".git", ".archive", "__pycache__", ".venv",
    "vendor", "dist", "build", ".next", ".kairo",
];

pub struct SourceFile {
    pub path: PathBuf,
    pub relative_path: String,
    pub content: String,
    pub extension: String,
    pub is_code: bool,
    /// Fast content hash for change detection
    pub content_hash: u64,
}

/// Compute a stable hash of file content for change detection.
/// Uses FNV-1a which is deterministic across Rust versions and platforms,
/// unlike `DefaultHasher` which is not guaranteed to be stable.
pub fn hash_content(content: &str) -> u64 {
    const FNV_OFFSET: u64 = 14695981039346656037;
    const FNV_PRIME: u64 = 1099511628211;
    let mut hash = FNV_OFFSET;
    for byte in content.bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
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
            !SKIP_DIRS.contains(&name.as_ref())
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

/// Read a single file as a SourceFile, applying the same filters as walk_directory.
/// Returns None if the file doesn't qualify (wrong extension, too big, unreadable).
pub fn read_source_file(root: &Path, relative_path: &str) -> Option<SourceFile> {
    let full_path = root.join(relative_path);

    // Check that file exists and is a file
    let meta = std::fs::metadata(&full_path).ok()?;
    if !meta.is_file() || meta.len() > MAX_FILE_SIZE {
        return None;
    }

    let extension = full_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if !CODE_EXTENSIONS.contains(&extension.as_str()) {
        return None;
    }

    let content = std::fs::read_to_string(&full_path).ok()?;
    let is_code = !matches!(extension.as_str(), "md" | "txt" | "rst" | "org");
    let content_hash = hash_content(&content);

    Some(SourceFile {
        path: full_path,
        relative_path: relative_path.to_string(),
        content,
        extension,
        is_code,
        content_hash,
    })
}

/// Check if a path component is in the skip list
pub fn should_skip_path(relative_path: &str) -> bool {
    relative_path
        .split('/')
        .any(|component| SKIP_DIRS.contains(&component))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs as stdfs;

    #[test]
    fn test_should_skip_path() {
        assert!(should_skip_path("node_modules/react/index.js"));
        assert!(should_skip_path("src/.git/config"));
        assert!(should_skip_path("project/target/release/binary"));
        assert!(should_skip_path(".kairo/index/data"));
        assert!(!should_skip_path("src/main.rs"));
        assert!(!should_skip_path("lib/utils.ts"));
    }

    #[test]
    fn test_hash_content_deterministic() {
        let h1 = hash_content("hello world");
        let h2 = hash_content("hello world");
        let h3 = hash_content("hello world!");
        assert_eq!(h1, h2);
        assert_ne!(h1, h3);
    }

    #[test]
    fn test_read_source_file_valid() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("test.rs");
        stdfs::write(&file_path, "fn main() {}").unwrap();

        let result = read_source_file(dir.path(), "test.rs");
        assert!(result.is_some());
        let sf = result.unwrap();
        assert_eq!(sf.relative_path, "test.rs");
        assert_eq!(sf.extension, "rs");
        assert!(sf.is_code);
        assert_eq!(sf.content, "fn main() {}");
    }

    #[test]
    fn test_read_source_file_unknown_extension() {
        let dir = tempfile::tempdir().unwrap();
        stdfs::write(dir.path().join("data.bin"), "binary stuff").unwrap();

        assert!(read_source_file(dir.path(), "data.bin").is_none());
    }

    #[test]
    fn test_read_source_file_nonexistent() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_source_file(dir.path(), "nope.rs").is_none());
    }

    #[test]
    fn test_read_source_file_markdown_is_docs() {
        let dir = tempfile::tempdir().unwrap();
        stdfs::write(dir.path().join("README.md"), "# Hello").unwrap();

        let result = read_source_file(dir.path(), "README.md").unwrap();
        assert!(!result.is_code);
        assert_eq!(result.extension, "md");
    }

    #[test]
    fn test_walk_directory_finds_rust_files() {
        let dir = tempfile::tempdir().unwrap();
        stdfs::create_dir_all(dir.path().join("src")).unwrap();
        stdfs::write(dir.path().join("src/main.rs"), "fn main() {}").unwrap();
        stdfs::write(dir.path().join("src/lib.rs"), "pub mod foo;").unwrap();
        stdfs::write(dir.path().join("data.bin"), "not a source file").unwrap();

        let files = walk_directory(dir.path()).unwrap();
        let paths: Vec<&str> = files.iter().map(|f| f.relative_path.as_str()).collect();
        assert!(paths.contains(&"src/main.rs"));
        assert!(paths.contains(&"src/lib.rs"));
        assert!(!paths.iter().any(|p| p.contains("data.bin")));
    }
}
