use napi_derive::napi;
use std::collections::{HashMap, HashSet};
use std::time::Instant;

#[napi(object)]
pub struct SymbolicSolverEvidence {
    pub snippet: Option<String>,
    pub note: Option<String>,
}

#[napi(object)]
pub struct SymbolicSolverDiagnostic {
    pub code: String,
    pub severity: String,
    pub message: String,
    pub file_path: Option<String>,
    pub line: Option<u32>,
    pub column: Option<u32>,
    pub evidence: Option<SymbolicSolverEvidence>,
}

#[derive(Clone)]
#[napi(object)]
pub struct SymbolicSolverConstraint {
    pub kind: String,
    pub text: String,
    pub scope_key: String,
    pub line: u32,
    pub column: u32,
}

#[napi(object)]
pub struct SymbolicSolverInput {
    pub file_path: String,
    pub content: String,
    pub constraints: Vec<SymbolicSolverConstraint>,
    pub max_paths: u32,
    pub max_constraints: u32,
    pub time_slice_ms: u32,
}

#[napi(object)]
pub struct SymbolicSolverStats {
    pub duration_ms: Option<u32>,
    pub paths_explored: Option<u32>,
    pub constraints_built: Option<u32>,
}

#[napi(object)]
pub struct SymbolicSolverResult {
    pub diagnostics: Vec<SymbolicSolverDiagnostic>,
    pub degraded_reasons: Option<Vec<String>>,
    pub stats: Option<SymbolicSolverStats>,
}

