import { ConfigurationManager } from "../config/ConfigurationManager.js";
import { normalizePath } from "./PathHelpers.js";
import { metrics } from "./MetricsCollector.js";

export type GuardrailsOverrideEnvelope = {
    approval: {
        approvedBy: string;
        reason: string;
        ticket?: string;
        issuedAt: string;
        expiresAt: string;
        method?: "manual" | "break_glass";
    };
    scope: {
        pillars: Array<"change" | "write" | "edit_apply">;
        fileGlobs?: string[];
        repoIds?: string[];
        maxFiles?: number;
    };
    allow: {
        integrityGuardrails?: { bypass?: boolean };
        architecturalSafety?: { bypass?: boolean };
        reviewPolicy?: { bypassPreApplyBlock?: boolean };
        parityGate?: { bypassL3Blocks?: boolean };
        staleGuard?: { bypass?: boolean };
        editPolicy?: {
            allowPartialApply?: boolean;
            allowDelete?: "confirm_only";
        };
    };
};

export type OverrideTrace = {
    auditEventId?: string;
    decision: "accepted" | "rejected" | "expired" | "out_of_scope";
    overridesUsed: string[];
    expiresAt?: string;
};

export type OverrideDecision = {
    decision: OverrideTrace["decision"];
    errorCode?: "OVERRIDE_REQUIRED" | "OVERRIDE_NOT_ALLOWED" | "OVERRIDE_EXPIRED" | "OVERRIDE_OUT_OF_SCOPE";
    blockedReason?: "override_required" | "override_not_allowed" | "override_expired" | "override_out_of_scope";
    message: string;
    overridesUsed: string[];
    effectiveAllow?: Record<string, unknown>;
    requestedAllow?: Record<string, unknown>;
    approval?: GuardrailsOverrideEnvelope["approval"];
    scope?: GuardrailsOverrideEnvelope["scope"];
};

type OverrideContext = {
    override?: GuardrailsOverrideEnvelope;
    requiredOverrides: string[];
    targetFiles: string[];
    pillar: "change" | "write" | "edit_apply";
    repoId?: string;
};

export function detectOverrideRequirementsFromConstraints(constraints: any): string[] {
    const required: string[] = [];
    if (constraints?.integrityGuardrails) {
        const baseline = ConfigurationManager.getIntegrityGuardrailsConfig();
        const configured = constraints.integrityGuardrails ?? {};
        const candidate = {
            ...baseline,
            ...configured,
            coreProtection: { ...baseline.coreProtection, ...(configured.coreProtection ?? {}) },
            protocolProtection: { ...baseline.protocolProtection, ...(configured.protocolProtection ?? {}) },
            publicSurfaceMonitor: { ...baseline.publicSurfaceMonitor, ...(configured.publicSurfaceMonitor ?? {}) },
            languageParity: { ...baseline.languageParity, ...(configured.languageParity ?? {}) }
        };
        if (isIntegrityWeakening(baseline, candidate)) {
            required.push("integrityGuardrails.bypass");
        }
    }
    if (constraints?.architecturalSafety) {
        const baseline = ConfigurationManager.getArchitecturalSafetyConfig();
        const configured = constraints.architecturalSafety ?? {};
        const candidate = {
            enabled: typeof configured.enabled === "boolean" ? configured.enabled : baseline.enabled,
            coreThreshold: Number.isFinite(configured.coreThreshold) ? configured.coreThreshold : baseline.coreThreshold,
            blockPolicy: (configured.blockPolicy ?? baseline.blockPolicy) as any,
            maxDepth: Number.isFinite(configured.maxDepth) ? configured.maxDepth : baseline.maxDepth
        };
        if (isArchitecturalWeakening(baseline, candidate)) {
            required.push("architecturalSafety.bypass");
        }
    }
    if (Array.isArray(constraints?.reviewOptions?.blockOn) && constraints.reviewOptions.blockOn.length === 0) {
        required.push("reviewPolicy.bypassPreApplyBlock");
    }
    return required;
}

