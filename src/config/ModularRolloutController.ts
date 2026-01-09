import { FeatureFlags } from './FeatureFlags.js';

const MODULAR_FLAGS = [
    FeatureFlags.MODULAR_HANDLERS_ENABLED,
    FeatureFlags.UNIFIED_EXTRACTION_ENABLED,
    FeatureFlags.PILLAR_DECOMPOSITION_ENABLED
];

const TRUE_VALUES = new Set(['true', '1', 'on']);
const FALSE_VALUES = new Set(['false', '0', 'off']);

const parseBoolean = (raw: string | undefined): boolean | undefined => {
    if (!raw) return undefined;
    const normalized = raw.trim().toLowerCase();
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;
    return undefined;
};

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

export class ModularRolloutController {
    static applyFromEnv(): void {
        const percentRaw = process.env.KAIRO_MODULAR_ROLLOUT_PERCENT;
        const explicitValues = new Map<string, boolean>();

        for (const flag of MODULAR_FLAGS) {
            const envKey = this.resolveEnvKey(flag);
            const value = parseBoolean(envKey ? process.env[envKey] : undefined);
            if (value !== undefined) {
                explicitValues.set(flag, value);
            }
        }

        let percent: number | undefined;
        if (percentRaw !== undefined) {
            const parsed = Number(percentRaw);
            if (Number.isFinite(parsed)) {
                percent = clampPercent(parsed);
            } else {
                console.warn(`[ModularRolloutController] Invalid KAIRO_MODULAR_ROLLOUT_PERCENT="${percentRaw}"`);
            }
        }

        for (const flag of MODULAR_FLAGS) {
            const explicit = explicitValues.get(flag);
            if (explicit !== undefined) {
                FeatureFlags.set(flag, explicit, explicit ? 'on' : 'off');
                continue;
            }
            if (percent !== undefined) {
                if (percent <= 0) {
                    FeatureFlags.set(flag, false, 'off');
                } else if (percent >= 100) {
                    FeatureFlags.set(flag, true, 'on');
                } else {
                    FeatureFlags.set(flag, true, 'beta');
                    FeatureFlags.setBetaPercentForFlag(flag, percent);
                }
                continue;
            }
            FeatureFlags.set(flag, true, 'on');
        }

        if (explicitValues.size > 0) {
            console.log(`[ModularRolloutController] Applied explicit modular flags (${explicitValues.size})`);
        } else if (percent !== undefined) {
            console.log(`[ModularRolloutController] Applied modular rollout percent=${percent}`);
        } else {
            console.log('[ModularRolloutController] Defaulted modular flags to enabled');
        }
    }

    private static resolveEnvKey(flag: string): string | undefined {
        switch (flag) {
            case FeatureFlags.MODULAR_HANDLERS_ENABLED:
                return 'KAIRO_MODULAR_HANDLERS_ENABLED';
            case FeatureFlags.UNIFIED_EXTRACTION_ENABLED:
                return 'KAIRO_UNIFIED_EXTRACTION_ENABLED';
            case FeatureFlags.PILLAR_DECOMPOSITION_ENABLED:
                return 'KAIRO_PILLAR_DECOMPOSITION_ENABLED';
            default:
                return undefined;
        }
    }
}
