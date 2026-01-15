import path from "path";
import { Edit, type DefinitionSymbol, type SymbolInfo } from "../../types.js";
import { ConfigurationManager } from "../../config/ConfigurationManager.js";
import { DependencyGraph } from "../../ast/DependencyGraph.js";
import { ModuleResolver } from "../../ast/ModuleResolver.js";
import { AstManager } from "../../ast/AstManager.js";
import { UnifiedExtractor } from "../../ast/extraction/UnifiedExtractor.js";
import { computePageRankFromEdges } from "../pillars/change/ImpactAnalysis.js";
import { IndexSnapshot, IndexStateManager } from "../../indexing/IndexStateManager.js";
import { EditPlanner } from "../../engine/editor/EditPlanning.js";
import { TextNormalizer } from "../../utils/textNormalization.js";
import type { ImportInfo, ExportInfo } from "../../indexing/ProjectIndex.js";
import { normalizePath, toRelativePath } from "../../utils/PathHelpers.js";
import { AstDiffEngine, type AstChange } from "../../ast/AstDiffEngine.js";
import { getSupportForFilePath, SupportLevel } from "../../config/LanguageSupportLevels.js";
import { metrics } from "../../utils/MetricsCollector.js";

type GuardrailStatus = "pass" | "warn" | "block";
type LanguageParityMode = "strict" | "balanced" | "permissive";
type GuardrailBlockPolicy = "none" | "warn_only" | "high_only" | "all";

export type GuardrailWarning = {
    type: string;
    severity: "low" | "medium" | "high";
    message: string;
    details?: Record<string, unknown>;
};

export type GuardrailViolation = {
    type: string;
    message: string;
    details?: Record<string, unknown>;
};

export type SafetyChecklistItem = {
    id: string;
    description: string;
    required: boolean;
    completed?: boolean;
    status?: string;
};

export type IntegrityGuardrailsResult = {
    status: GuardrailStatus;
    architecturalRisk?: Record<string, unknown>;
    architecturalWarnings?: string[];
    warnings?: GuardrailWarning[];
    violations?: GuardrailViolation[];
    safetyChecklist?: SafetyChecklistItem[];
    blockingErrors?: string[];
    errorCode?: string;
    blockedReason?: string;
    parityDegraded?: boolean;
    parityConfidence?: "low" | "medium";
    indexSnapshot?: IndexSnapshot;
};

type LayerRulesConfig = {
    layers: Array<{ name: string; match: string[] }>;
    allow?: Array<{ from: string; to: string }>;
    deny?: Array<{ from: string; to: string }>;
};

type IntegrityGuardrailsConfig = {
    enabled: boolean;
    layerRules?: LayerRulesConfig;
    coreProtection: {
        pageRankThreshold: number;
        incomingCountThreshold: number;
        blockPolicy: GuardrailBlockPolicy;
    };
    protocolProtection: {
        files: string[];
        forbiddenTokens: string[];
        allowlist?: Array<{ file: string; tokens: string[]; reason: string }>;
    };
    publicSurfaceMonitor: {
        enabled: boolean;
        impactThreshold: number;
        requireBatchRefactoring: boolean;
    };
    languageParity: {
        mode: LanguageParityMode;
        fallbackConfidence: "low" | "medium";
    };
    performance: {
        pageRankCacheTTL: number;
    };
};

type GuardrailContext = {
    targetPath: string;
    oldContent?: string | null;
    newContent?: string | null;
    edits?: Edit[];
    dependencyGraph?: DependencyGraph;
    indexStateManager?: IndexStateManager;
    constraints?: any;
    runTool?: (tool: string, args: any) => Promise<any>;
    applyMode?: boolean;
};

const DEFAULT_PROTOCOL_FILES = ["src/utils/StdoutGuard.ts", "src/server/**"];
const DEFAULT_FORBIDDEN_TOKENS = ["process.stdout", "process.stderr", "console.log"];
const DEFAULT_DIRTY_FILE_THRESHOLD = 100;

let cachedPageRank: {
    timestamp: number;
    edgeCount: number;
    ranks: Map<string, number>;
} | null = null;

export function resolveIntegrityGuardrailsConfig(constraints?: any): IntegrityGuardrailsConfig {
    const defaults = ConfigurationManager.getIntegrityGuardrailsConfig();
    const override = constraints?.integrityGuardrails ?? {};
    return {
        ...defaults,
        ...override,
        layerRules: override.layerRules ?? defaults.layerRules,
        coreProtection: {
            ...defaults.coreProtection,
            ...(override.coreProtection ?? {})
        },
        protocolProtection: {
            ...defaults.protocolProtection,
            ...(override.protocolProtection ?? {})
        },
        publicSurfaceMonitor: {
            ...defaults.publicSurfaceMonitor,
            ...(override.publicSurfaceMonitor ?? {})
        },
        languageParity: {
            ...defaults.languageParity,
            ...(override.languageParity ?? {})
        },
        performance: {
            ...defaults.performance,
            ...(override.performance ?? {})
        }
    };
}

