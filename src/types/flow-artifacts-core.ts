import type {
    AnalysisPack,
    AnalysisPackId,
    DraftPack,
    DraftPackId,
    EvidencePackId,
    GraphPack,
    GraphPackId,
    ResearchPack,
    ResearchPackId,
    StylePack,
    StylePackId,
    TaskEvidencePack
} from "./flow-artifacts-packs.js";
import type { ReviewReport, ReviewReportId, SchemaArtifactId } from "./flow-artifacts-validation.js";

export type ArtifactType = "research" | "analysis" | "style" | "draft" | "review" | "graph" | "schema" | "evidence";
export type ArtifactId =
    | ResearchPackId
    | AnalysisPackId
    | StylePackId
    | DraftPackId
    | ReviewReportId
    | GraphPackId
    | SchemaArtifactId
    | EvidencePackId;

export interface FlowArtifactBase {
    id: ArtifactId;
    type: ArtifactType;
    createdAt: number;
    expiresAt?: number;
    sessionId?: string;
    parentId?: string;
    metadata?: Record<string, any>;
}

export interface ResearchArtifact extends FlowArtifactBase {
    type: "research";
    pack: ResearchPack;
}

export interface AnalysisArtifact extends FlowArtifactBase {
    type: "analysis";
    pack: AnalysisPack;
}

export interface StyleArtifact extends FlowArtifactBase {
    type: "style";
    pack: StylePack;
}

export interface DraftArtifact extends FlowArtifactBase {
    type: "draft";
    pack: DraftPack;
}

export interface ReviewArtifact extends FlowArtifactBase {
    type: "review";
    report: ReviewReport;
    targetDraftId?: DraftPackId;
}

export interface GraphArtifact extends FlowArtifactBase {
    type: "graph";
    pack: GraphPack;
}

export interface EvidenceArtifact extends FlowArtifactBase {
    type: "evidence";
    pack: TaskEvidencePack;
}

export type SchemaExport = {
    tool: string;
    schemaVersion: string;
    description?: string;
    inputSchema: Record<string, unknown>;
    compat?: Record<string, unknown>;
    exportedAt: number;
};

export interface SchemaArtifact extends FlowArtifactBase {
    type: "schema";
    schema: SchemaExport;
}

export type FlowArtifact =
    | ResearchArtifact
    | AnalysisArtifact
    | StyleArtifact
    | DraftArtifact
    | ReviewArtifact
    | GraphArtifact
    | EvidenceArtifact
    | SchemaArtifact;

export interface ArtifactManagerStatus {
    totalCount: number;
    byType: Record<ArtifactType, number>;
    oldestAt: number;
    newestAt: number;
    cacheUtilization: number;
}

export type FlowSessionStatus = "active" | "completed" | "abandoned";

export type ToolProfile = "lean" | "fast" | "balanced" | "deep";
export type ToolSources = "code" | "docs" | "both";
export type ToolSafety = "plan" | "apply";

export type SessionRepoScope =
    | { mode: "all" }
    | { mode: "default" }
    | { mode: "repos"; repoIds?: string[] };

export interface SessionRepoPolicy {
    root?: string;
    repoScope?: SessionRepoScope;
    repoId?: string;
    repoIds?: string[];
}

export interface SessionPolicy extends SessionRepoPolicy {
    profile?: ToolProfile;
    sources?: ToolSources;
    safety?: ToolSafety;
    explore?: ({ profile?: ToolProfile; sources?: ToolSources } & SessionRepoPolicy);
    understand?: ({ profile?: ToolProfile; sources?: ToolSources } & SessionRepoPolicy);
    write?: ({ profile?: ToolProfile; safety?: ToolSafety } & SessionRepoPolicy);
    change?: ({ profile?: ToolProfile; safety?: ToolSafety } & SessionRepoPolicy);
}

export interface FlowSessionOutcome {
    filesCreated: string[];
    filesModified: string[];
    finalReviewId?: ReviewReportId;
}

export interface ApplyTokenRecord {
    draftId: string;
    tokenHash: string;
    issuedAt: number;
    expiresAt: number;
    usedAt?: number;
}

export interface FlowSession {
    id: string;
    startedAt: number;
    intent: string;
    status: FlowSessionStatus;
    artifacts: {
        research?: ResearchPackId;
        analysis?: AnalysisPackId;
        style?: StylePackId;
        drafts: DraftPackId[];
        reviews: ReviewReportId[];
        graphs?: GraphPackId[];
        evidence?: EvidencePackId[];
    };
    updatedAt?: number;
    outcome?: FlowSessionOutcome;
    policy?: SessionPolicy;
    applyTokens?: Record<string, ApplyTokenRecord>;
}
