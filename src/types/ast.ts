// ============================================================
// LOD (Level of Detail) System Types
// ============================================================

/** 
 * Level of Detail for file analysis.
 * 0 = Registry (metadata only)
 * 1 = Topology (imports/exports, lightweight)
 * 2 = Structure (full AST skeleton)
 * 3 = Semantic (full resolution with types)
 */
export type LOD_LEVEL = 0 | 1 | 2 | 3;

/**
 * Request to ensure a file is analyzed to at least the specified LOD.
 */
export interface AnalysisRequest {
    /** Absolute file path */
    path: string;
    /** Minimum LOD level required */
    minLOD: LOD_LEVEL;
    /** Optional: Force re-analysis even if already at requested LOD */
    force?: boolean;
}

/**
 * Result of an LOD analysis/promotion operation.
 */
export interface LODResult {
    /** File path that was analyzed */
    path: string;
    /** LOD level before the operation */
    previousLOD: LOD_LEVEL;
    /** Current LOD level after the operation */
    currentLOD: LOD_LEVEL;
    /** LOD level that was requested */
    requestedLOD: LOD_LEVEL;
    /** Whether the file was promoted to a higher LOD */
    promoted: boolean;
    /** Time taken for the operation in milliseconds */
    durationMs: number;
    /** Whether regex extraction failed and fell back to full AST */
    fallbackUsed: boolean;
    /** Confidence score for regex-based extraction (0.0-1.0) */
    confidence?: number;
    /** Error if analysis failed */
    error?: string;
}

/**
 * Topology information extracted at LOD 1.
 */
export interface TopologyInfo {
    /** File path */
    path: string;
    /** Import statements */
    imports: Array<{
        source: string;          // Module path
        isDefault: boolean;      // true if default import
        namedImports: string[];  // Named imports
        isTypeOnly: boolean;     // true if import type
        isDynamic: boolean;      // true if import()
        lineNumber: number;
    }>;
    /** Export statements */
    exports: Array<{
        name: string;            // Export name
        isDefault: boolean;      // true if export default
        isTypeOnly: boolean;     // true if export type
        reExportFrom?: string;   // Source if re-export
    }>;
    /** Top-level symbols (classes, functions, interfaces) */
    topLevelSymbols: Array<{
        name: string;
        kind: "class" | "function" | "interface" | "type" | "const" | "let" | "var" | "heading";
        exported: boolean;
        lineNumber: number;
        level?: number;
    }>;
    /** Extraction confidence (0.0-1.0) */
    confidence: number;
    /** Whether AST fallback was used */
    fallbackUsed: boolean;
    /** Extraction duration in ms */
    extractionTimeMs: number;
    /** Optional error during extraction */
    error?: string;
}

/**
 * Statistics about LOD promotions.
 */
export interface LODPromotionStats {
    /** Number of LOD 0 → 1 promotions */
    l0_to_l1: number;
    /** Number of LOD 1 → 2 promotions */
    l1_to_l2: number;
    /** Number of LOD 2 → 3 promotions */
    l2_to_l3: number;
    /** Regex fallback rate (0.0-1.0) */
    fallback_rate: number;
    /** Average promotion time per level */
    avg_promotion_time_ms: {
        l0_to_l1: number;
        l1_to_l2: number;
        l2_to_l3: number;
    };
    /** Total files tracked in UCG */
    total_files: number;
}

export type CallType = "direct" | "method" | "constructor" | "callback" | "optional" | "unknown";

export interface CallSiteInfo {
    calleeName: string;
    calleeObject?: string;
    callType: CallType;
    line: number;
    column: number;
    text?: string;
    arguments?: string[];
    isAwaited?: boolean;
}

export interface Point {
    row: number;
    column: number;
}

export interface BaseSymbolInfo {
    name: string;
    level?: number;
    start?: Point;
    end?: Point;
    range: { startLine: number; endLine: number; startByte: number; endByte: number };
    container?: string;
    modifiers?: string[];
    doc?: string;
    content?: string;
}

export interface DefinitionSymbol extends BaseSymbolInfo {
    type: "class" | "function" | "method" | "interface" | "variable" | "export_specifier" | "type_alias";
    signature?: string;
    parameters?: string[];
    returnType?: string;
    calls?: CallSiteInfo[];
}

export interface ImportSymbol extends BaseSymbolInfo {
    type: "import";
    source: string;
    importKind: "named" | "namespace" | "default" | "side-effect";
    alias?: string;
    imports?: { name: string; alias?: string }[];
    isTypeOnly?: boolean;
}

export interface ExportSymbol extends BaseSymbolInfo {
    type: "export";
    exportKind: "named" | "default" | "namespace" | "re-export";
    source?: string;
    exports?: { name: string; alias?: string }[];
    isTypeOnly?: boolean;
}

export type SymbolInfo = DefinitionSymbol | ImportSymbol | ExportSymbol;

export interface SymbolIndex {
    getSymbolsForFile(filePath: string): Promise<SymbolInfo[]>;
    getAllSymbols(): Promise<Map<string, SymbolInfo[]>>;
    findFilesBySymbolName(keywords: string[]): Promise<string[]>;
}

export type CallConfidence = "definite" | "possible" | "inferred";

export interface CallGraphEdge {
    fromSymbolId: string;
    toSymbolId: string;
    callType: CallType;
    confidence: CallConfidence;
    line: number;
    column: number;
}

export interface CallGraphNode {
    symbolId: string;
    symbolName: string;
    filePath: string;
    symbolType: DefinitionSymbol["type"];
    range: DefinitionSymbol["range"];
    callers: CallGraphEdge[];
    callees: CallGraphEdge[];
}

export interface CallGraphResult {
    root: CallGraphNode;
    visitedNodes: Record<string, CallGraphNode>;
    truncated: boolean;
    truncatedReason?: "cap" | "depth" | "unknown";
}

export type TypeRelationKind = "extends" | "implements" | "alias" | "constraint" | "usage";

export interface TypeRelationInfo {
    targetName: string;
    relationKind: TypeRelationKind;
    confidence: CallConfidence;
}

export interface TypeGraphEdge {
    fromSymbolId: string;
    toSymbolId: string;
    relationKind: TypeRelationKind;
    confidence: CallConfidence;
}

export interface TypeGraphNode {
    symbolId: string;
    symbolName: string;
    filePath: string;
    symbolType: DefinitionSymbol["type"];
    range: DefinitionSymbol["range"];
    parents: TypeGraphEdge[];
    dependencies: TypeGraphEdge[];
}

export interface TypeGraphResult {
    root: TypeGraphNode;
    visitedNodes: Record<string, TypeGraphNode>;
    truncated: boolean;
}

export type DataFlowStepType = "definition" | "parameter" | "assignment" | "mutation" | "usage" | "call_argument" | "return";

export type DataFlowRelation = "next";

export interface DataFlowStep {
    id: string;
    stepType: DataFlowStepType;
    filePath: string;
    range: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
    };
    textSnippet: string;
    symbolName?: string;
    metadata?: Record<string, unknown>;
}

export interface DataFlowEdge {
    fromStepId: string;
    toStepId: string;
    relation: DataFlowRelation;
}

export interface DataFlowResult {
    sourceStepId: string;
    steps: Record<string, DataFlowStep>;
    orderedStepIds: string[];
    edges: DataFlowEdge[];
    truncated: boolean;
}