export async function evaluateIntegrityGuardrails(args: GuardrailContext): Promise<IntegrityGuardrailsResult> {
    const stopTimer = metrics.startTimer("guardrails.integrity_total_ms", "detailed");
    try {
    const config = resolveIntegrityGuardrailsConfig(args.constraints);
    if (!config.enabled) {
        return { status: "pass" };
    }

    const warnings: GuardrailWarning[] = [];
    const violations: GuardrailViolation[] = [];
    const blockingErrors: string[] = [];
    const architecturalWarnings: string[] = [];
    let safetyChecklist: SafetyChecklistItem[] | undefined;
    let parityDegraded = false;
    let parityConfidence: "low" | "medium" | undefined;
    let blockedReason: string | undefined;
    let errorCode: string | undefined;
    let status: GuardrailStatus = "pass";
    let indexSnapshot: IndexSnapshot | undefined;
    const applyMode = args.applyMode ?? false;

    if (args.indexStateManager) {
        indexSnapshot = await args.indexStateManager.getSnapshot();
    }
    const staleGuardActive = Boolean(
        indexSnapshot &&
        (indexSnapshot.staleRisk === "high" || indexSnapshot.dirtyFileCount >= DEFAULT_DIRTY_FILE_THRESHOLD)
    );
    if (staleGuardActive) {
        warnings.push({
            type: "INDEX_STALE_HIGH",
            severity: "medium",
            message: "Index staleness is high; risk assessment confidence is reduced.",
            details: indexSnapshot
        });
    }

    const contentAvailable = typeof args.newContent === "string";
    const oldContent = args.oldContent ?? "";
    const newContent = contentAvailable ? (args.newContent as string) : oldContent;

    const astManager = AstManager.getInstance();
    const languageId = astManager.getLanguageId(args.targetPath);
    const support = getSupportForFilePath(args.targetPath);
    if (support?.editPolicy?.warnOnEdit) {
        warnings.push({
            type: "language_support_degraded",
            severity: "medium",
            message: `${languageId} is L2 (understand-grade). Edit safety is best-effort.`,
            details: { languageId, supportLevel: support.level }
        });
    }
    if (support?.level === SupportLevel.L3 && Array.isArray(support.editPolicy.requireQueries)) {
        for (const queryName of support.editPolicy.requireQueries) {
            const availability = await resolveParityAvailability(astManager, args.targetPath, languageId, queryName);
            if (!availability.available) {
                status = "block";
                blockedReason = "language_parity_missing";
                errorCode = "LANGUAGE_PARITY_MISSING";
                blockingErrors.push("LANGUAGE_PARITY_MISSING");
                break;
            }
        }
    }
    const moduleResolver = new ModuleResolver(process.cwd());
    const extractor = new UnifiedExtractor(astManager.getQueryProvider(), {
        moduleResolver
    });

    const { imports: newImports, parity: importsParity } = await extractImportsWithParity({
        filePath: args.targetPath,
        content: newContent,
        languageId,
        mode: config.languageParity.mode,
        extractor,
        astManager,
        moduleResolver
    });

    const { imports: oldImports } = await extractImportsWithParity({
        filePath: args.targetPath,
        content: oldContent,
        languageId,
        mode: config.languageParity.mode,
        extractor,
        astManager,
        moduleResolver
    });

    if (importsParity.degraded) {
        parityDegraded = true;
        parityConfidence = importsParity.confidence;
    }

    if (importsParity.blocked) {
        status = "block";
        blockedReason = "language_parity_missing";
        blockingErrors.push("LANGUAGE_PARITY_MISSING");
    }

    const cycleResult = await evaluateCycleAndLayers({
        targetPath: args.targetPath,
        dependencyGraph: args.dependencyGraph,
        newImports,
        oldImports,
        layerRules: config.layerRules
    });

    if (cycleResult.cycleDetected) {
        blockingErrors.push("CYCLE_DETECTED");
        violations.push({
            type: "cycle_detected",
            message: "Cycle detected in proposed dependency changes.",
            details: { cycleDetails: cycleResult.cycleDetails }
        });
    }

    if (cycleResult.layerViolations.length > 0) {
        blockingErrors.push("LAYER_RULE_VIOLATION");
        violations.push({
            type: "layer_rule_violation",
            message: "Layer rules violated by proposed imports.",
            details: { violations: cycleResult.layerViolations }
        });
    }

    const coreResult = await evaluateCoreProtection({
        targetPath: args.targetPath,
        dependencyGraph: args.dependencyGraph,
        config,
        indexSnapshot
    });

    if (coreResult.isCore) {
        safetyChecklist = coreResult.checklist;
        architecturalWarnings.push("Core file modification detected.");
    }

    const protocolResult = contentAvailable
        ? evaluateProtocolViolations({
            filePath: args.targetPath,
            content: newContent,
            config: config.protocolProtection
        })
        : { violations: [], blocked: false };

    if (protocolResult.violations.length > 0) {
        blockingErrors.push("PROTOCOL_POLLUTION_DETECTED");
        violations.push({
            type: "protocol_pollution",
            message: "Protocol violation detected in protected file.",
            details: { violations: protocolResult.violations }
        });
    }

    let publicSurface: PublicSurfaceResult | undefined;
    if (config.publicSurfaceMonitor.enabled) {
        const exportResult = await extractExportsWithParity({
            filePath: args.targetPath,
            content: newContent,
            languageId,
            mode: config.languageParity.mode,
            extractor,
            astManager,
            moduleResolver
        });
        const oldExportResult = await extractExportsWithParity({
            filePath: args.targetPath,
            content: oldContent,
            languageId,
            mode: config.languageParity.mode,
            extractor,
            astManager,
            moduleResolver
        });

        if (exportResult.parity.degraded || oldExportResult.parity.degraded) {
            parityDegraded = true;
            parityConfidence = config.languageParity.fallbackConfidence;
        }

        if (exportResult.parity.blocked || oldExportResult.parity.blocked) {
            status = "block";
            blockedReason = "language_parity_missing";
            blockingErrors.push("LANGUAGE_PARITY_MISSING");
        } else {
            publicSurface = await evaluatePublicSurfaceChanges({
                filePath: args.targetPath,
                oldExports: oldExportResult.exports,
                newExports: exportResult.exports,
                oldContent,
                newContent,
                languageId,
                mode: config.languageParity.mode,
                extractor,
                astManager,
                impactThreshold: config.publicSurfaceMonitor.impactThreshold,
                runTool: args.runTool
            });
            if (publicSurface.requiresBatchRefactoring) {
                warnings.push({
                    type: "public_surface_change",
                    severity: publicSurface.riskLevel === "high" ? "high" : "medium",
                    message: "Public surface change affects multiple files.",
                    details: publicSurface
                });
            }

            if (publicSurface.parity?.degraded) {
                parityDegraded = true;
                parityConfidence = config.languageParity.fallbackConfidence;
            }
            if (publicSurface.parity?.blocked) {
                status = "block";
                blockedReason = blockedReason ?? "language_parity_missing";
                if (!blockingErrors.includes("LANGUAGE_PARITY_MISSING")) {
                    blockingErrors.push("LANGUAGE_PARITY_MISSING");
                }
            }
        }
    }

    const criticalBlocking = blockingErrors.some(code =>
        code === "CYCLE_DETECTED" ||
        code === "LAYER_RULE_VIOLATION" ||
        code === "PROTOCOL_POLLUTION_DETECTED"
    );

    const effectiveCorePolicy: GuardrailBlockPolicy =
        staleGuardActive && config.coreProtection.blockPolicy === "warn_only"
            ? "high_only"
            : config.coreProtection.blockPolicy;
    const shouldBlockCore = coreResult.isCore && shouldBlockForPolicy(effectiveCorePolicy, "high") && applyMode;
    const shouldBlockPublicSurface = Boolean(
        (publicSurface?.requiresBatchRefactoring || (staleGuardActive && publicSurface?.hasChanges)) &&
        config.publicSurfaceMonitor.requireBatchRefactoring &&
        applyMode
    );

    if (status !== "block") {
        if (criticalBlocking || shouldBlockCore || shouldBlockPublicSurface) {
            status = "block";
            blockedReason = blockedReason ?? (criticalBlocking
                ? "architecture_violation"
                : shouldBlockPublicSurface
                    ? (staleGuardActive && publicSurface?.hasChanges && !publicSurface?.requiresBatchRefactoring
                        ? "index_stale_high"
                        : "public_surface_change")
                    : "core_protection");
            if (criticalBlocking) {
                errorCode = "ARCHITECTURE_BLOCKED";
            } else if (shouldBlockPublicSurface) {
                errorCode = "ARCHITECTURE_BLOCKED";
                blockingErrors.push("PUBLIC_SURFACE_CHANGED");
            } else {
                errorCode = "CORE_PROTECTION_BLOCKED";
                blockingErrors.push("CORE_PROTECTION_TRIGGERED");
            }
        } else if (blockingErrors.length > 0 || coreResult.isCore || publicSurface?.hasChanges) {
            status = "warn";
        }
    }

    if (protocolResult.violations.length > 0) {
        status = "block";
        errorCode = "PROTOCOL_BLOCKED";
        blockedReason = "protocol_pollution";
    }

    if (status === "warn" && blockingErrors.length === 0) {
        if (coreResult.isCore) {
            blockingErrors.push("CORE_PROTECTION_TRIGGERED");
        }
        if (publicSurface?.hasChanges) {
            blockingErrors.push("PUBLIC_SURFACE_CHANGED");
        }
    }

    const riskLevel = coreResult.isCore || criticalBlocking ? "high" : status === "warn" ? "medium" : "low";

    const architecturalRisk: Record<string, unknown> = {
        riskLevel,
        cycleDetected: cycleResult.cycleDetected,
        cycleDetails: cycleResult.cycleDetails,
        layerViolations: cycleResult.layerViolations,
        coreFileImpact: coreResult.isCore ? coreResult.details : undefined,
        publicSurface: publicSurface,
        confidence: parityDegraded ? "low" : "high"
    };

    if (cycleResult.cycleDetected) {
        architecturalWarnings.push("Cycle detected in dependency graph.");
    }
    if (cycleResult.layerViolations.length > 0) {
        architecturalWarnings.push("Layer rule violation detected.");
    }
    if (protocolResult.violations.length > 0) {
        architecturalWarnings.push("Protocol violation detected.");
    }

    if (architecturalWarnings.length > 0 && status === "pass") {
        status = "warn";
    }

    if (status === "block") {
        metrics.inc("guardrails.blocked_total");
    } else if (status === "warn") {
        metrics.inc("guardrails.warn_total");
    }

    return {
        status,
        architecturalRisk,
        architecturalWarnings: architecturalWarnings.length > 0 ? architecturalWarnings : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
        violations: violations.length > 0 ? violations : undefined,
        safetyChecklist,
        blockingErrors: blockingErrors.length > 0 ? blockingErrors : undefined,
        errorCode,
        blockedReason,
        parityDegraded: parityDegraded || undefined,
        parityConfidence,
        indexSnapshot
    };
    } finally {
        stopTimer();
    }
}

