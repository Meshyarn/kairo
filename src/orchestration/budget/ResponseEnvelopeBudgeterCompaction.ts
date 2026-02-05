export function compactDraftPack(pack: any): any {
  if (!pack || typeof pack !== "object") return pack;
  return {
    id: pack.id,
    intent: pack.intent,
    status: pack.status,
    createdAt: pack.createdAt,
    fileVersions: pack.fileVersions,
    preflightCheck: pack.preflightCheck,
    workflowMeta: pack.workflowMeta
  };
}

export function compactReviewReport(report: any): any {
  if (!report || typeof report !== "object") return report;
  return {
    id: report.id,
    verdict: report.verdict,
    reviewedAt: report.reviewedAt,
    reviewedFiles: report.reviewedFiles,
    suggestedActions: Array.isArray(report.suggestedActions)
      ? report.suggestedActions.slice(0, 3)
      : undefined
  };
}

export function compactImpactReport(report: any): any {
  if (!report || typeof report !== "object") return report;
  const preview = report.preview && typeof report.preview === "object"
    ? {
        summary: report.preview.summary,
        riskLevel: report.preview.riskLevel,
        impactedFiles: Array.isArray(report.preview.summary?.impactedFiles)
          ? report.preview.summary.impactedFiles.slice(0, 10)
          : undefined
      }
    : undefined;
  return {
    breakingChangeRisk: report.breakingChangeRisk,
    suggestedTests: Array.isArray(report.suggestedTests) ? report.suggestedTests.slice(0, 5) : undefined,
    preview
  };
}

export function compactArtifact(artifact: any): any {
  if (!artifact || typeof artifact !== "object") return artifact;
  if (artifact.type === "draft" && artifact.pack) {
    return { ...artifact, pack: compactDraftPack(artifact.pack) };
  }
  if (artifact.type === "review" && artifact.report) {
    return { ...artifact, report: compactReviewReport(artifact.report) };
  }
  if (artifact.type === "analysis" && artifact.pack) {
    const pack = artifact.pack;
    return {
      ...artifact,
      pack: {
        id: pack.id,
        goal: pack.goal,
        clusters: Array.isArray(pack.clusters) ? pack.clusters.slice(0, 3) : [],
        createdAt: pack.createdAt,
        degraded: pack.degraded
      }
    };
  }
  if (artifact.type === "research" && artifact.pack) {
    const pack = artifact.pack;
    return {
      ...artifact,
      pack: {
        id: pack.id,
        createdAt: pack.createdAt,
        expiresAt: pack.expiresAt,
        sketch: pack.sketch
          ? {
              summary: pack.sketch.summary,
              topModules: Array.isArray(pack.sketch.topModules) ? pack.sketch.topModules.slice(0, 3) : [],
              edgesSample: Array.isArray(pack.sketch.edgesSample) ? pack.sketch.edgesSample.slice(0, 5) : []
            }
          : undefined
      }
    };
  }
  if (artifact.type === "style" && artifact.pack) {
    const pack = artifact.pack;
    return {
      ...artifact,
      pack: {
        id: pack.id,
        scope: pack.scope,
        createdAt: pack.createdAt,
        confidence: pack.confidence,
        profile: pack.profile ? { codeStyle: pack.profile.codeStyle } : undefined
      }
    };
  }
  if (artifact.type === "evidence" && artifact.pack) {
    const pack = artifact.pack;
    return {
      ...artifact,
      pack: {
        id: pack.id,
        intent: pack.intent,
        createdAt: pack.createdAt,
        expiresAt: pack.expiresAt,
        rankedFiles: Array.isArray(pack.rankedFiles) ? pack.rankedFiles.slice(0, 10) : [],
        evidence: Array.isArray(pack.evidence) ? pack.evidence.slice(0, 3) : [],
        caps: pack.caps,
        degraded: pack.degraded,
        degradedReasons: pack.degradedReasons
      }
    };
  }
  return artifact;
}