#[napi]
pub fn symbolic_solve(input: SymbolicSolverInput) -> SymbolicSolverResult {
    let start = Instant::now();
    let mut diagnostics: Vec<SymbolicSolverDiagnostic> = Vec::new();
    let mut degraded: Vec<String> = Vec::new();

    let max_constraints = if input.max_constraints == 0 {
        input.constraints.len()
    } else {
        usize::min(input.constraints.len(), input.max_constraints as usize)
    };
    if input.max_constraints > 0 && input.constraints.len() > input.max_constraints as usize {
        degraded.push("symbolic_budget_exceeded".to_string());
    }
    let max_paths = if input.max_paths == 0 {
        usize::MAX
    } else {
        input.max_paths as usize
    };

    let mut guard_texts_by_scope: HashMap<String, Vec<String>> = HashMap::new();
    let mut scope_keys: HashSet<String> = HashSet::new();
    let mut index_accesses: Vec<SymbolicSolverConstraint> = Vec::new();
    let mut derefs: Vec<SymbolicSolverConstraint> = Vec::new();
    let mut binaries: Vec<SymbolicSolverConstraint> = Vec::new();

    for constraint in input.constraints.iter().take(max_constraints) {
        if timed_out(start, input.time_slice_ms) {
            degraded.push("symbolic_budget_exceeded".to_string());
            break;
        }
        if !scope_keys.contains(&constraint.scope_key) && scope_keys.len() >= max_paths {
            degraded.push("symbolic_budget_exceeded".to_string());
            break;
        }
        scope_keys.insert(constraint.scope_key.clone());
        match constraint.kind.as_str() {
            "guard" => {
                guard_texts_by_scope
                    .entry(constraint.scope_key.clone())
                    .or_default()
                    .push(constraint.text.clone());
            }
            "index_access" => index_accesses.push(constraint.clone()),
            "deref" => derefs.push(constraint.clone()),
            "binary" => binaries.push(constraint.clone()),
            _ => {}
        }
    }

    for access in index_accesses.iter() {
        if timed_out(start, input.time_slice_ms) {
            degraded.push("symbolic_budget_exceeded".to_string());
            break;
        }
        let index_expr = match extract_index_expr(&access.text) {
            Some(value) => value,
            None => continue,
        };
        if !is_simple_identifier(&index_expr) {
            continue;
        }
        let guard_texts = guard_texts_by_scope
            .get(&access.scope_key)
            .map(|items| items.as_slice())
            .unwrap_or(&[]);
        if !has_index_guard(&index_expr, guard_texts) {
            diagnostics.push(SymbolicSolverDiagnostic {
                code: "index_bounds".to_string(),
                severity: "high".to_string(),
                message: format!("Index access '{}' without an obvious bounds guard.", index_expr),
                file_path: Some(input.file_path.clone()),
                line: Some(access.line),
                column: Some(access.column),
                evidence: Some(SymbolicSolverEvidence {
                    snippet: Some(truncate_text(&access.text, 160)),
                    note: None,
                }),
            });
        }
    }

    for expr in binaries.iter() {
        if timed_out(start, input.time_slice_ms) {
            degraded.push("symbolic_budget_exceeded".to_string());
            break;
        }
        if let Some(denom) = extract_divisor(&expr.text) {
            if is_literal_zero(&denom) {
                diagnostics.push(SymbolicSolverDiagnostic {
                    code: "division_by_zero".to_string(),
                    severity: "high".to_string(),
                    message: "Possible division or modulo by zero.".to_string(),
                    file_path: Some(input.file_path.clone()),
                    line: Some(expr.line),
                    column: Some(expr.column),
                    evidence: Some(SymbolicSolverEvidence {
                        snippet: Some(truncate_text(&expr.text, 160)),
                        note: None,
                    }),
                });
                continue;
            }
            if is_simple_identifier(&denom) {
                let guard_texts = guard_texts_by_scope
                    .get(&expr.scope_key)
                    .map(|items| items.as_slice())
                    .unwrap_or(&[]);
                if !has_zero_guard(&denom, guard_texts) {
                    diagnostics.push(SymbolicSolverDiagnostic {
                        code: "division_by_zero".to_string(),
                        severity: "high".to_string(),
                        message: format!("Division or modulo by '{}' without an obvious zero guard.", denom),
                        file_path: Some(input.file_path.clone()),
                        line: Some(expr.line),
                        column: Some(expr.column),
                        evidence: Some(SymbolicSolverEvidence {
                            snippet: Some(truncate_text(&expr.text, 160)),
                            note: None,
                        }),
                    });
                }
            }
            continue;
        }
        if has_zero_division(&expr.text) {
            diagnostics.push(SymbolicSolverDiagnostic {
                code: "division_by_zero".to_string(),
                severity: "high".to_string(),
                message: "Possible division or modulo by zero.".to_string(),
                file_path: Some(input.file_path.clone()),
                line: Some(expr.line),
                column: Some(expr.column),
                evidence: Some(SymbolicSolverEvidence {
                    snippet: Some(truncate_text(&expr.text, 160)),
                    note: None,
                }),
            });
        }
    }

    for access in derefs.iter() {
        if timed_out(start, input.time_slice_ms) {
            degraded.push("symbolic_budget_exceeded".to_string());
            break;
        }
        let base = match extract_base_identifier(&access.text) {
            Some(value) => value,
            None => continue,
        };
        if is_null_literal(&base) {
            diagnostics.push(SymbolicSolverDiagnostic {
                code: "null_deref_without_guard".to_string(),
                severity: "warn".to_string(),
                message: "Null/undefined dereference detected.".to_string(),
                file_path: Some(input.file_path.clone()),
                line: Some(access.line),
                column: Some(access.column),
                evidence: Some(SymbolicSolverEvidence {
                    snippet: Some(truncate_text(&access.text, 160)),
                    note: None,
                }),
            });
            continue;
        }
        if !is_simple_identifier(&base) {
            continue;
        }
        let guard_texts = guard_texts_by_scope
            .get(&access.scope_key)
            .map(|items| items.as_slice())
            .unwrap_or(&[]);
        if !has_null_guard(&base, guard_texts) {
            diagnostics.push(SymbolicSolverDiagnostic {
                code: "null_deref_without_guard".to_string(),
                severity: "warn".to_string(),
                message: format!("Dereference of '{}' without an obvious null guard.", base),
                file_path: Some(input.file_path.clone()),
                line: Some(access.line),
                column: Some(access.column),
                evidence: Some(SymbolicSolverEvidence {
                    snippet: Some(truncate_text(&access.text, 160)),
                    note: None,
                }),
            });
        }
    }

    let constraints_built = max_constraints as u32;
    let duration_ms = start.elapsed().as_millis().min(u128::from(u32::MAX)) as u32;
    SymbolicSolverResult {
        diagnostics,
        degraded_reasons: if degraded.is_empty() { None } else { Some(dedup_reasons(degraded)) },
        stats: Some(SymbolicSolverStats {
            duration_ms: Some(duration_ms),
            paths_explored: Some(scope_keys.len() as u32),
            constraints_built: Some(constraints_built),
        }),
    }
}