type ParityResult = {
    degraded: boolean;
    blocked: boolean;
    confidence?: "low" | "medium";
};

type ImportExtractionResult = {
    imports: ImportInfo[];
    parity: ParityResult;
};

type ExportExtractionResult = {
    exports: ExportInfo[];
    parity: ParityResult;
};

async function extractImportsWithParity(args: {
    filePath: string;
    content: string;
    languageId: string;
    mode: LanguageParityMode;
    extractor: UnifiedExtractor;
    astManager: AstManager;
    moduleResolver: ModuleResolver;
}): Promise<ImportExtractionResult> {
    const parity = await resolveParityAvailability(args.astManager, args.filePath, args.languageId, "imports");
    if (!parity.available && args.mode === "strict") {
        return { imports: [], parity: { degraded: false, blocked: true } };
    }
    if (parity.available) {
        return {
            imports: await args.extractor.extractImports(args.filePath, args.content, args.languageId, {
                docProvider: () => args.astManager.parseFile(args.filePath, args.content)
            }),
            parity: { degraded: false, blocked: false }
        };
    }
    const fallback = await fallbackExtractImports(args);
    return {
        imports: fallback,
        parity: {
            degraded: true,
            blocked: false,
            confidence: args.mode === "balanced" ? "low" : "medium"
        }
    };
}

