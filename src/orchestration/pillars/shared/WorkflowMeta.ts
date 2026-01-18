import type { FlowArtifactManager } from "../../flow-artifact-manager.js";
import type { StylePack, WorkflowMeta } from "../../../types/flow-artifacts.js";

export function buildWorkflowMeta(args: {
    sessionId?: string;
    dryRun: boolean;
    stylePack?: StylePack;
    artifactManager?: FlowArtifactManager;
}): WorkflowMeta {
    const sessionArtifacts = args.sessionId && args.artifactManager
        ? args.artifactManager.getBySession(args.sessionId)
        : [];
    const hasResearch = sessionArtifacts.some((artifact: any) => artifact.type === "research");
    const hasAnalysis = sessionArtifacts.some((artifact: any) => artifact.type === "analysis");
    const hasStylePack = Boolean(args.stylePack);
    const dryRunUsed = args.dryRun;
    const confidence: WorkflowMeta["confidence"] =
        hasResearch && hasAnalysis && hasStylePack && dryRunUsed
            ? "high"
            : (hasStylePack || hasAnalysis || dryRunUsed)
                ? "medium"
                : "low";
    const reasons: string[] = [];
    if (!hasResearch) reasons.push("missing_research");
    if (!hasAnalysis) reasons.push("missing_analysis");
    if (!hasStylePack) reasons.push("missing_style_pack");
    if (!dryRunUsed) reasons.push("dry_run_disabled");
    return {
        confidence,
        reasons,
        workflowStatus: {
            hasResearch,
            hasAnalysis,
            hasStylePack,
            dryRunUsed
        }
    };
}

export function buildWorkflowWarnings(meta: WorkflowMeta, hasSession: boolean): string[] {
    const warnings: string[] = [];
    if (hasSession && !meta.workflowStatus.hasStylePack) {
        warnings.push("No StylePack found in session. Consider running understand({ vibe: { extract: true } }).");
    }
    if (hasSession && !meta.workflowStatus.hasAnalysis) {
        warnings.push("No AnalysisPack found in session. Consider running understand({ analysis: { clusters: true } }).");
    }
    if (hasSession && !meta.workflowStatus.hasResearch) {
        warnings.push("No ResearchPack found in session. Consider running explore({ research: { sketch: true } }).");
    }
    if (!meta.workflowStatus.dryRunUsed) {
        warnings.push("Applied changes without dryRun; review is recommended before apply.");
    }
    return warnings;
}
