mod chunking;
mod diff;
mod symbolic;
mod syntax;
mod vector;

pub use chunking::{ChunkResult, SmartChunker};
pub use diff::{diff_unified, DiffResult};
pub use symbolic::{
    symbolic_solve,
    SymbolicSolverConstraint,
    SymbolicSolverDiagnostic,
    SymbolicSolverEvidence,
    SymbolicSolverInput,
    SymbolicSolverResult,
    SymbolicSolverStats
};
pub use syntax::{validate_syntax, SyntaxIssue};
pub use vector::cosine_scores;