async function extractExportsWithParity(args: {
    filePath: string;
    content: string;
    languageId: string;
    mode: LanguageParityMode;
    extractor: UnifiedExtractor;
    astManager: AstManager;
    moduleResolver: ModuleResolver;
}): Promise<ExportExtractionResult> {
    const parity = await resolveParityAvailability(args.astManager, args.filePath, args.languageId, "exports");
    if (!parity.available && args.mode === "strict") {
        return { exports: [], parity: { degraded: false, blocked: true } };
    }
    if (parity.available) {
        return {
            exports: await args.extractor.extractExports(args.filePath, args.content, args.languageId, {
                docProvider: () => args.astManager.parseFile(args.filePath, args.content)
            }),
            parity: { degraded: false, blocked: false }
        };
    }
    const fallback = await fallbackExtractExports(args);
    return {
        exports: fallback,
        parity: {
            degraded: true,
            blocked: false,
            confidence: args.mode === "balanced" ? "low" : "medium"
        }
    };
}

async function resolveParityAvailability(
    astManager: AstManager,
    filePath: string,
    languageId: string,
    queryName: string
): Promise<{ available: boolean }> {
    try {
        const language = await astManager.getLanguageForFile(filePath);
        if (!language) {
            return { available: false };
        }
        const query = await astManager.getQueryProvider().getQuery(language, languageId, queryName);
        return { available: Boolean(query) };
    } catch {
        return { available: false };
    }
}

async function fallbackExtractImports(args: {
    filePath: string;
    content: string;
    languageId: string;
    extractor: UnifiedExtractor;
    moduleResolver: ModuleResolver;
}): Promise<ImportInfo[]> {
    if (args.extractor.supportsRegex(args.languageId)) {
        return args.extractor.extractImports(args.filePath, args.content, args.languageId, {
            preferBackend: "regex"
        });
    }
    const matches = extractFallbackImportSpecifiers(args.content);
    return matches.map(item => ({
        specifier: item.specifier,
        resolvedPath: args.moduleResolver.resolve(args.filePath, item.specifier) ?? undefined,
        what: [],
        line: item.line,
        importType: "named"
    }));
}

async function fallbackExtractExports(args: {
    filePath: string;
    content: string;
    languageId: string;
    extractor: UnifiedExtractor;
}): Promise<ExportInfo[]> {
    if (args.extractor.supportsRegex(args.languageId)) {
        return args.extractor.extractExports(args.filePath, args.content, args.languageId, {
            preferBackend: "regex"
        });
    }
    const matches = extractFallbackExportNames(args.content);
    return matches.map(item => ({
        name: item.name,
        exportType: item.exportType,
        line: item.line,
        isReExport: false
    }));
}

function extractFallbackImportSpecifiers(content: string): Array<{ specifier: string; line: number }> {
    const patterns = [
        /\bimport\s+[^'"]*['"]([^'"]+)['"]/g,
        /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        /^\s*#include\s+[<"]([^">]+)[">]/gm,
        /\bfrom\s+['"]([^'"]+)['"]\s+import\s+/g
    ];
    const results: Array<{ specifier: string; line: number }> = [];
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const pattern of patterns) {
            pattern.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = pattern.exec(line)) !== null) {
                if (!match[1]) continue;
                results.push({ specifier: match[1], line: i + 1 });
            }
        }
    }
    return results;
}

function extractFallbackExportNames(content: string): Array<{ name: string; exportType: "named" | "default"; line: number }> {
    const patterns = [
        /\bexport\s+(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z0-9_]+)/g,
        /\bexport\s+default\b/g,
        /\bpublic\s+(?:class|interface|enum)\s+([A-Za-z0-9_]+)/g,
        /\bpub\s+fn\s+([A-Za-z0-9_]+)/g,
        /\bdef\s+([A-Za-z0-9_]+)\s*\(/g
    ];
    const results: Array<{ name: string; exportType: "named" | "default"; line: number }> = [];
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const pattern of patterns) {
            pattern.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = pattern.exec(line)) !== null) {
                if (pattern.source.includes("export\\s+default")) {
                    results.push({ name: "default", exportType: "default", line: i + 1 });
                    continue;
                }
                const name = match[1];
                if (!name) continue;
                results.push({ name, exportType: "named", line: i + 1 });
            }
        }
    }
    return results;
}

async function evaluateCycleAndLayers(args: {
    targetPath: string;
    dependencyGraph?: DependencyGraph;
    newImports: ImportInfo[];
    oldImports: ImportInfo[];
    layerRules?: LayerRulesConfig;
}): Promise<{
    cycleDetected: boolean;
    cycleDetails: string[];
    layerViolations: Array<{ from: string; to: string; fromLayer: string | null; toLayer: string | null }>;
}> {
    const cycleDetails: string[] = [];
    const layerViolations: Array<{ from: string; to: string; fromLayer: string | null; toLayer: string | null }> = [];
    let cycleDetected = false;

    const addedTargets = diffResolvedTargets(args.newImports, args.oldImports);
    const fromPath = normalizePath(toRelativePath(process.cwd(), args.targetPath));
    if (args.layerRules?.layers?.length && addedTargets.length > 0) {
        const fromLayer = resolveLayer(args.targetPath, args.layerRules);
        for (const target of addedTargets) {
            const toLayer = resolveLayer(target, args.layerRules);
            if (!isAllowedLayerDependency(fromLayer, toLayer, args.layerRules)) {
                layerViolations.push({
                    from: fromPath,
                    to: normalizePath(target),
                    fromLayer,
                    toLayer
                });
            }
        }
    }

    if (args.dependencyGraph && addedTargets.length > 0) {
        try {
            await args.dependencyGraph.ensureBuilt();
            const edges = args.dependencyGraph.listAllEdges();
            const adjacency = buildAdjacencyMap(edges);
            for (const target of addedTargets) {
                const toPath = normalizePath(target);
                addEdge(adjacency, fromPath, toPath);
            }
            const cycles = detectCycles(adjacency, [fromPath, ...addedTargets], 2);
            if (cycles.length > 0) {
                cycleDetected = true;
                cycleDetails.push(...cycles);
            }
        } catch {
            // ignore graph failures
        }
    }

    return { cycleDetected, cycleDetails, layerViolations };
}

