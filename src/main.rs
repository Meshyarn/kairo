mod common;
mod graph;
mod mcp;
mod search;
mod watcher;

// glibc 2.38+ compatibility stubs for systems with older glibc (e.g. Debian 12 / glibc 2.36).
// ort.pyke.io distributes libonnxruntime.a built with GCC 14 which emits __isoc23_strtol* calls;
// these are functionally identical to their non-C23 counterparts.
#[cfg(target_os = "linux")]
mod glibc_compat {
    use std::ffi::{c_char, c_int, c_long, c_longlong, c_ulong, c_ulonglong};

    extern "C" {
        fn strtol(s: *const c_char, e: *mut *mut c_char, b: c_int) -> c_long;
        fn strtoll(s: *const c_char, e: *mut *mut c_char, b: c_int) -> c_longlong;
        fn strtoul(s: *const c_char, e: *mut *mut c_char, b: c_int) -> c_ulong;
        fn strtoull(s: *const c_char, e: *mut *mut c_char, b: c_int) -> c_ulonglong;
    }

    #[no_mangle]
    pub unsafe extern "C" fn __isoc23_strtol(s: *const c_char, e: *mut *mut c_char, b: c_int) -> c_long {
        strtol(s, e, b)
    }
    #[no_mangle]
    pub unsafe extern "C" fn __isoc23_strtoll(s: *const c_char, e: *mut *mut c_char, b: c_int) -> c_longlong {
        strtoll(s, e, b)
    }
    #[no_mangle]
    pub unsafe extern "C" fn __isoc23_strtoul(s: *const c_char, e: *mut *mut c_char, b: c_int) -> c_ulong {
        strtoul(s, e, b)
    }
    #[no_mangle]
    pub unsafe extern "C" fn __isoc23_strtoull(s: *const c_char, e: *mut *mut c_char, b: c_int) -> c_ulonglong {
        strtoull(s, e, b)
    }
}

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
