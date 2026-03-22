use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub path: String,
    pub score: f32,
    pub snippet: String,
}