function diffResolvedTargets(newImports: ImportInfo[], oldImports: ImportInfo[]): string[] {
    const normalize = (value?: string) => (value ? normalizePath(toRelativePath(process.cwd(), value)) : "");
    const oldSet = new Set(oldImports.map(imp => normalize(imp.resolvedPath)).filter(Boolean));
    const added: string[] = [];
    for (const imp of newImports) {
        const resolved = imp.resolvedPath
            ? normalizePath(toRelativePath(process.cwd(), imp.resolvedPath))
            : "";
        if (!resolved || oldSet.has(resolved)) continue;
        added.push(resolved);
    }
    return added;
}

function buildAdjacencyMap(edges: Array<{ from?: string; to?: string }>): Map<string, Set<string>> {
    const adjacency = new Map<string, Set<string>>();
    for (const edge of edges) {
        if (!edge.from || !edge.to) continue;
        const from = normalizePath(toRelativePath(process.cwd(), edge.from));
        const to = normalizePath(toRelativePath(process.cwd(), edge.to));
        if (!adjacency.has(from)) {
            adjacency.set(from, new Set());
        }
        adjacency.get(from)!.add(to);
    }
    return adjacency;
}

function addEdge(adjacency: Map<string, Set<string>>, from: string, to: string): void {
    if (!adjacency.has(from)) {
        adjacency.set(from, new Set());
    }
    adjacency.get(from)!.add(to);
}

function detectCycles(
    adjacency: Map<string, Set<string>>,
    starts: string[],
    maxCycles: number
): string[] {
    const startSet = new Set(starts.map(node => normalizePath(node)));
    const reachable = collectReachable(adjacency, startSet, 2000);
    const nodes = Array.from(reachable);
    if (nodes.length === 0) return [];

    const indexMap = new Map<string, number>();
    const lowlink = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const cycles: string[] = [];
    let index = 0;

    const strongConnect = (node: string) => {
        indexMap.set(node, index);
        lowlink.set(node, index);
        index += 1;
        stack.push(node);
        onStack.add(node);

        const neighbors = adjacency.get(node) ?? new Set<string>();
        for (const next of neighbors) {
            if (!reachable.has(next)) continue;
            if (!indexMap.has(next)) {
                strongConnect(next);
                lowlink.set(node, Math.min(lowlink.get(node)!, lowlink.get(next)!));
            } else if (onStack.has(next)) {
                lowlink.set(node, Math.min(lowlink.get(node)!, indexMap.get(next)!));
            }
        }

        if (lowlink.get(node) === indexMap.get(node)) {
            const scc: string[] = [];
            let w: string | undefined;
            do {
                w = stack.pop();
                if (!w) break;
                onStack.delete(w);
                scc.push(w);
            } while (w !== node);

            if (scc.length > 1 && scc.some(entry => startSet.has(entry))) {
                cycles.push(scc.join(" -> "));
            }
        }
    };

    for (const node of nodes) {
        if (cycles.length >= maxCycles) break;
        if (!indexMap.has(node)) {
            strongConnect(node);
        }
    }

    return cycles.slice(0, maxCycles);
}

function collectReachable(
    adjacency: Map<string, Set<string>>,
    starts: Set<string>,
    maxNodes: number
): Set<string> {
    const queue = Array.from(starts);
    const reachable = new Set<string>();
    while (queue.length > 0 && reachable.size < maxNodes) {
        const node = queue.shift()!;
        if (reachable.has(node)) continue;
        reachable.add(node);
        const neighbors = adjacency.get(node);
        if (!neighbors) continue;
        for (const next of neighbors) {
            if (!reachable.has(next)) {
                queue.push(next);
            }
        }
    }
    return reachable;
}

function resolveLayer(filePath: string, rules: LayerRulesConfig): string | null {
    const normalized = normalizePath(toRelativePath(process.cwd(), filePath));
    for (const layer of rules.layers) {
        if (layer.match.some(pattern => matchGlob(normalized, pattern))) {
            return layer.name;
        }
    }
    return null;
}

function isAllowedLayerDependency(fromLayer: string | null, toLayer: string | null, rules: LayerRulesConfig): boolean {
    if (!fromLayer || !toLayer) return true;
    if (rules.deny?.some(rule => rule.from === fromLayer && rule.to === toLayer)) {
        return false;
    }
    if (rules.allow?.length) {
        return rules.allow.some(rule => rule.from === fromLayer && rule.to === toLayer);
    }
    return true;
}

function matchGlob(value: string, pattern: string): boolean {
    const normalized = normalizePath(value);
    const normalizedPattern = normalizePath(pattern);
    const regex = globToRegex(normalizedPattern);
    return regex.test(normalized);
}

function globToRegex(pattern: string): RegExp {
    const escaped = pattern
        .replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&")
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^/]*");
    return new RegExp(`^${escaped}$`);
}

