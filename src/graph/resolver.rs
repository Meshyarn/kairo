use std::collections::HashSet;
use std::path::Path;

/// Resolve an import specifier to a relative file path within the project.
/// Returns None for external dependencies (npm packages, std library, etc.)
pub fn resolve_import(
    specifier: &str,
    source_file: &str,
    extension: &str,
    known_files: &HashSet<String>,
) -> Option<String> {
    match extension {
        "rs" => resolve_rust(specifier, source_file, known_files),
        "ts" | "tsx" | "js" | "jsx" | "mjs" => resolve_js_ts(specifier, source_file, known_files),
        "py" => resolve_python(specifier, source_file, known_files),
        "go" => resolve_go(specifier, known_files),
        "php" => resolve_php(specifier, source_file, known_files),
        _ => None,
    }
}

// --- Rust ---

fn resolve_rust(specifier: &str, source_file: &str, known_files: &HashSet<String>) -> Option<String> {
    if let Some(rest) = specifier.strip_prefix("crate::") {
        resolve_rust_module_path(rest, "src", known_files)
    } else if specifier.starts_with("super::") || specifier.starts_with("self::") {
        resolve_rust_relative(specifier, source_file, known_files)
    } else {
        // External crate
        None
    }
}

/// Resolve `self::` and `super::` relative imports.
///
/// Rust module hierarchy:
/// - `src/search/indexer.rs` = module `crate::search::indexer`
///   - `super::` → `crate::search` → dir `src/search/`
///   - `super::super::` → `crate` → dir `src/`
/// - `src/search/mod.rs` = module `crate::search`
///   - `super::` → `crate` → dir `src/`
fn resolve_rust_relative(
    specifier: &str,
    source_file: &str,
    known_files: &HashSet<String>,
) -> Option<String> {
    let source_dir = Path::new(source_file).parent()?;
    let filename = Path::new(source_file).file_name()?.to_str()?;
    // mod.rs/main.rs/lib.rs represent their directory as a module.
    // Regular files are submodules of their directory.
    let is_module_file = matches!(filename, "mod.rs" | "main.rs" | "lib.rs");

    if let Some(rest) = specifier.strip_prefix("self::") {
        // self:: refers to the current module's directory
        let base = source_dir.to_string_lossy();
        resolve_rust_module_path(rest, &base, known_files)
    } else {
        // super:: — navigate up the module tree
        let mut remaining = specifier;
        let mut base = source_dir.to_path_buf();

        if !is_module_file {
            // For regular files (e.g. indexer.rs), first super:: goes to parent module
            // which is the directory the file is in — no directory change needed
            remaining = remaining.strip_prefix("super::")?;
        }

        // Each remaining super:: goes up one directory
        while let Some(rest) = remaining.strip_prefix("super::") {
            base = base.parent()?.to_path_buf();
            remaining = rest;
        }

        let base_str = base.to_string_lossy();
        resolve_rust_module_path(remaining, &base_str, known_files)
    }
}

/// Resolve a `::` separated module path relative to a base directory
fn resolve_rust_module_path(
    path_part: &str,
    base_dir: &str,
    known_files: &HashSet<String>,
) -> Option<String> {
    let module_path = path_part.split("::").collect::<Vec<_>>();

    // Try progressively shorter paths (last segments may be types/functions)
    for len in (1..=module_path.len()).rev() {
        let segments = &module_path[..len];
        let last = segments.last().unwrap();
        if last.starts_with('{') || *last == "*" {
            continue;
        }

        let file_path = format!("{}/{}.rs", base_dir, segments.join("/"));
        if known_files.contains(&file_path) {
            return Some(file_path);
        }

        let mod_path = format!("{}/{}/mod.rs", base_dir, segments.join("/"));
        if known_files.contains(&mod_path) {
            return Some(mod_path);
        }
    }

    None
}

// --- TypeScript / JavaScript ---

fn resolve_js_ts(
    specifier: &str,
    source_file: &str,
    known_files: &HashSet<String>,
) -> Option<String> {
    // Only resolve relative imports
    if !specifier.starts_with('.') {
        return None;
    }

    let source_dir = Path::new(source_file)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let base = if source_dir.is_empty() {
        specifier.to_string()
    } else {
        format!("{}/{}", source_dir, specifier)
    };

    // Normalize path (resolve ../ and ./)
    let normalized = normalize_path(&base);

    // Try extensions in order
    let extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs"];
    let index_files = ["index.ts", "index.tsx", "index.js", "index.jsx"];

    // Direct file match
    if known_files.contains(&normalized) {
        return Some(normalized);
    }

    // Try adding extensions
    for ext in &extensions {
        let candidate = format!("{}{}", normalized, ext);
        if known_files.contains(&candidate) {
            return Some(candidate);
        }
    }

    // Try as directory with index file
    for idx in &index_files {
        let candidate = format!("{}/{}", normalized, idx);
        if known_files.contains(&candidate) {
            return Some(candidate);
        }
    }

    None
}

// --- Python ---

