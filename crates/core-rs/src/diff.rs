use napi_derive::napi;
use similar::{Algorithm, ChangeTag, TextDiff};

#[napi(object)]
pub struct DiffResult {
    pub diff: String,
    pub added: u32,
    pub removed: u32,
}

#[napi]
pub fn diff_unified(old_text: String, new_text: String, context_lines: u32) -> DiffResult {
    let diff = TextDiff::configure()
        .algorithm(Algorithm::Patience)
        .diff_lines(&old_text, &new_text);

    let mut added = 0;
    let mut removed = 0;
    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Insert => added += 1,
            ChangeTag::Delete => removed += 1,
            ChangeTag::Equal => {}
        }
    }

    let mut unified = diff.unified_diff();
    unified.context_radius(context_lines as usize);
    let mut diff_text = unified.to_string();
    diff_text = diff_text.trim_end_matches('\n').to_string();

    if diff_text.starts_with("---") {
        let mut lines = diff_text.lines();
        lines.next();
        lines.next();
        diff_text = lines.collect::<Vec<_>>().join("\n");
    }

    DiffResult { diff: diff_text, added, removed }
}
