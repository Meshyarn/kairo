import { AstManager } from "../../ast/AstManager.js";
import { ModuleResolver } from "../../ast/ModuleResolver.js";
import { UnifiedExtractor } from "../../ast/extraction/UnifiedExtractor.js";
import { getSupportForFilePath, SupportLevel } from "../../config/LanguageSupportLevels.js";
import { metrics } from "../../utils/MetricsCollector.js";
import { PathManager } from "../../utils/PathManager.js";
import {
    DEFAULT_DIRTY_FILE_THRESHOLD,
    resolveIntegrityGuardrailsConfig
} from "./IntegrityGuardrailsConfig.js";
import { evaluateCoreProtection } from "./IntegrityGuardrailsCore.js";
import { evaluateCycleAndLayers } from "./IntegrityGuardrailsCycles.js";
import { evaluateProtocolViolations } from "./IntegrityGuardrailsProtocol.js";
import {
    extractExportsWithParity,
    extractImportsWithParity,
    resolveParityAvailability
} from "./IntegrityGuardrailsParity.js";
import { evaluatePublicSurfaceChanges } from "./IntegrityGuardrailsPublicSurface.js";
import type {
    GuardrailBlockPolicy,
    GuardrailContext,
    GuardrailViolation,
    GuardrailWarning,
    IntegrityGuardrailsResult,
    PublicSurfaceResult,
    SafetyChecklistItem
} from "./IntegrityGuardrailsTypes.js";

export type {
    GuardrailStatus,
    LanguageParityMode,
    GuardrailBlockPolicy,
    GuardrailWarning,
    GuardrailViolation,
    SafetyChecklistItem,
    IntegrityGuardrailsResult,
    LayerRulesConfig,
    IntegrityGuardrailsConfig,
    GuardrailContext,
    ParityResult,
    ImportExtractionResult,
    ExportExtractionResult,
    PublicSurfaceResult
} from "./IntegrityGuardrailsTypes.js";
export { resolveIntegrityGuardrailsConfig, buildDefaultGuardrailsConfig } from "./IntegrityGuardrailsConfig.js";
export {
    applyEditsToContent,
    resolveGuardrailTargetPath,
    normalizeGuardrailContent
} from "./IntegrityGuardrailsContent.js";

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
        let status: "pass" | "warn" | "block" = "pass";
        let indexSnapshot;
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
        const moduleResolver = new ModuleResolver(PathManager.getRootPath());
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

const shouldBlockForPolicy = (policy: GuardrailBlockPolicy, severity: "high" | "medium" | "low"): boolean => {
    if (policy === "none" || policy === "warn_only") return false;
    if (policy === "all") return true;
    return policy === "high_only" && severity === "high";
};