fn resolve_python(
    specifier: &str,
    source_file: &str,
    known_files: &HashSet<String>,
) -> Option<String> {
    // Relative imports (leading dots)
    if specifier.starts_with('.') {
        let dots = specifier.chars().take_while(|&c| c == '.').count();
        let rest = &specifier[dots..];

        let source_dir = Path::new(source_file).parent()?;
        let mut base = source_dir.to_path_buf();

        // Go up (dots - 1) directories (one dot = current package)
        for _ in 0..dots.saturating_sub(1) {
            base = base.parent()?.to_path_buf();
        }

        if rest.is_empty() {
            // `from . import foo` — refers to __init__.py in current dir
            let init = format!("{}/__init__.py", base.display());
            return known_files.contains(&init).then_some(init);
        }

        let module_path = rest.replace('.', "/");
        let file_path = format!("{}/{}.py", base.display(), module_path);
        if known_files.contains(&file_path) {
            return Some(file_path);
        }
        let pkg_path = format!("{}/{}/__init__.py", base.display(), module_path);
        if known_files.contains(&pkg_path) {
            return Some(pkg_path);
        }
        return None;
    }

    // Absolute imports — try mapping to file
    let module_path = specifier.replace('.', "/");

    let file_path = format!("{}.py", module_path);
    if known_files.contains(&file_path) {
        return Some(file_path);
    }
    let pkg_path = format!("{}/__init__.py", module_path);
    if known_files.contains(&pkg_path) {
        return Some(pkg_path);
    }

    // Try with src/ prefix
    let file_path = format!("src/{}.py", module_path);
    if known_files.contains(&file_path) {
        return Some(file_path);
    }

    None
}

// --- Go ---

fn resolve_go(specifier: &str, known_files: &HashSet<String>) -> Option<String> {
    // Standard library and most external packages can't be resolved to project files.
    // Only resolve if the import path maps to a directory inside the project.
    // This is a best-effort heuristic: try the last N segments of the path as a directory.

    let segments: Vec<&str> = specifier.split('/').collect();

    // Try progressively shorter suffixes
    for start in 0..segments.len() {
        let dir = segments[start..].join("/");
        // Check if any known file lives in this directory
        let prefix = format!("{}/", dir);
        if known_files.iter().any(|f| f.starts_with(&prefix)) {
            // Found a matching directory — return its "main" .go file if any
            // In Go, the package is the directory. Return any .go file as representative.
            if let Some(go_file) = known_files.iter().find(|f| {
                f.starts_with(&prefix) && f.ends_with(".go") && !f.contains('/')
                    || (f.starts_with(&prefix)
                        && f.ends_with(".go")
                        && f[prefix.len()..].chars().filter(|&c| c == '/').count() == 0)
            }) {
                return Some(go_file.clone());
            }
        }
    }

    None
}

// --- PHP ---

fn resolve_php(
    specifier: &str,
    source_file: &str,
    known_files: &HashSet<String>,
) -> Option<String> {
    // File-path imports: require/include with relative or absolute paths
    if specifier.ends_with(".php") {
        if specifier.starts_with('.') {
            // Relative path
            let source_dir = Path::new(source_file).parent()?;
            let base = format!("{}/{}", source_dir.display(), specifier);
            let normalized = normalize_path(&base);
            if known_files.contains(&normalized) {
                return Some(normalized);
            }
        } else {
            // Direct path
            if known_files.contains(specifier) {
                return Some(specifier.to_string());
            }
        }
        return None;
    }

    // PSR-4 namespace: App\Models\User → app/Models/User.php or src/Models/User.php
    let path_part = specifier.replace('\\', "/");
    let segments: Vec<&str> = path_part.split('/').collect();

    // Try with and without common root prefixes
    let prefixes = ["", "src/", "app/", "lib/"];
    for prefix in &prefixes {
        // Try full path
        let candidate = format!("{}{}.php", prefix, segments.join("/"));
        if known_files.contains(&candidate) {
            return Some(candidate);
        }
        // Try skipping first segment (namespace root like "App")
        if segments.len() > 1 {
            let candidate = format!("{}{}.php", prefix, segments[1..].join("/"));
            if known_files.contains(&candidate) {
                return Some(candidate);
            }
        }
    }

    None
}

