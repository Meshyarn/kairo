use regex::Regex;
use std::sync::OnceLock;

/// A raw import extracted from source code
#[derive(Debug, Clone)]
pub struct RawImport {
    /// The import specifier (e.g. "react", "./utils", "crate::common::fs")
    pub specifier: String,
    /// What kind of import statement (used for diagnostics/filtering)
    #[allow(dead_code)]
    pub kind: ImportKind,
}

#[derive(Debug, Clone, Copy, PartialEq)]
#[allow(dead_code)]
pub enum ImportKind {
    /// Rust `use`, Go `import`, PHP `use`
    Use,
    /// JS/TS `import ... from`, Python `from ... import`
    From,
    /// JS `require(...)`, PHP `require/include`
    Require,
}

/// Extract import statements from source code based on file extension
pub fn extract_imports(content: &str, extension: &str) -> Vec<RawImport> {
    match extension {
        "rs" => extract_rust(content),
        "ts" | "tsx" | "js" | "jsx" | "mjs" => extract_js_ts(content),
        "py" => extract_python(content),
        "go" => extract_go(content),
        "php" => extract_php(content),
        _ => Vec::new(),
    }
}

// --- Rust ---

fn rust_use_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?m)^\s*use\s+((?:crate|super|self|[a-zA-Z_]\w*)(?:::\w+)*(?:::\{[^}]+\}|::\*)?)").unwrap()
    })
}

fn extract_rust(content: &str) -> Vec<RawImport> {
    let re = rust_use_re();
    re.captures_iter(content)
        .map(|cap| RawImport {
            specifier: cap[1].to_string(),
            kind: ImportKind::Use,
        })
        .collect()
}

// --- TypeScript / JavaScript ---

fn js_import_from_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // Handles multi-line imports: import {\n  foo,\n  bar\n} from 'x'
        Regex::new(r#"(?ms)^\s*import\s+.*?from\s+["']([^"']+)["']"#).unwrap()
    })
}

fn js_import_side_effect_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"(?m)^\s*import\s+["']([^"']+)["']"#).unwrap()
    })
}

fn js_require_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"require\s*\(\s*["']([^"']+)["']\s*\)"#).unwrap()
    })
}

fn js_export_from_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"(?m)^\s*export\s+.*?\s+from\s+["']([^"']+)["']"#).unwrap()
    })
}

fn js_dynamic_import_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // import('./foo') or import("./foo")
        Regex::new(r#"import\s*\(\s*["']([^"']+)["']\s*\)"#).unwrap()
    })
}

fn extract_js_ts(content: &str) -> Vec<RawImport> {
    let mut imports = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for cap in js_import_from_re().captures_iter(content) {
        let spec = cap[1].to_string();
        if seen.insert(spec.clone()) {
            imports.push(RawImport { specifier: spec, kind: ImportKind::From });
        }
    }

    for cap in js_import_side_effect_re().captures_iter(content) {
        let spec = cap[1].to_string();
        if seen.insert(spec.clone()) {
            imports.push(RawImport { specifier: spec, kind: ImportKind::From });
        }
    }

    for cap in js_require_re().captures_iter(content) {
        let spec = cap[1].to_string();
        if seen.insert(spec.clone()) {
            imports.push(RawImport { specifier: spec, kind: ImportKind::Require });
        }
    }

    for cap in js_export_from_re().captures_iter(content) {
        let spec = cap[1].to_string();
        if seen.insert(spec.clone()) {
            imports.push(RawImport { specifier: spec, kind: ImportKind::From });
        }
    }

    for cap in js_dynamic_import_re().captures_iter(content) {
        let spec = cap[1].to_string();
        if seen.insert(spec.clone()) {
            imports.push(RawImport { specifier: spec, kind: ImportKind::Require });
        }
    }

    imports
}

// --- Python ---

fn py_import_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?m)^\s*import\s+([\w.]+)").unwrap()
    })
}

fn py_from_import_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?m)^\s*from\s+(\.{0,3}[\w.]*)[\s]+import").unwrap()
    })
}

fn extract_python(content: &str) -> Vec<RawImport> {
    let mut imports = Vec::new();

    for cap in py_import_re().captures_iter(content) {
        imports.push(RawImport {
            specifier: cap[1].to_string(),
            kind: ImportKind::Use,
        });
    }

    for cap in py_from_import_re().captures_iter(content) {
        imports.push(RawImport {
            specifier: cap[1].to_string(),
            kind: ImportKind::From,
        });
    }

    imports
}

// --- Go ---

fn go_single_import_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"(?m)^\s*import\s+(?:\w+\s+)?"([^"]+)""#).unwrap()
    })
}

fn go_multi_import_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"(?ms)import\s*\((.*?)\)"#).unwrap()
    })
}

fn go_import_line_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"(?:\w+\s+)?"([^"]+)""#).unwrap()
    })
}

fn extract_go(content: &str) -> Vec<RawImport> {
    let mut imports = Vec::new();
    let mut seen = std::collections::HashSet::new();

    // Multi-import blocks: import ( ... )
    for block in go_multi_import_re().captures_iter(content) {
        for cap in go_import_line_re().captures_iter(&block[1]) {
            let spec = cap[1].to_string();
            if seen.insert(spec.clone()) {
                imports.push(RawImport {
                    specifier: spec,
                    kind: ImportKind::Use,
                });
            }
        }
    }

    // Single imports: import "foo"
    for cap in go_single_import_re().captures_iter(content) {
        let spec = cap[1].to_string();
        if seen.insert(spec.clone()) {
            imports.push(RawImport {
                specifier: spec,
                kind: ImportKind::Use,
            });
        }
    }

    imports
}