function isIntegrityWeakening(baseline: any, candidate: any): boolean {
    if (baseline?.enabled !== false && candidate?.enabled === false) return true;
    if (compareBlockPolicy(candidate?.coreProtection?.blockPolicy, baseline?.coreProtection?.blockPolicy) < 0) return true;
    if (Number.isFinite(candidate?.coreProtection?.pageRankThreshold) && Number.isFinite(baseline?.coreProtection?.pageRankThreshold)) {
        if (candidate.coreProtection.pageRankThreshold > baseline.coreProtection.pageRankThreshold) return true;
    }
    if (Number.isFinite(candidate?.coreProtection?.incomingCountThreshold) && Number.isFinite(baseline?.coreProtection?.incomingCountThreshold)) {
        if (candidate.coreProtection.incomingCountThreshold > baseline.coreProtection.incomingCountThreshold) return true;
    }
    if (Array.isArray(candidate?.protocolProtection?.allowlist) && candidate.protocolProtection.allowlist.length > 0) return true;
    if (baseline?.publicSurfaceMonitor?.enabled !== false && candidate?.publicSurfaceMonitor?.enabled === false) return true;
    if (baseline?.publicSurfaceMonitor?.requireBatchRefactoring === true && candidate?.publicSurfaceMonitor?.requireBatchRefactoring === false) return true;
    if (Number.isFinite(candidate?.publicSurfaceMonitor?.impactThreshold) && Number.isFinite(baseline?.publicSurfaceMonitor?.impactThreshold)) {
        if (candidate.publicSurfaceMonitor.impactThreshold > baseline.publicSurfaceMonitor.impactThreshold) return true;
    }
    if (compareParityMode(candidate?.languageParity?.mode, baseline?.languageParity?.mode) < 0) return true;
    return false;
}

function isArchitecturalWeakening(baseline: any, candidate: any): boolean {
    if (baseline?.enabled !== false && candidate?.enabled === false) return true;
    if (compareBlockPolicy(candidate?.blockPolicy, baseline?.blockPolicy) < 0) return true;
    if (Number.isFinite(candidate?.coreThreshold) && Number.isFinite(baseline?.coreThreshold)) {
        if (candidate.coreThreshold > baseline.coreThreshold) return true;
    }
    if (Number.isFinite(candidate?.maxDepth) && Number.isFinite(baseline?.maxDepth)) {
        if (candidate.maxDepth > baseline.maxDepth) return true;
    }
    return false;
}

function compareBlockPolicy(a: any, b: any): number {
    const rank = (value: any): number => {
        const normalized = String(value ?? "warn_only").toLowerCase();
        switch (normalized) {
            case "all":
                return 3;
            case "high_only":
                return 2;
            case "warn_only":
                return 1;
            case "none":
                return 0;
            default:
                return 1;
        }
    };
    return rank(a) - rank(b);
}

function compareParityMode(a: any, b: any): number {
    const rank = (value: any): number => {
        const normalized = String(value ?? "balanced").toLowerCase();
        switch (normalized) {
            case "strict":
                return 2;
            case "balanced":
                return 1;
            case "permissive":
                return 0;
            default:
                return 1;
        }
    };
    return rank(a) - rank(b);
}

export function detectOverrideRequirementsForEditApply(args: {
    options?: { applyMode?: string; deleteMode?: string };
    edits?: Array<{ operation?: string }>;
}): string[] {
    const required: string[] = [];
    const applyMode = args.options?.applyMode;
    const deleteMode = args.options?.deleteMode;
    if (applyMode === "partial") {
        required.push("editPolicy.allowPartialApply");
    }
    const hasDelete = Array.isArray(args.edits) && args.edits.some(edit => (edit?.operation ?? "replace") === "delete");
    if (deleteMode === "confirm" || hasDelete) {
        required.push("editPolicy.allowDelete");
    }
    return required;
}