/// Normalize a path by resolving `.` and `..` segments
fn normalize_path(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for segment in path.split('/') {
        match segment {
            "." | "" => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    parts.join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn files(paths: &[&str]) -> HashSet<String> {
        paths.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn test_rust_crate_import() {
        let known = files(&["src/common/fs.rs", "src/search/indexer.rs", "src/search/mod.rs"]);
        assert_eq!(
            resolve_import("crate::common::fs", "src/main.rs", "rs", &known),
            Some("src/common/fs.rs".to_string())
        );
        assert_eq!(
            resolve_import("crate::search::indexer::SearchIndex", "src/main.rs", "rs", &known),
            Some("src/search/indexer.rs".to_string())
        );
    }

    #[test]
    fn test_rust_external_crate() {
        let known = files(&["src/main.rs"]);
        assert_eq!(resolve_import("anyhow::{Context, Result}", "src/main.rs", "rs", &known), None);
        assert_eq!(resolve_import("std::collections::HashMap", "src/main.rs", "rs", &known), None);
    }

    #[test]
    fn test_js_relative_import() {
        let known = files(&["src/utils.ts", "src/components/Button.tsx", "src/components/index.ts"]);
        assert_eq!(
            resolve_import("./utils", "src/app.ts", "ts", &known),
            Some("src/utils.ts".to_string())
        );
        assert_eq!(
            resolve_import("./components/Button", "src/app.ts", "ts", &known),
            Some("src/components/Button.tsx".to_string())
        );
        assert_eq!(
            resolve_import("./components", "src/app.ts", "ts", &known),
            Some("src/components/index.ts".to_string())
        );
    }

    #[test]
    fn test_js_bare_import() {
        let known = files(&["src/app.ts"]);
        assert_eq!(resolve_import("react", "src/app.ts", "ts", &known), None);
        assert_eq!(resolve_import("lodash/merge", "src/app.ts", "ts", &known), None);
    }

    #[test]
    fn test_rust_self_import() {
        let known = files(&["src/search/query.rs", "src/search/mod.rs"]);
        assert_eq!(
            resolve_import("self::query", "src/search/mod.rs", "rs", &known),
            Some("src/search/query.rs".to_string())
        );
        assert_eq!(
            resolve_import("self::query::SearchResult", "src/search/mod.rs", "rs", &known),
            Some("src/search/query.rs".to_string())
        );
    }

    #[test]
    fn test_rust_super_import() {
        let known = files(&["src/common/fs.rs", "src/search/query.rs", "src/search/indexer.rs"]);
        // super:: from indexer.rs (regular file) → parent module = search dir
        // super::query from indexer.rs → crate::search::query → src/search/query.rs
        assert_eq!(
            resolve_import("super::query", "src/search/indexer.rs", "rs", &known),
            Some("src/search/query.rs".to_string())
        );
        // super:: from mod.rs → parent module = src/
        // super::common::fs from src/search/mod.rs → crate::common::fs → src/common/fs.rs
        assert_eq!(
            resolve_import("super::common::fs", "src/search/mod.rs", "rs", &known),
            Some("src/common/fs.rs".to_string())
        );
    }

    #[test]
    fn test_rust_super_from_root() {
        let known = files(&["src/main.rs"]);
        // super:: from main.rs (module file at crate root) — no parent
        assert_eq!(
            resolve_import("super::something", "src/main.rs", "rs", &known),
            None
        );
    }

    #[test]
    fn test_rust_chained_super() {
        let known = files(&["src/common/fs.rs", "src/search/deep/nested.rs"]);
        // nested.rs (regular file): first super:: → src/search/deep/, second → src/search/, third → src/
        // But the specifier is super::super::common::fs:
        // 1st super:: (free for regular file) → src/search/deep/
        // 2nd super:: → src/search/
        // Then common::fs → src/search/common/fs.rs — doesn't exist
        // Need 3 supers to reach src/: super::super::super::common::fs
        assert_eq!(
            resolve_import("super::super::super::common::fs", "src/search/deep/nested.rs", "rs", &known),
            Some("src/common/fs.rs".to_string())
        );
        // With only 2 supers, reaches src/search/ — no common/fs.rs there
        assert_eq!(
            resolve_import("super::super::common::fs", "src/search/deep/nested.rs", "rs", &known),
            None
        );
    }

    #[test]
    fn test_php_namespace_import() {
        let known = files(&["src/Models/User.php", "src/Services/Auth.php"]);
        assert_eq!(
            resolve_import(r"App\Models\User", "src/Controllers/HomeController.php", "php", &known),
            Some("src/Models/User.php".to_string())
        );
    }

    #[test]
    fn test_php_file_import() {
        let known = files(&["vendor/autoload.php", "helpers.php"]);
        assert_eq!(
            resolve_import("vendor/autoload.php", "index.php", "php", &known),
            Some("vendor/autoload.php".to_string())
        );
        assert_eq!(
            resolve_import("./helpers.php", "src/app.php", "php", &known),
            None // ./helpers.php from src/ = src/helpers.php which doesn't exist
        );
    }

    #[test]
    fn test_python_relative() {
        let known = files(&["myapp/utils.py", "myapp/__init__.py"]);
        assert_eq!(
            resolve_import(".utils", "myapp/main.py", "py", &known),
            Some("myapp/utils.py".to_string())
        );
        assert_eq!(
            resolve_import(".", "myapp/main.py", "py", &known),
            Some("myapp/__init__.py".to_string())
        );
    }

    #[test]
    fn test_python_absolute() {
        let known = files(&["myapp/utils.py"]);
        assert_eq!(
            resolve_import("myapp.utils", "main.py", "py", &known),
            Some("myapp/utils.py".to_string())
        );
        assert_eq!(resolve_import("os", "main.py", "py", &known), None);
    }
}