async function evaluateCoreProtection(args: {
    targetPath: string;
    dependencyGraph?: DependencyGraph;
    config: IntegrityGuardrailsConfig;
    indexSnapshot?: IndexSnapshot;
}): Promise<{
    isCore: boolean;
    details?: Record<string, unknown>;
    checklist?: SafetyChecklistItem[];
}> {
    if (!args.dependencyGraph) {
        return { isCore: false };
    }
    try {
        await args.dependencyGraph.ensureBuilt();
        const ranks = await getPageRank(args.dependencyGraph, args.config.performance.pageRankCacheTTL);
        const targetRelative = normalizePath(toRelativePath(process.cwd(), args.targetPath));
        const pageRank = ranks.get(targetRelative) ?? ranks.get(normalizePath(args.targetPath)) ?? 0;
        const incoming = await args.dependencyGraph.getDependencies(args.targetPath, "upstream");
        const incomingCount = incoming.length;
        const isCoreByRank = pageRank >= args.config.coreProtection.pageRankThreshold;
        const isCoreByDeps = incomingCount >= args.config.coreProtection.incomingCountThreshold;
        const isCore = isCoreByRank || isCoreByDeps;
        if (!isCore) {
            return { isCore: false };
        }
        const checklist = buildSafetyChecklist(args.targetPath, pageRank, incomingCount);
        return {
            isCore,
            details: {
                file: targetRelative,
                pageRank: Number(pageRank.toFixed(4)),
                incomingDependencies: incomingCount,
                reason: isCoreByRank ? "high_pagerank" : "high_dependency_count",
                staleRisk: args.indexSnapshot?.staleRisk ?? "low"
            },
            checklist
        };
    } catch {
        return { isCore: false };
    }
}

async function getPageRank(graph: DependencyGraph, ttlMs: number): Promise<Map<string, number>> {
    const edges = graph.listAllEdges();
    const edgeCount = edges.length;
    const now = Date.now();
    if (cachedPageRank && cachedPageRank.edgeCount === edgeCount && now - cachedPageRank.timestamp < ttlMs) {
        return cachedPageRank.ranks;
    }
    const ranks = computePageRankFromEdges(edges);
    cachedPageRank = { timestamp: now, edgeCount, ranks };
    return ranks;
}

function buildSafetyChecklist(filePath: string, pageRank: number, incoming: number): SafetyChecklistItem[] {
    const relative = normalizePath(toRelativePath(process.cwd(), filePath));
    const items: SafetyChecklistItem[] = [
        {
            id: "impact_review",
            description: `Review all ${incoming} files that depend on ${relative}`,
            required: true
        },
        {
            id: "backward_compat",
            description: "Ensure backward compatibility or document breaking changes",
            required: true
        },
        {
            id: "test_coverage",
            description: "Add/update tests for modified functionality",
            required: true
        }
    ];
    if (pageRank >= 0.5) {
        items.push({
            id: "architecture_review",
            description: "Get architecture approval for top-tier core file changes",
            required: true
        });
    }
    if (incoming >= 50) {
        items.push({
            id: "gradual_rollout",
            description: "Consider feature flag or gradual rollout",
            required: false
        });
    }
    return items;
}

function evaluateProtocolViolations(args: {
    filePath: string;
    content: string;
    config: IntegrityGuardrailsConfig["protocolProtection"];
}): { violations: Array<Record<string, unknown>>; blocked: boolean } {
    if (!args.config.files || args.config.files.length === 0) {
        return { violations: [], blocked: false };
    }
    const normalizedPath = normalizePath(toRelativePath(process.cwd(), args.filePath));
    const isProtected = args.config.files.some(pattern => matchGlob(normalizedPath, pattern));
    if (!isProtected) {
        return { violations: [], blocked: false };
    }
    const allowlist = args.config.allowlist ?? [];
    const lines = args.content.split(/\r?\n/);
    const violations: Array<Record<string, unknown>> = [];
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        for (const token of args.config.forbiddenTokens ?? DEFAULT_FORBIDDEN_TOKENS) {
            const matchIndex = line.indexOf(token);
            if (matchIndex === -1) continue;
            if (isTokenAllowed(normalizedPath, token, allowlist)) {
                continue;
            }
            if (isCommentOrString(line, matchIndex)) {
                continue;
            }
            violations.push({
                filePath: normalizedPath,
                line: lineIndex + 1,
                column: matchIndex + 1,
                token,
                snippet: line.trim()
            });
        }
    }
    return { violations, blocked: violations.length > 0 };
}

function isTokenAllowed(filePath: string, token: string, allowlist: Array<{ file: string; tokens: string[] }>): boolean {
    return allowlist.some(entry => matchGlob(filePath, entry.file) && entry.tokens.includes(token));
}

