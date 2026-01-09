import type { DependencyGraph } from "../../../ast/DependencyGraph.js";
import { ConfigurationManager } from "../../../config/ConfigurationManager.js";
import { computePageRankFromEdges } from "./ImpactAnalysis.js";

export type ArchitecturalRisk = {
    cycleDetected: boolean;
    cycleDetails?: string[];
    coreImpactScore: number;
    affectedCoreModules: string[];
    riskLevel: "low" | "medium" | "high";
    mitigationSuggestions: string[];
    coreThreshold: number;
    maxDepth: number;
};

type ArchitecturalSafetyConfig = {
    coreThreshold: number;
    maxDepth: number;
};

export function resolveArchitecturalSafetyConfig(constraints: any): ArchitecturalSafetyConfig {
    const configured = constraints?.architecturalSafety ?? {};
    const defaults = ConfigurationManager.getArchitecturalSafetyConfig();
    return {
        coreThreshold: Number.isFinite(configured.coreThreshold)
            ? configured.coreThreshold
            : defaults.coreThreshold,
        maxDepth: Number.isFinite(configured.maxDepth)
            ? configured.maxDepth
            : defaults.maxDepth
    };
}

export function resolveArchitecturalBlockPolicy(constraints: any): "none" | "warn_only" | "high_only" | "all" {
    const configured = constraints?.architecturalSafety?.blockPolicy;
    const defaults = ConfigurationManager.getArchitecturalSafetyConfig();
    const policy = (configured ?? defaults.blockPolicy ?? "warn_only").toString().toLowerCase();
    if (policy === "none" || policy === "warn_only" || policy === "high_only" || policy === "all") {
        return policy as any;
    }
    return "warn_only";
}

export function isArchitecturalSafetyEnabled(constraints: any): boolean {
    const configured = constraints?.architecturalSafety?.enabled;
    if (typeof configured === "boolean") {
        return configured;
    }
    const defaults = ConfigurationManager.getArchitecturalSafetyConfig();
    return defaults.enabled !== false;
}

export function formatArchitecturalWarning(risk: ArchitecturalRisk): string {
    const issues: string[] = [];
    if (risk.cycleDetected) {
        issues.push("cycle detected");
    }
    if (risk.affectedCoreModules.length > 0) {
        issues.push("core modules affected");
    }
    if (issues.length === 0) {
        return "Architectural safety warning: elevated risk detected.";
    }
    return `Architectural safety warning: ${issues.join(" and ")}.`;
}

export function formatArchitecturalBlockMessage(risk: ArchitecturalRisk): string {
    const base = formatArchitecturalWarning(risk);
    return `${base} Change was blocked by architectural safety policy.`;
}

export async function assessArchitecturalRisk(args: {
    targetPath: string;
    deps?: any;
    impact?: any;
    dependencyGraph?: DependencyGraph;
    config: ArchitecturalSafetyConfig;
}): Promise<ArchitecturalRisk> {
    const { targetPath, deps, impact, dependencyGraph, config } = args;
    const edges = Array.isArray(deps?.edges) ? deps.edges : [];
    const pageRankScores = computePageRankFromEdges(edges);

    const impacted = new Set<string>([targetPath, ...(impact?.summary?.impactedFiles ?? [])].filter(Boolean));
    const incomingCounts = new Map<string, number>();
    for (const edge of edges) {
        const to = edge.to ?? edge.target;
        if (!to) continue;
        incomingCounts.set(to, (incomingCounts.get(to) ?? 0) + 1);
    }

    let totalScore = 0;
    for (const score of pageRankScores.values()) {
        totalScore += score;
    }

    const affectedCoreModules: string[] = [];
    let coreScore = 0;
    for (const filePath of impacted) {
        const score = pageRankScores.get(filePath) ?? 0;
        const incoming = incomingCounts.get(filePath) ?? 0;
        const isCore = score >= config.coreThreshold || incoming >= 10;
        if (isCore) {
            affectedCoreModules.push(filePath);
            coreScore += score;
        }
    }

    const coreImpactScore = totalScore > 0 ? coreScore / totalScore : 0;
    const { cycleDetected, cycleDetails } = await detectCycle(
        dependencyGraph,
        targetPath,
        config.maxDepth
    );

    let riskLevel: ArchitecturalRisk["riskLevel"] = "low";
    if (cycleDetected || coreImpactScore >= 0.3) {
        riskLevel = "high";
    } else if (affectedCoreModules.length > 0 || coreImpactScore >= 0.15) {
        riskLevel = "medium";
    }

    const mitigationSuggestions: string[] = [];
    if (cycleDetected) {
        mitigationSuggestions.push("Break the cycle by extracting shared types or introducing an interface boundary.");
    }
    if (affectedCoreModules.length > 0) {
        mitigationSuggestions.push("Add regression tests and consider a backward-compatible refactor for core modules.");
    }

    return {
        cycleDetected,
        cycleDetails,
        coreImpactScore: Number(coreImpactScore.toFixed(4)),
        affectedCoreModules,
        riskLevel,
        mitigationSuggestions,
        coreThreshold: config.coreThreshold,
        maxDepth: config.maxDepth
    };
}

async function detectCycle(
    dependencyGraph: DependencyGraph | undefined,
    targetPath: string,
    maxDepth: number
): Promise<{ cycleDetected: boolean; cycleDetails?: string[] }> {
    if (!dependencyGraph || !targetPath) {
        return { cycleDetected: false };
    }
    try {
        const [outgoing, incoming] = await Promise.all([
            dependencyGraph.getTransitiveDependencies(targetPath, "outgoing", maxDepth),
            dependencyGraph.getTransitiveDependencies(targetPath, "incoming", maxDepth)
        ]);
        const incomingSet = new Set(incoming);
        const overlap = outgoing.filter(entry => incomingSet.has(entry));
        if (overlap.length === 0) {
            return { cycleDetected: false };
        }
        return {
            cycleDetected: true,
            cycleDetails: overlap.slice(0, 5)
        };
    } catch {
        return { cycleDetected: false };
    }
}