fn timed_out(start: Instant, time_slice_ms: u32) -> bool {
    if time_slice_ms == 0 {
        return false;
    }
    start.elapsed().as_millis() > u128::from(time_slice_ms)
}

fn normalize_text(value: &str) -> String {
    value
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect::<String>()
        .to_lowercase()
}

fn is_simple_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    let first = match chars.next() {
        Some(ch) => ch,
        None => return false,
    };
    if !is_identifier_start(first) {
        return false;
    }
    for ch in chars {
        if !is_identifier_part(ch) {
            return false;
        }
    }
    true
}

fn is_identifier_start(ch: char) -> bool {
    ch == '_' || ch == '$' || ch.is_ascii_alphabetic()
}

fn is_identifier_part(ch: char) -> bool {
    is_identifier_start(ch) || ch.is_ascii_digit()
}

fn extract_index_expr(text: &str) -> Option<String> {
    let open = text.rfind('[')?;
    let close = text.rfind(']')?;
    if close <= open {
        return None;
    }
    let inner = text.get(open + 1..close)?.trim();
    if inner.is_empty() {
        None
    } else {
        Some(inner.to_string())
    }
}

fn extract_base_identifier(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut out = String::new();
    for ch in trimmed.chars() {
        if out.is_empty() {
            if !is_identifier_start(ch) {
                return None;
            }
        }
        if is_identifier_part(ch) {
            out.push(ch);
        } else {
            break;
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn has_index_guard(index_expr: &str, guard_texts: &[String]) -> bool {
    let needle = normalize_text(index_expr);
    guard_texts.iter().any(|raw| {
        let text = normalize_text(raw);
        if !text.contains(&needle) {
            return false;
        }
        let has_length = text.contains(".length")
            || text.contains("len(")
            || text.contains("size(")
            || text.contains("count(");
        let has_comparator = text.contains('<') || text.contains('>');
        has_length && has_comparator
    })
}

fn has_null_guard(identifier: &str, guard_texts: &[String]) -> bool {
    let needle = normalize_text(identifier);
    guard_texts.iter().any(|raw| {
        let text = normalize_text(raw);
        if !text.contains(&needle) {
            return false;
        }
        text.contains("!=null")
            || text.contains("!==null")
            || text.contains("!=undefined")
            || text.contains("!==undefined")
    })
}

fn is_null_literal(value: &str) -> bool {
    matches!(
        value.trim().to_lowercase().as_str(),
        "null" | "undefined" | "none" | "nil"
    )
}

fn extract_divisor(text: &str) -> Option<String> {
    let mut last_op: Option<usize> = None;
    for (idx, ch) in text.char_indices() {
        if ch == '/' || ch == '%' {
            last_op = Some(idx);
        }
    }
    let op_index = last_op?;
    let rhs = text.get(op_index + 1..)?.trim();
    if rhs.is_empty() {
        return None;
    }
    let token = take_token(rhs)?;
    if token.is_empty() {
        None
    } else {
        Some(token)
    }
}

fn take_token(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut end = trimmed.len();
    for (idx, ch) in trimmed.char_indices() {
        if ch.is_whitespace() || "+-*/%<>=&|?:,),".contains(ch) {
            end = idx;
            break;
        }
    }
    let token = trimmed[..end].trim();
    if token.is_empty() {
        return None;
    }
    Some(strip_wrapping_parens(token).to_string())
}

fn strip_wrapping_parens(value: &str) -> String {
    let mut out = value.trim().to_string();
    loop {
        let trimmed = out.trim();
        if trimmed.starts_with('(') && trimmed.ends_with(')') && trimmed.len() > 1 {
            out = trimmed[1..trimmed.len() - 1].trim().to_string();
            continue;
        }
        break;
    }
    out
}

fn has_zero_guard(identifier: &str, guard_texts: &[String]) -> bool {
    let needle = normalize_text(identifier);
    guard_texts.iter().any(|raw| {
        let text = normalize_text(raw);
        if !text.contains(&needle) {
            return false;
        }
        text.contains("!=0")
            || text.contains("!==0")
            || text.contains(">0")
            || text.contains(">=1")
    })
}

fn is_literal_zero(value: &str) -> bool {
    let cleaned = value.trim().trim_end_matches('n');
    if cleaned.is_empty() {
        return false;
    }
    let normalized = cleaned.trim_start_matches('+').trim_start_matches('-');
    if let Some((int, frac)) = normalized.split_once('.') {
        return !int.is_empty()
            && int.chars().all(|ch| ch == '0')
            && frac.chars().all(|ch| ch == '0');
    }
    normalized.chars().all(|ch| ch == '0')
}

fn has_zero_division(value: &str) -> bool {
    let text = normalize_text(value);
    text.contains("/0") || text.contains("%0")
}

fn truncate_text(value: &str, max_len: usize) -> String {
    if value.len() <= max_len {
        return value.to_string();
    }
    value.chars().take(max_len).collect()
}

fn dedup_reasons(reasons: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for reason in reasons {
        if seen.insert(reason.clone()) {
            out.push(reason);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_constraint(kind: &str, text: &str) -> SymbolicSolverConstraint {
        SymbolicSolverConstraint {
            kind: kind.to_string(),
            text: text.to_string(),
            scope_key: "scope_1".to_string(),
            line: 1,
            column: 1,
        }
    }

    fn run_solver(constraints: Vec<SymbolicSolverConstraint>) -> SymbolicSolverResult {
        symbolic_solve(SymbolicSolverInput {
            file_path: "src/example.ts".to_string(),
            content: "".to_string(),
            constraints,
            max_paths: 8,
            max_constraints: 64,
            time_slice_ms: 0,
        })
    }

    #[test]
    fn detects_index_bounds_without_guard() {
        let result = run_solver(vec![make_constraint("index_access", "items[i]")]);
        assert!(result.diagnostics.iter().any(|diag| diag.code == "index_bounds"));
    }

    #[test]
    fn skips_index_bounds_with_guard() {
        let result = run_solver(vec![
            make_constraint("guard", "i < items.length"),
            make_constraint("index_access", "items[i]"),
        ]);
        assert!(!result.diagnostics.iter().any(|diag| diag.code == "index_bounds"));
    }

    #[test]
    fn detects_division_by_zero_and_respects_guard() {
        let guarded = run_solver(vec![
            make_constraint("guard", "denom != 0"),
            make_constraint("binary", "value / denom"),
        ]);
        assert!(!guarded.diagnostics.iter().any(|diag| diag.code == "division_by_zero"));

        let zero = run_solver(vec![make_constraint("binary", "value / 0")]);
        assert!(zero.diagnostics.iter().any(|diag| diag.code == "division_by_zero"));
    }

    #[test]
    fn detects_null_deref_without_guard() {
        let guarded = run_solver(vec![
            make_constraint("guard", "user != null"),
            make_constraint("deref", "user.name"),
        ]);
        assert!(!guarded.diagnostics.iter().any(|diag| diag.code == "null_deref_without_guard"));

        let unguarded = run_solver(vec![make_constraint("deref", "user.name")]);
        assert!(unguarded.diagnostics.iter().any(|diag| diag.code == "null_deref_without_guard"));
    }
}
