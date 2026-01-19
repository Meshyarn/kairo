export type SymbolicSolverSeverity = "warn" | "high";

export type SymbolicSolverDiagnostic = {
    code: string;
    severity: SymbolicSolverSeverity;
    message: string;
    filePath?: string;
    line?: number;
    column?: number;
    evidence?: { snippet?: string; note?: string };
};

export type SymbolicSolverConstraint = {
    kind: "guard" | "index_access" | "deref" | "binary";
    text: string;
    scopeKey: string;
    line: number;
    column: number;
};

export type SymbolicSolverInput = {
    filePath: string;
    content: string;
    constraints: SymbolicSolverConstraint[];
    maxPaths: number;
    maxConstraints: number;
    timeSliceMs: number;
};

export type SymbolicSolverResult = {
    diagnostics: SymbolicSolverDiagnostic[];
    degradedReasons?: string[];
    stats?: { durationMs?: number; pathsExplored?: number; constraintsBuilt?: number };
};

export interface ISymbolicSolverProvider {
    solve(input: SymbolicSolverInput): Promise<SymbolicSolverResult>;
}
