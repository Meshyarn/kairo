export interface Insight {
  type: "architecture" | "risk" | "optimization" | "maintenance" | "dependency";
  severity: "low" | "medium" | "high";
  observation: string;
  implication: string;
  risk?: string;
  actionSuggestion: string;
  affectedFiles: string[];
  confidence: number;
}

export interface SynthesizedInsights {
  overview: {
    filesAnalyzed: number;
    symbolsDiscovered: number;
    generatedAt: string;
  };
  insights: Insight[];
  pageRankSummary?: {
    coverage: number;
    topNodes: Array<{ id: string; score: number }>;
  };
  pageRank?: {
    topNodes: Array<{
      path: string;
      symbol: string;
      score: number;
      role: "core" | "utility" | "integration" | "peripheral";
    }>;
    distribution: {
      core: number;
      utility: number;
      integration: number;
      peripheral: number;
    };
  };
  hotSpotSummary?: {
    count: number;
    topFiles: Array<{ filePath: string; count: number }>;
  };
  hotSpots?: {
    detected: any[];
    clusteredByFile: Record<string, any[]>;
    totalScore: number;
    riskSummary: string;
  };
  impactSummary?: {
    riskCounts: { high: number; medium: number; low: number };
    impactedFiles: string[];
  };
  impact?: {
    highRiskFiles: string[];
    blastRadiusByFile: Record<string, number>;
    breakingChangeIndicators: string[];
  };
  visualization?: string;
}
