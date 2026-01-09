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
  calls?: any;
  deps?: any;
  hotSpots?: any[];
  integrityReport?: any;
  includeCalls: boolean;
  degraded: boolean;
  refinementReason?: string;
  budget: any;
  allowGraphs: boolean;
  indexSnapshot?: any;
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
    calls,
    deps,
    hotSpots,
    integrityReport,
    includeCalls,
    degraded,
    refinementReason,
    budget,
    allowGraphs,
    indexSnapshot
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
    callGraph: calls ?? undefined,
    dependencies: dependencyEdges,
    relationships: {
      calls: calls,
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
    indexSnapshot,
    guidance: {
      message: guidanceMessage,
      suggestedActions: [
        { pillar: "read", action: "view_full", target: filePath },
        { pillar: "understand", action: "expand", goal: filePath, include: { callGraph: true, dependencies: true, hotSpots: true, pageRank: true } }
      ]
    },
    degraded,
    budget,
    refinement: {
      stage: allowGraphs ? "graph" : "skeleton",
      reason: refinementReason
    }
  };
}
