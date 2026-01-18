import type { DegradedReason } from "../../../types/tool-responses.js";

export function buildUnderstandResponse(args: {
  subject: string;
  filePath: string;
  symbolName?: string | null;
  skeleton: any;
  profile: any;
  isDocument: boolean;
  docProfile?: any;
  docReferences?: any;
  relatedCode?: any[] | undefined;
  callGraph?: any;
  callGraphArtifactId?: string;
  callGraphSummary?: {
    mode: "symbol" | "file";
    truncated: boolean;
    totalNodes?: number;
    totalEdges?: number;
    topNodes?: Array<{ label: string; filePath?: string; degree?: number }>;
  };
  deps?: any;
  hotSpots?: any[];
  integrityReport?: any;
  includeCalls: boolean;
  degraded: boolean;
  degradedReasons?: string[];
  degradedReasonDetails?: DegradedReason[];
  fallbackGraph?: {
    mode: "l2";
    edges: Array<{ from: string; to: string; confidence: "low"; reason?: string }>;
    evidence?: string[];
  };
  refinementReason?: string;
  budget: any;
  allowGraphs: boolean;
  indexSnapshot?: any;
  stylePack?: any;
  analysisPack?: any;
  sessionId?: string;
  compression?: {
    applied: boolean;
    mode: "none" | "truncate" | "distill";
    elasticWindowPct?: number;
    maxTokens?: number;
    estimatedTokens?: number;
    maxChars?: number;
    usedChars?: number;
    decisions?: Array<{
      item: string;
      from: "full" | "skeleton" | "reference" | "summary";
      to: "full" | "skeleton" | "reference" | "summary";
      reason: "budget_exceeded" | "low_score" | "distance";
    }>;
  };
}): any {
  const {
    subject,
    filePath,
    symbolName,
    skeleton,
    profile,
    isDocument,
    docProfile,
    docReferences,
    relatedCode,
    callGraph,
    callGraphArtifactId,
    callGraphSummary,
    deps,
    hotSpots,
    integrityReport,
    includeCalls,
    degraded,
    degradedReasons,
    degradedReasonDetails,
    fallbackGraph,
    refinementReason,
    budget,
    allowGraphs,
    indexSnapshot,
    stylePack,
    analysisPack,
    sessionId,
    compression
  } = args;

  const status = includeCalls && !symbolName
    ? "partial_success"
    : (degraded ? "partial_success" : "ok");
  const dependencyEdges = Array.isArray(deps?.edges) ? deps.edges : [];
  const guidanceMessage = includeCalls && !symbolName
    ? "Code structure analyzed. Call graph skipped (no symbol match)."
    : (degraded
      ? (refinementReason === "document_file"
        ? "Document structure analyzed. Graph analysis is not available for documents."
        : "Partial analysis due to budget limits. Provide a stronger query or reduce scope for deep analysis.")
      : "Code structure analyzed. Enable include.{callGraph,dependencies,hotSpots,pageRank} for deeper analysis.");

  return {
    success: true,
    status,
    summary: `Analysis results for "${subject}".`,
    primaryFile: filePath,
    structure: skeleton,
    skeleton,
    symbols: isDocument ? [] : (profile?.structure?.symbols ?? []),
    document: docProfile
      ? {
          title: docProfile.title,
          outline: docProfile.outline ?? [],
          links: docProfile.links ?? [],
          mentions: docProfile.mentions ?? [],
          references: docReferences,
          relatedCode
        }
      : undefined,
    callGraph: callGraph ?? undefined,
    callGraphArtifactId,
    callGraphSummary,
    dependencies: dependencyEdges,
    relationships: {
      calls: undefined,
      dependencies: deps
    },
    hotSpots: hotSpots ?? [],
    report: {
      summary: `Analysis summary for ${filePath}.`,
      architecturalRole: "utility",
      complexity: {
        loc: profile?.metadata?.lineCount ?? 0,
        branches: 0,
        dependencies: dependencyEdges.length,
        fanIn: dependencyEdges.filter((e: any) => e?.to === filePath).length,
        fanOut: dependencyEdges.filter((e: any) => e?.from === filePath).length
      },
      risks: [],
      recommendations: []
    },
    integrity: integrityReport,
    stylePack,
    analysisPack,
    indexSnapshot,
    sessionId,
    compression,
    guidance: {
      message: guidanceMessage,
      suggestedActions: [
        {
          id: "read.view_full",
          priority: 1,
          description: "Load full content for this file.",
          rationale: "Full content provides complete context.",
          toolCall: { tool: "read", args: { action: "view_full", target: filePath } }
        },
        ...(callGraphArtifactId
          ? [
              {
                id: "manage.call_graph",
                priority: 2,
                description: "Inspect the call graph artifact summary.",
                rationale: "Use the graph summary to navigate callers/callees.",
                toolCall: { tool: "manage", args: { command: "artifact", target: callGraphArtifactId, detail: "summary" } }
              }
            ]
          : []),
        {
          id: "understand.expand",
          priority: callGraphArtifactId ? 3 : 2,
          description: "Expand analysis with call graph and dependencies.",
          rationale: "Deeper analysis improves confidence in changes.",
          toolCall: {
            tool: "understand",
            args: { action: "expand", goal: filePath, include: { callGraph: true, dependencies: true, hotSpots: true, pageRank: true } }
          }
        }
      ]
    },
    degraded,
    reasons: degradedReasons,
    degradedReasons: degradedReasonDetails,
    fallbackGraph,
    budget,
    refinement: {
      stage: allowGraphs ? "graph" : "skeleton",
      reason: refinementReason
    }
  };
}
