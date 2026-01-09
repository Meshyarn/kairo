export type AnalyzeRelationshipMode = "impact" | "dependencies" | "calls" | "data_flow" | "types";

export type AnalyzeRelationshipDirection = "upstream" | "downstream" | "both";

export interface AnalyzeRelationshipArgs {
    target: string;
    targetType?: "auto" | "file" | "symbol";
    contextPath?: string;
    mode: AnalyzeRelationshipMode;
    direction?: AnalyzeRelationshipDirection;
    maxDepth?: number;
    fromLine?: number;
}

export interface AnalyzeRelationshipNode {
    id: string;
    type: string;
    path?: string;
    label?: string;
}

export interface AnalyzeRelationshipEdge {
    source: string;
    target: string;
    relation: string;
}

export interface ResolvedRelationshipTarget {
    type: "file" | "symbol" | "variable";
    path: string;
    symbolName?: string;
}

export interface AnalyzeRelationshipResult {
    nodes: AnalyzeRelationshipNode[];
    edges: AnalyzeRelationshipEdge[];
    resolvedTarget: ResolvedRelationshipTarget;
}

export interface GhostMethodInfo {
    name: string;
    callCount: number;
    fileCount: number;
    inferredSignature: string;
    confidence: "high" | "medium" | "low";
}

export interface GhostInterface {
    name: string;
    methods: GhostMethodInfo[];
    confidence: "high" | "medium" | "low";
    usageCount: number;
    sourceFiles: string[];
}

export interface ReconstructInterfaceArgs {
    symbolName: string;
}

export interface ReconstructInterfaceResult {
    ghostInterface: GhostInterface;
    message: string;
}

export type ManageProjectCommand =
    | "undo"
    | "redo"
    | "guidance"
    | "status"
    | "metrics"
    | "reindex"
    | "artifacts"
    | "artifact"
    | "discard"
    | "prune"
    | "export"
    | "import";

export interface ManageProjectArgs {
    command: ManageProjectCommand;
}

export interface ManageProjectResult {
    output: string;
    data?: any;
}