// --- PHP ---

fn php_use_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // use App\Models\User; / use App\Models\User as U;
        Regex::new(r#"(?m)^\s*use\s+([\w\\]+)"#).unwrap()
    })
}

fn php_require_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // require 'file.php'; require_once "file.php"; include 'file.php'; include_once "file.php";
        Regex::new(r#"(?m)(?:require|require_once|include|include_once)\s*[\(]?\s*["']([^"']+)["']"#).unwrap()
    })
}

fn extract_php(content: &str) -> Vec<RawImport> {
    let mut imports = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for cap in php_use_re().captures_iter(content) {
        let spec = cap[1].to_string();
        if seen.insert(spec.clone()) {
            imports.push(RawImport { specifier: spec, kind: ImportKind::Use });
        }
    }

    for cap in php_require_re().captures_iter(content) {
        let spec = cap[1].to_string();
        if seen.insert(spec.clone()) {
            imports.push(RawImport { specifier: spec, kind: ImportKind::Require });
        }
    }

    imports
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rust_imports() {
        let code = r#"
use crate::common::fs;
use crate::search::indexer::SearchIndex;
use std::collections::HashMap;
use anyhow::{Context, Result};
use super::query::SearchResult;
"#;
        let imports = extract_imports(code, "rs");
        assert_eq!(imports.len(), 5);
        assert_eq!(imports[0].specifier, "crate::common::fs");
        assert_eq!(imports[1].specifier, "crate::search::indexer::SearchIndex");
        assert_eq!(imports[2].specifier, "std::collections::HashMap");
        assert_eq!(imports[3].specifier, "anyhow::{Context, Result}");
        assert_eq!(imports[4].specifier, "super::query::SearchResult");
    }

    #[test]
    fn test_js_imports() {
        let code = r#"
import React from 'react';
import { useState } from 'react';
import './styles.css';
import type { Foo } from '../types';
const fs = require('fs');
export { bar } from './bar';
"#;
        let imports = extract_imports(code, "ts");
        let specs: Vec<&str> = imports.iter().map(|i| i.specifier.as_str()).collect();
        assert!(specs.contains(&"react"));
        assert!(specs.contains(&"./styles.css"));
        assert!(specs.contains(&"../types"));
        assert!(specs.contains(&"fs"));
        assert!(specs.contains(&"./bar"));
    }

    #[test]
    fn test_python_imports() {
        let code = r#"
import os
import sys
from pathlib import Path
from ..utils import helper
from . import local
"#;
        let imports = extract_imports(code, "py");
        let specs: Vec<&str> = imports.iter().map(|i| i.specifier.as_str()).collect();
        assert!(specs.contains(&"os"));
        assert!(specs.contains(&"sys"));
        assert!(specs.contains(&"pathlib"));
        assert!(specs.contains(&"..utils"));
        assert!(specs.contains(&"."));
    }

    #[test]
    fn test_js_dynamic_import() {
        let code = r#"
const lazy = import('./lazy-module');
const other = await import("../utils/helper");
"#;
        let imports = extract_imports(code, "js");
        let specs: Vec<&str> = imports.iter().map(|i| i.specifier.as_str()).collect();
        assert!(specs.contains(&"./lazy-module"));
        assert!(specs.contains(&"../utils/helper"));
    }

    #[test]
    fn test_js_multiline_import() {
        let code = "import {\n  foo,\n  bar,\n  baz\n} from './utils';";
        let imports = extract_imports(code, "ts");
        assert_eq!(imports.len(), 1);
        assert_eq!(imports[0].specifier, "./utils");
    }

    #[test]
    fn test_php_imports() {
        let code = r#"<?php
namespace App\Controllers;

use App\Models\User;
use App\Services\AuthService as Auth;
use Illuminate\Http\Request;

require_once 'vendor/autoload.php';
include './helpers.php';
require(__DIR__ . '/config.php');
"#;
        let imports = extract_imports(code, "php");
        let specs: Vec<&str> = imports.iter().map(|i| i.specifier.as_str()).collect();
        assert!(specs.contains(&r"App\Models\User"));
        assert!(specs.contains(&r"App\Services\AuthService"));
        assert!(specs.contains(&r"Illuminate\Http\Request"));
        assert!(specs.contains(&"vendor/autoload.php"));
        assert!(specs.contains(&"./helpers.php"));
    }

    #[test]
    fn test_go_imports() {
        let code = r#"
package main

import (
    "fmt"
    "os"
    log "github.com/sirupsen/logrus"
)

import "strings"
"#;
        let imports = extract_imports(code, "go");
        let specs: Vec<&str> = imports.iter().map(|i| i.specifier.as_str()).collect();
        assert!(specs.contains(&"fmt"));
        assert!(specs.contains(&"os"));
        assert!(specs.contains(&"github.com/sirupsen/logrus"));
        assert!(specs.contains(&"strings"));
    }
}