export function evaluateOverride(context: OverrideContext): OverrideDecision | null {
    const policy = ConfigurationManager.getOverridePolicy();
    const override = context.override;
    const requiredOverrides = context.requiredOverrides;

    if (!override) {
        if (requiredOverrides.length === 0) {
            return null;
        }
        return recordOverrideDecision({
            decision: "rejected",
            errorCode: "OVERRIDE_REQUIRED",
            blockedReason: "override_required",
            message: "Override approval is required for the requested operation.",
            overridesUsed: requiredOverrides
        });
    }

    if (!policy.enabled) {
        return recordOverrideDecision({
            decision: "rejected",
            errorCode: "OVERRIDE_NOT_ALLOWED",
            blockedReason: "override_not_allowed",
            message: "Overrides are disabled by policy.",
            overridesUsed: []
        });
    }

    const approval = override.approval;
    if (!approval?.approvedBy || !approval?.reason || !approval?.issuedAt || !approval?.expiresAt) {
        return recordOverrideDecision({
            decision: "rejected",
            errorCode: "OVERRIDE_NOT_ALLOWED",
            blockedReason: "override_not_allowed",
            message: "Override approval metadata is incomplete.",
            overridesUsed: []
        });
    }

    const issuedAt = Date.parse(approval.issuedAt);
    const expiresAt = Date.parse(approval.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        return recordOverrideDecision({
            decision: "expired",
            errorCode: "OVERRIDE_EXPIRED",
            blockedReason: "override_expired",
            message: "Override approval has expired.",
            overridesUsed: []
        });
    }

    const ttlMs = policy.maxTtlMinutes * 60 * 1000;
    if (Number.isFinite(issuedAt) && expiresAt - issuedAt > ttlMs) {
        return recordOverrideDecision({
            decision: "rejected",
            errorCode: "OVERRIDE_NOT_ALLOWED",
            blockedReason: "override_not_allowed",
            message: "Override TTL exceeds policy limits.",
            overridesUsed: []
        });
    }

    const scope = override.scope;
    if (!scope || !Array.isArray(scope.pillars) || !scope.pillars.includes(context.pillar)) {
        return recordOverrideDecision({
            decision: "out_of_scope",
            errorCode: "OVERRIDE_OUT_OF_SCOPE",
            blockedReason: "override_out_of_scope",
            message: "Override scope does not include this pillar.",
            overridesUsed: []
        });
    }

    if (Array.isArray(scope.repoIds) && scope.repoIds.length > 0) {
        if (!context.repoId || !scope.repoIds.includes(context.repoId)) {
            return recordOverrideDecision({
                decision: "out_of_scope",
                errorCode: "OVERRIDE_OUT_OF_SCOPE",
                blockedReason: "override_out_of_scope",
                message: "Override scope does not include this repository.",
                overridesUsed: []
            });
        }
    }

    if (Array.isArray(scope.fileGlobs) && scope.fileGlobs.length > 0) {
        if (context.targetFiles.length === 0) {
            return recordOverrideDecision({
                decision: "out_of_scope",
                errorCode: "OVERRIDE_OUT_OF_SCOPE",
                blockedReason: "override_out_of_scope",
                message: "Override scope requires file targets.",
                overridesUsed: []
            });
        }
        const matched = context.targetFiles.every((filePath) =>
            scope.fileGlobs!.some((pattern) => matchGlob(filePath, pattern))
        );
        if (!matched) {
            return recordOverrideDecision({
                decision: "out_of_scope",
                errorCode: "OVERRIDE_OUT_OF_SCOPE",
                blockedReason: "override_out_of_scope",
                message: "Override scope does not match target files.",
                overridesUsed: []
            });
        }
    }

    const scopeMaxFiles = Number.isFinite(scope.maxFiles) ? (scope.maxFiles as number) : Number.POSITIVE_INFINITY;
    const allowedMaxFiles = Math.min(scopeMaxFiles, policy.maxFiles);
    if (context.targetFiles.length > allowedMaxFiles) {
        return recordOverrideDecision({
            decision: "out_of_scope",
            errorCode: "OVERRIDE_OUT_OF_SCOPE",
            blockedReason: "override_out_of_scope",
            message: "Override scope exceeds the maximum allowed file count.",
            overridesUsed: []
        });
    }

    const requestedAllow = flattenOverrideAllow(override.allow);
    for (const key of Object.keys(requestedAllow)) {
        const policyValue = policy.allowed[key];
        if (!policyValue) {
            return recordOverrideDecision({
                decision: "rejected",
                errorCode: "OVERRIDE_NOT_ALLOWED",
                blockedReason: "override_not_allowed",
                message: `Override '${key}' is not allowed by policy.`,
                overridesUsed: []
            });
        }
        if (policyValue === "confirm_only" && requestedAllow[key] !== "confirm_only") {
            return recordOverrideDecision({
                decision: "rejected",
                errorCode: "OVERRIDE_NOT_ALLOWED",
                blockedReason: "override_not_allowed",
                message: `Override '${key}' must use confirm_only policy.`,
                overridesUsed: []
            });
        }
    }

    for (const required of requiredOverrides) {
        if (!(required in requestedAllow)) {
            return recordOverrideDecision({
                decision: "rejected",
                errorCode: "OVERRIDE_REQUIRED",
                blockedReason: "override_required",
                message: `Override '${required}' is required for this operation.`,
                overridesUsed: []
            });
        }
        if (!isOverrideAllowed(requestedAllow[required])) {
            return recordOverrideDecision({
                decision: "rejected",
                errorCode: "OVERRIDE_NOT_ALLOWED",
                blockedReason: "override_not_allowed",
                message: `Override '${required}' is not enabled in the request.`,
                overridesUsed: []
            });
        }
    }

    const overridesUsed = Object.keys(requestedAllow).filter((key) => isOverrideAllowed(requestedAllow[key]));
    return recordOverrideDecision({
        decision: "accepted",
        message: "Override approved.",
        overridesUsed,
        effectiveAllow: requestedAllow,
        requestedAllow,
        approval,
        scope
    });
}

