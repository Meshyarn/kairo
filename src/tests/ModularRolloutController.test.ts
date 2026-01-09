import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createHash } from 'crypto';
import { FeatureFlags } from '../config/FeatureFlags.js';
import { ModularRolloutController } from '../config/ModularRolloutController.js';

const ENV_KEYS = [
    'KAIRO_MODULAR_HANDLERS_ENABLED',
    'KAIRO_UNIFIED_EXTRACTION_ENABLED',
    'KAIRO_PILLAR_DECOMPOSITION_ENABLED',
    'KAIRO_MODULAR_ROLLOUT_PERCENT'
];

const setEnv = (key: string, value: string | undefined): void => {
    if (value === undefined) {
        delete process.env[key];
    } else {
        process.env[key] = value;
    }
};

const clearEnv = (): void => {
    for (const key of ENV_KEYS) {
        delete process.env[key];
    }
};

const isInBetaCohort = (userId: string, percent: number): boolean => {
    if (percent <= 0) return false;
    if (percent >= 100) return true;
    const hash = createHash('sha1').update(userId).digest('hex');
    const value = parseInt(hash.slice(0, 8), 16);
    const percentValue = value % 10000;
    return percentValue / 100 < percent;
};

describe('ModularRolloutController', () => {
    let envSnapshot: Record<string, string | undefined>;

    beforeEach(() => {
        envSnapshot = {};
        for (const key of ENV_KEYS) {
            envSnapshot[key] = process.env[key];
        }
        FeatureFlags.resetForTesting();
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            setEnv(key, envSnapshot[key]);
        }
    });

    it('defaults modular flags to enabled when no env overrides', () => {
        clearEnv();
        ModularRolloutController.applyFromEnv();

        expect(FeatureFlags.isEnabled(FeatureFlags.MODULAR_HANDLERS_ENABLED)).toBe(true);
        expect(FeatureFlags.isEnabled(FeatureFlags.UNIFIED_EXTRACTION_ENABLED)).toBe(true);
        expect(FeatureFlags.isEnabled(FeatureFlags.PILLAR_DECOMPOSITION_ENABLED)).toBe(true);
    });

    it('applies percent rollout in beta mode', () => {
        clearEnv();
        setEnv('KAIRO_MODULAR_ROLLOUT_PERCENT', '25');
        ModularRolloutController.applyFromEnv();

        expect(FeatureFlags.getMode(FeatureFlags.MODULAR_HANDLERS_ENABLED)).toBe('beta');
        expect(FeatureFlags.isEnabled(FeatureFlags.MODULAR_HANDLERS_ENABLED)).toBe(false);

        const userId = 'rollout-user';
        const expected = isInBetaCohort(userId, 25);
        const actual = FeatureFlags.withContext({ userId }, () =>
            FeatureFlags.isEnabled(FeatureFlags.MODULAR_HANDLERS_ENABLED)
        );
        expect(actual).toBe(expected);
    });

    it('prefers explicit flag overrides over percent', () => {
        clearEnv();
        setEnv('KAIRO_MODULAR_ROLLOUT_PERCENT', '50');
        setEnv('KAIRO_MODULAR_HANDLERS_ENABLED', 'false');
        ModularRolloutController.applyFromEnv();

        expect(FeatureFlags.getMode(FeatureFlags.MODULAR_HANDLERS_ENABLED)).toBe('off');
        expect(FeatureFlags.isEnabled(FeatureFlags.MODULAR_HANDLERS_ENABLED)).toBe(false);
        expect(FeatureFlags.getMode(FeatureFlags.UNIFIED_EXTRACTION_ENABLED)).toBe('beta');
        expect(FeatureFlags.getMode(FeatureFlags.PILLAR_DECOMPOSITION_ENABLED)).toBe('beta');
    });
});
