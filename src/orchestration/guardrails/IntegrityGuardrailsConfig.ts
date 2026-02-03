import { ConfigurationManager } from "../../config/ConfigurationManager.js";
import type { IntegrityGuardrailsConfig } from "./IntegrityGuardrailsTypes.js";

export const DEFAULT_PROTOCOL_FILES = ["src/utils/StdoutGuard.ts", "src/server/**"];
export const DEFAULT_FORBIDDEN_TOKENS = ["process.stdout", "process.stderr", "console.log"];
export const DEFAULT_DIRTY_FILE_THRESHOLD = 100;

export const resolveIntegrityGuardrailsConfig = (constraints?: any): IntegrityGuardrailsConfig => {
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
};

export const buildDefaultGuardrailsConfig = (): IntegrityGuardrailsConfig => {
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
};
