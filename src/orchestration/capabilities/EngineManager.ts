import type { CapabilityId } from "./CapabilityIds.js";
import { ALL_CAPABILITIES } from "./CapabilityIds.js";
import { DefaultEngineRegistry } from "./DefaultEngineRegistry.js";
import { computeTokenizerDiagnostics, type TokenizerDiagnostics } from "./TokenizerDiagnostics.js";
import { metrics } from "../../utils/MetricsCollector.js";

export type CapabilityTier = "native" | "wasm" | "js";

export type ProviderMeta = {
    id: string;
    tier: CapabilityTier;
    priority: number;
};

export interface CapabilityProvider<T> {
    meta: ProviderMeta;
    isAvailable(): boolean;
    get(): T;
    diagnose?: () => { available: boolean; reason?: string; details?: Record<string, unknown> };
}

export type CapabilityDiagnostics = {
    rustCoreAvailable: boolean;
    rustCoreError?: string;
    capabilities: Record<string, { provider?: ProviderMeta; fallback?: ProviderMeta }>;
};

export type CapabilityProviderCandidate = {
    meta: ProviderMeta;
    available: boolean;
    reason?: string;
    details?: Record<string, unknown>;
};

export type CapabilityStatus = {
    capabilityId: string;
    selected?: ProviderMeta;
    fallback?: ProviderMeta;
    candidates: CapabilityProviderCandidate[];
    policy?: {
        preferredTier?: CapabilityTier;
    };
};

export type CapabilityDiagnosticsSnapshot = {
    rustCore: { available: boolean; error?: string };
    coverage: { total: number; included: number; missing: string[] };
    tokenizer?: TokenizerDiagnostics;
    capabilities: Record<string, CapabilityStatus>;
};

export class EngineManager {
    private static initialized = false;
    private static providers = new Map<CapabilityId, CapabilityProvider<unknown>[]>();
    private static diagnostics: CapabilityDiagnostics = {
        rustCoreAvailable: false,
        capabilities: {}
    };
    private static selections = new Map<CapabilityId, { provider?: ProviderMeta; fallback?: ProviderMeta; preferredTier?: CapabilityTier }>();

    static registerProvider<T>(capability: CapabilityId, provider: CapabilityProvider<T>): void {
        const existing = this.providers.get(capability) ?? [];
        existing.push(provider as CapabilityProvider<unknown>);
        existing.sort((a, b) => b.meta.priority - a.meta.priority);
        this.providers.set(capability, existing);
    }

    static getProvider<T>(
        capability: CapabilityId,
        hint?: { preferredTier?: CapabilityTier }
    ): T | null {
        this.ensureInitialized();
        const providers = this.providers.get(capability) ?? [];
        let selectedIndex = -1;
        if (hint?.preferredTier) {
            for (let i = 0; i < providers.length; i += 1) {
                const provider = providers[i];
                if (provider.meta.tier === hint.preferredTier && provider.isAvailable()) {
                    selectedIndex = i;
                    break;
                }
            }
        }
        if (selectedIndex === -1) {
            for (let i = 0; i < providers.length; i += 1) {
                if (providers[i].isAvailable()) {
                    selectedIndex = i;
                    break;
                }
            }
        }
        if (selectedIndex !== -1) {
            const selected = providers[selectedIndex];
            let fallback: ProviderMeta | undefined;
            for (let i = selectedIndex + 1; i < providers.length; i += 1) {
                if (providers[i].isAvailable()) {
                    fallback = providers[i].meta;
                    break;
                }
            }
            this.recordProviderSelection(capability, selected.meta, selectedIndex);
            this.diagnostics.capabilities[capability] = { provider: selected.meta, fallback };
            this.selections.set(capability, { provider: selected.meta, fallback, preferredTier: hint?.preferredTier });
            return selected.get() as T;
        }
        this.recordProviderSelection(capability, undefined, selectedIndex);
        this.diagnostics.capabilities[capability] = { provider: undefined, fallback: undefined };
        this.selections.set(capability, { provider: undefined, fallback: undefined, preferredTier: hint?.preferredTier });
        return null;
    }

    static getDiagnostics(): CapabilityDiagnostics {
        this.ensureInitialized();
        return { ...this.diagnostics, capabilities: { ...this.diagnostics.capabilities } };
    }

    static getDiagnosticsSnapshot(options?: { detail?: "summary" | "full"; rootPath?: string }): CapabilityDiagnosticsSnapshot {
        this.ensureInitialized();
        const detail = options?.detail ?? "summary";
        const includeCandidates = detail === "full";
        const capabilities: Record<string, CapabilityStatus> = {};
        const missing: string[] = [];

        for (const capability of ALL_CAPABILITIES) {
            const providers = this.providers.get(capability) ?? [];
            if (providers.length === 0) {
                missing.push(capability);
            }
            const selection = this.selections.get(capability);
            const candidates = includeCandidates
                ? providers.map((provider) => {
                    const diagnosis = provider.diagnose?.();
                    const available = diagnosis?.available ?? provider.isAvailable();
                    return {
                        meta: provider.meta,
                        available,
                        reason: diagnosis?.reason,
                        details: diagnosis?.details
                    };
                })
                : [];
            capabilities[capability] = {
                capabilityId: capability,
                selected: selection?.provider ?? this.diagnostics.capabilities[capability]?.provider,
                fallback: selection?.fallback ?? this.diagnostics.capabilities[capability]?.fallback,
                candidates,
                policy: selection?.preferredTier ? { preferredTier: selection.preferredTier } : undefined
            };
        }

        return {
            rustCore: { available: this.diagnostics.rustCoreAvailable, error: this.diagnostics.rustCoreError },
            coverage: { total: ALL_CAPABILITIES.length, included: ALL_CAPABILITIES.length - missing.length, missing },
            tokenizer: computeTokenizerDiagnostics(options?.rootPath ?? process.cwd()),
            capabilities
        };
    }

    static setRustCoreStatus(available: boolean, error?: string): void {
        this.diagnostics.rustCoreAvailable = available;
        this.diagnostics.rustCoreError = error;
    }

    static resetForTesting(): void {
        this.initialized = false;
        this.providers.clear();
        this.diagnostics = { rustCoreAvailable: false, capabilities: {} };
        this.selections.clear();
        DefaultEngineRegistry.resetForTesting();
    }

    private static ensureInitialized(): void {
        if (this.initialized) return;
        this.initialized = true;
        DefaultEngineRegistry.init();
    }

    private static recordProviderSelection(
        capability: CapabilityId,
        provider: ProviderMeta | undefined,
        selectedIndex: number
    ): void {
        if (!provider) {
            metrics.inc(`capability.select.${capability}.none`);
            return;
        }
        metrics.inc(`capability.select.${capability}.${provider.tier}`);
        if (selectedIndex > 0) {
            metrics.inc(`capability.fallback.${capability}.${provider.tier}`);
        }
    }
}
