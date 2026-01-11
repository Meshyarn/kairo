import type { CapabilityId } from "./CapabilityIds.js";
import { DefaultEngineRegistry } from "./DefaultEngineRegistry.js";

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
}

export type CapabilityDiagnostics = {
    rustCoreAvailable: boolean;
    rustCoreError?: string;
    capabilities: Record<string, { provider?: ProviderMeta; fallback?: ProviderMeta }>;
};

export class EngineManager {
    private static initialized = false;
    private static providers = new Map<CapabilityId, CapabilityProvider<unknown>[]>();
    private static diagnostics: CapabilityDiagnostics = {
        rustCoreAvailable: false,
        capabilities: {}
    };

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
            this.diagnostics.capabilities[capability] = { provider: selected.meta, fallback };
            return selected.get() as T;
        }
        this.diagnostics.capabilities[capability] = { provider: undefined, fallback: undefined };
        return null;
    }

    static getDiagnostics(): CapabilityDiagnostics {
        this.ensureInitialized();
        return { ...this.diagnostics, capabilities: { ...this.diagnostics.capabilities } };
    }

    static setRustCoreStatus(available: boolean, error?: string): void {
        this.diagnostics.rustCoreAvailable = available;
        this.diagnostics.rustCoreError = error;
    }

    static resetForTesting(): void {
        this.initialized = false;
        this.providers.clear();
        this.diagnostics = { rustCoreAvailable: false, capabilities: {} };
        DefaultEngineRegistry.resetForTesting();
    }

    private static ensureInitialized(): void {
        if (this.initialized) return;
        this.initialized = true;
        DefaultEngineRegistry.init();
    }
}
