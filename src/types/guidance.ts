export type ToolCall = {
  tool: string;
  args: Record<string, unknown>;
};

export type SuggestedActionV1 = {
  id: string;
  priority: 1 | 2 | 3;
  description: string;
  rationale?: string;
  toolCall: ToolCall;
  tags?: string[];
};

export type WarningV1 = {
  severity: "info" | "warning" | "critical";
  code: string;
  message: string;
  affectedTargets?: string[];
  mitigation?: string;
};

export type RecoveryStrategyV1 = {
  name: string;
  description: string;
  toolCall: ToolCall;
};

export type GuidanceMetaV1 = {
  generatedAt: string;
  basedOn: {
    hotSpotCount: number;
    pageRankCoverage: number;
    impactAnalysisIncluded: boolean;
  };
  confidence: number;
};

export type GuidanceV1 = {
  message: string;
  contextSummary: string;
  suggestedActions: SuggestedActionV1[];
  warnings: WarningV1[];
  recoveryStrategies?: RecoveryStrategyV1[];
  meta: GuidanceMetaV1;
};