function isCommentOrString(line: string, tokenIndex: number): boolean {
    const before = line.slice(0, tokenIndex);
    const lineCommentIndex = before.indexOf("//");
    if (lineCommentIndex !== -1) {
        return true;
    }
    if (before.includes("/*")) {
        return true;
    }
    const quoteCount = (before.match(/"/g) ?? []).length + (before.match(/'/g) ?? []).length;
    return quoteCount % 2 === 1;
}

type PublicSurfaceResult = {
    hasChanges: boolean;
    changes: Array<{ type: "added" | "removed" | "modified"; name: string; exportType: string }>;
    impacts: Array<{ name: string; impactCount: number; impactedFiles: string[] }>;
    totalImpact: number;
    requiresBatchRefactoring: boolean;
    riskLevel: "low" | "medium" | "high";
    breakingChanges?: AstChange[];
    parity?: ParityResult;
};

async function evaluatePublicSurfaceChanges(args: {
    filePath: string;
    oldExports: ExportInfo[];
    newExports: ExportInfo[];
    oldContent: string;
    newContent: string;
    languageId: string;
    mode: LanguageParityMode;
    extractor: UnifiedExtractor;
    astManager: AstManager;
    impactThreshold: number;
    runTool?: (tool: string, args: any) => Promise<any>;
}): Promise<PublicSurfaceResult> {
    const oldSet = new Set(args.oldExports.map((exp) => `${exp.exportType}:${exp.name}`));
    const newSet = new Set(args.newExports.map((exp) => `${exp.exportType}:${exp.name}`));
    const changes: Array<{ type: "added" | "removed" | "modified"; name: string; exportType: string }> = [];
    for (const oldId of oldSet) {
        if (!newSet.has(oldId)) {
            const [exportType, name] = oldId.split(":");
            changes.push({ type: "removed", name, exportType });
        }
    }
    for (const newId of newSet) {
        if (!oldSet.has(newId)) {
            const [exportType, name] = newId.split(":");
            changes.push({ type: "added", name, exportType });
        }
    }

    const breakingResult = await detectBreakingPublicSurface({
        filePath: args.filePath,
        oldContent: args.oldContent,
        newContent: args.newContent,
        languageId: args.languageId,
        mode: args.mode,
        extractor: args.extractor,
        astManager: args.astManager,
        oldExports: args.oldExports,
        newExports: args.newExports
    });
    const breakingChanges = breakingResult.changes;
    if (breakingChanges.length > 0) {
        const knownExports = new Map(args.oldExports.map(exp => [exp.name, exp.exportType]));
        for (const change of breakingChanges) {
            const exists = changes.some(entry => entry.name === change.symbolName);
            if (!exists) {
                changes.push({
                    type: "modified",
                    name: change.symbolName,
                    exportType: knownExports.get(change.symbolName) ?? "named"
                });
            }
        }
    }

    if (changes.length === 0) {
        return {
            hasChanges: false,
            changes: [],
            impacts: [],
            totalImpact: 0,
            requiresBatchRefactoring: false,
            riskLevel: "low",
            parity: breakingResult.parity
        };
    }

    const impacts: Array<{ name: string; impactCount: number; impactedFiles: string[] }> = [];
    for (const change of changes.filter(item => item.type === "removed")) {
        const refs = args.runTool
            ? await args.runTool("reference_find", {
                symbolName: change.name,
                definitionPath: args.filePath
            }).catch(() => null)
            : null;
        const files = Array.isArray(refs?.references)
            ? refs.references.map((ref: any) => ref.filePath).filter(Boolean)
            : [];
        impacts.push({
            name: change.name,
            impactCount: files.length,
            impactedFiles: files
        });
    }

    const totalImpact = impacts.reduce((sum, item) => sum + item.impactCount, 0);
    const requiresBatchRefactoring = totalImpact >= args.impactThreshold || breakingChanges.length > 0;
    const hasRemoval = changes.some(change => change.type === "removed");
    const hasBreaking = breakingChanges.length > 0;
    const riskLevel = hasBreaking || (hasRemoval && totalImpact >= args.impactThreshold)
        ? "high"
        : hasRemoval
            ? "medium"
            : "low";

    return {
        hasChanges: true,
        changes,
        impacts,
        totalImpact,
        requiresBatchRefactoring,
        riskLevel,
        breakingChanges: breakingChanges.length > 0 ? breakingChanges : undefined,
        parity: breakingResult.parity
    };
}

async function detectBreakingPublicSurface(args: {
    filePath: string;
    oldContent: string;
    newContent: string;
    languageId: string;
    mode: LanguageParityMode;
    extractor: UnifiedExtractor;
    astManager: AstManager;
    oldExports: ExportInfo[];
    newExports: ExportInfo[];
}): Promise<{ changes: AstChange[]; parity: ParityResult }> {
    const exportNames = collectExportedNames(args.oldExports, args.newExports);
    if (exportNames.size === 0) {
        return { changes: [], parity: { degraded: false, blocked: false } };
    }

    const parity = await resolveParityAvailability(args.astManager, args.filePath, args.languageId, "symbols");
    if (!parity.available) {
        if (args.mode === "strict") {
            return { changes: [], parity: { degraded: false, blocked: true } };
        }
        const fallbackChanges = await detectBreakingPublicSurfaceWithRegex(args.filePath, args.oldContent, args.newContent);
        return {
            changes: fallbackChanges,
            parity: {
                degraded: true,
                blocked: false,
                confidence: args.mode === "balanced" ? "low" : "medium"
            }
        };
    }

    const [oldSymbols, newSymbols] = await Promise.all([
        args.extractor.extractSymbols(args.filePath, args.oldContent, args.languageId, {
            docProvider: () => args.astManager.parseFile(args.filePath, args.oldContent)
        }),
        args.extractor.extractSymbols(args.filePath, args.newContent, args.languageId, {
            docProvider: () => args.astManager.parseFile(args.filePath, args.newContent)
        })
    ]);

    const breakingChanges = compareExportedSignatures({
        exportNames,
        oldSymbols: filterDefinitionSymbols(oldSymbols),
        newSymbols: filterDefinitionSymbols(newSymbols)
    });

    return {
        changes: breakingChanges,
        parity: { degraded: false, blocked: false }
    };
}

async function detectBreakingPublicSurfaceWithRegex(
    filePath: string,
    oldContent: string,
    newContent: string
): Promise<AstChange[]> {
    const ext = path.extname(filePath).toLowerCase();
    if (![".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
        return [];
    }
    const diffEngine = new AstDiffEngine();
    const result = await diffEngine.diff(filePath, oldContent, newContent);
    return result.changes.filter(change => change.isBreaking);
}

function collectExportedNames(oldExports: ExportInfo[], newExports: ExportInfo[]): Set<string> {
    const names = new Set<string>();
    for (const exp of [...oldExports, ...newExports]) {
        if (exp.exportType !== "named" || exp.isReExport) continue;
        names.add(exp.name);
    }
    return names;
}

function filterDefinitionSymbols(symbols: SymbolInfo[]): DefinitionSymbol[] {
    const allowedTypes = new Set([
        "class",
        "function",
        "method",
        "interface",
        "variable",
        "export_specifier",
        "type_alias"
    ]);
    return symbols.filter((symbol): symbol is DefinitionSymbol => allowedTypes.has(symbol.type));
}

function compareExportedSignatures(args: {
    exportNames: Set<string>;
    oldSymbols: DefinitionSymbol[];
    newSymbols: DefinitionSymbol[];
}): AstChange[] {
    const changes: AstChange[] = [];
    const oldMap = groupSymbolsByName(args.oldSymbols);
    const newMap = groupSymbolsByName(args.newSymbols);

    for (const name of args.exportNames) {
        const oldEntries = oldMap.get(name) ?? [];
        const newEntries = newMap.get(name) ?? [];
        if (oldEntries.length === 0 || newEntries.length === 0) {
            continue;
        }

        const oldTypes = new Set(oldEntries.map(entry => entry.type));
        const newTypes = new Set(newEntries.map(entry => entry.type));
        if (!setEquals(oldTypes, newTypes)) {
            changes.push({
                type: "type-change",
                symbolName: name,
                symbolType: oldEntries[0]?.type ?? newEntries[0]?.type ?? "function",
                isBreaking: true
            });
        }

        const oldSignatures = normalizeSignatureSet(oldEntries);
        const newSignatures = normalizeSignatureSet(newEntries);
        if (!arrayEquals(oldSignatures, newSignatures)) {
            changes.push({
                type: "signature-change",
                symbolName: name,
                symbolType: oldEntries[0]?.type ?? newEntries[0]?.type ?? "function",
                isBreaking: true,
                oldSignature: oldSignatures.join(" | "),
                newSignature: newSignatures.join(" | ")
            });
        }
    }

    return changes;
}

function groupSymbolsByName(symbols: DefinitionSymbol[]): Map<string, DefinitionSymbol[]> {
    const map = new Map<string, DefinitionSymbol[]>();
    for (const symbol of symbols) {
        const current = map.get(symbol.name) ?? [];
        current.push(symbol);
        map.set(symbol.name, current);
    }
    return map;
}

function normalizeSignatureSet(symbols: DefinitionSymbol[]): string[] {
    const signatures = symbols
        .map(buildSymbolSignature)
        .filter((sig): sig is string => Boolean(sig))
        .map(normalizeSignature);
    return Array.from(new Set(signatures)).sort();
}

function buildSymbolSignature(symbol: DefinitionSymbol): string | undefined {
    if (symbol.signature) {
        return symbol.signature;
    }
    const params = symbol.parameters?.length ? symbol.parameters.join(", ") : "";
    const returnType = symbol.returnType ? `:${symbol.returnType}` : "";
    if (!params && !returnType) {
        return undefined;
    }
    return `${symbol.name}(${params})${returnType}`;
}

function normalizeSignature(signature: string): string {
    return signature.replace(/\s+/g, " ").trim();
}

function setEquals<T>(left: Set<T>, right: Set<T>): boolean {
    if (left.size !== right.size) return false;
    for (const value of left) {
        if (!right.has(value)) return false;
    }
    return true;
}

function arrayEquals<T>(left: T[], right: T[]): boolean {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) return false;
    }
    return true;
}

function shouldBlockForPolicy(policy: GuardrailBlockPolicy, severity: "high" | "medium" | "low"): boolean {
    if (policy === "none" || policy === "warn_only") return false;
    if (policy === "all") return true;
    return policy === "high_only" && severity === "high";
}

export function applyEditsToContent(content: string, edits: Edit[]): { newContent: string } {
    if (!edits || edits.length === 0) {
        return { newContent: content };
    }
    const planner = new EditPlanner();
    const matches = planner.applyEditsInternal(content, edits);
    const targetEol = TextNormalizer.detectEOL(content) ?? "\n";

    const ordered = [...matches].sort((a, b) => a.start - b.start);
    let newContent = "";
    let cursor = 0;
    for (const match of ordered) {
        newContent += content.substring(cursor, match.start);
        const normalizedReplacement = TextNormalizer.normalizeForFileSystem(match.replacement, {
            unescapeNewlines: true,
            trimTrailing: true,
            targetEOL: targetEol
        });
        newContent += normalizedReplacement;
        cursor = match.end;
    }
    newContent += content.substring(cursor);
    return { newContent };
}

export function resolveGuardrailTargetPath(targetPath: string): string {
    if (path.isAbsolute(targetPath)) {
        return targetPath;
    }
    return path.join(process.cwd(), targetPath);
}

export function normalizeGuardrailContent(content: string | null | undefined): string {
    return typeof content === "string" ? content : "";
}

export function buildDefaultGuardrailsConfig(): IntegrityGuardrailsConfig {
    return {
        enabled: true,
        layerRules: undefined,
        coreProtection: {
            pageRankThreshold: 0.3,
            incomingCountThreshold: 10,
            blockPolicy: "warn_only"
        },
        protocolProtection: {
            files: DEFAULT_PROTOCOL_FILES,
            forbiddenTokens: DEFAULT_FORBIDDEN_TOKENS
        },
        publicSurfaceMonitor: {
            enabled: true,
            impactThreshold: 10,
            requireBatchRefactoring: true
        },
        languageParity: {
            mode: "balanced",
            fallbackConfidence: "low"
        },
        performance: {
            pageRankCacheTTL: 300000
        }
    };
}
