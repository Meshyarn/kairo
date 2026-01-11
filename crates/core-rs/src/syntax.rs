use napi_derive::napi;
use tree_sitter::{Node, Parser};

#[napi(object)]
pub struct SyntaxIssue {
    pub line: u32,
    pub column: u32,
    pub message: String,
}

#[napi]
pub fn validate_syntax(language: String, content: String) -> Vec<SyntaxIssue> {
    let lang = match language.as_str() {
        "js" | "jsx" => tree_sitter_javascript::LANGUAGE.into(),
        "ts" => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
        "tsx" => tree_sitter_typescript::LANGUAGE_TSX.into(),
        _ => return Vec::new(),
    };

    let mut parser = Parser::new();
    if parser.set_language(&lang).is_err() {
        return vec![SyntaxIssue {
            line: 1,
            column: 1,
            message: "Failed to initialize parser.".to_string(),
        }];
    }

    let tree = match parser.parse(&content, None) {
        Some(tree) => tree,
        None => {
            return vec![SyntaxIssue {
                line: 1,
                column: 1,
                message: "Parse failed.".to_string(),
            }]
        }
    };

    let root = tree.root_node();
    if !root.has_error() {
        return Vec::new();
    }

    let mut issues = Vec::new();
    collect_errors(root, &mut issues);
    if issues.is_empty() {
        issues.push(SyntaxIssue {
            line: 1,
            column: 1,
            message: "Syntax error detected.".to_string(),
        });
    }
    issues
}

fn collect_errors(node: Node, issues: &mut Vec<SyntaxIssue>) {
    if node.is_error() || node.is_missing() {
        let pos = node.start_position();
        issues.push(SyntaxIssue {
            line: (pos.row + 1) as u32,
            column: (pos.column + 1) as u32,
            message: "Syntax error detected.".to_string(),
        });
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_errors(child, issues);
    }
}
