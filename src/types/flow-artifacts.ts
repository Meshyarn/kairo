export type ResearchPackId = string;

export interface TopModule {
    path: string;
    score: number;
    why: string[];
    fileCount?: number;
    exportCount?: number;
}

export interface Edge {
    from: string;
    to: string;
    type: "import" | "extends" | "implements" | "uses" | "calls";
    weight?: number;
}

export interface ProjectSketch {
    summary: string;
    topModules: TopModule[];
    edgesSample: Edge[];
    ascii?: string;
    mermaid?: string;
    degraded?: boolean;
    view?: "full" | "layers" | "domains";
    layersSummary?: {
        layers: Array<{
            name: string;
            modules: string[];
            dependsOn: string[];
        }>;
    };
    domainsSummary?: {
        domains: Array<{
            name: string;
            modules: string[];
            sharedWith: string[];
        }>;
    };
}

export interface ResearchPack {
    id: ResearchPackId;
    sketch: ProjectSketch;
    hotspots?: Array<{ path: string; reason: string; score: number }>;
    boundaries?: Array<{ name: string; modules: string[]; external: string[] }>;
    createdAt: number;
    expiresAt?: number;
}