function recordOverrideDecision(decision: OverrideDecision): OverrideDecision {
    if (decision.decision === "accepted") {
        metrics.inc("override.accepted_total");
    } else {
        metrics.inc("override.rejected_total");
    }
    return decision;
}

function flattenOverrideAllow(allow: GuardrailsOverrideEnvelope["allow"]): Record<string, unknown> {
    const flat: Record<string, unknown> = {};
    if (allow.integrityGuardrails?.bypass !== undefined) {
        flat["integrityGuardrails.bypass"] = allow.integrityGuardrails.bypass;
    }
    if (allow.architecturalSafety?.bypass !== undefined) {
        flat["architecturalSafety.bypass"] = allow.architecturalSafety.bypass;
    }
    if (allow.reviewPolicy?.bypassPreApplyBlock !== undefined) {
        flat["reviewPolicy.bypassPreApplyBlock"] = allow.reviewPolicy.bypassPreApplyBlock;
    }
    if (allow.parityGate?.bypassL3Blocks !== undefined) {
        flat["parityGate.bypassL3Blocks"] = allow.parityGate.bypassL3Blocks;
    }
    if (allow.staleGuard?.bypass !== undefined) {
        flat["staleGuard.bypass"] = allow.staleGuard.bypass;
    }
    if (allow.editPolicy?.allowPartialApply !== undefined) {
        flat["editPolicy.allowPartialApply"] = allow.editPolicy.allowPartialApply;
    }
    if (allow.editPolicy?.allowDelete !== undefined) {
        flat["editPolicy.allowDelete"] = allow.editPolicy.allowDelete;
    }
    return flat;
}

function isOverrideAllowed(value: unknown): boolean {
    if (value === true) return true;
    if (value === "confirm_only") return true;
    return false;
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
