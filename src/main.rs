mod common;
mod graph;
mod mcp;
mod search;

use anyhow::Result;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    // Logging to stderr only — stdout is MCP protocol
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_writer(std::io::stderr)
        .init();

    tracing::info!("kairo v{} starting", env!("CARGO_PKG_VERSION"));

    // Accept optional root path as first argument, fallback to cwd
    let root = std::env::args()
        .nth(1)
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().expect("cannot determine cwd"));

    mcp::serve_stdio_with_root(root).await
}
