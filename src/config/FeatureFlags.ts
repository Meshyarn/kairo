import { createHash } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';

export type RolloutMode = 'off' | 'on' | 'canary' | 'beta' | 'full';

export interface FeatureFlagContext {
    userId?: string;
}

/**
 * Feature flags for gradual rollout and A/B testing.
 * Flags can be controlled via environment variables or runtime config.
 */
export class FeatureFlags {
    private static explicitFlags: Set<string> = new Set();
    private static flags: Map<string, boolean> = new Map();
    private static modes: Map<string, RolloutMode> = new Map();
    private static canaryUsers: Set<string> = new Set();
    private static betaPercent = 10;
    private static betaPercentByFlag: Map<string, number> = new Map();
    private static contextStorage = new AsyncLocalStorage<FeatureFlagContext>();
    
    /**
     * Enables the Adaptive Flow architecture (LOD + UCG).
     * Default: false (disabled)
     * Env var: KAIRO_ADAPTIVE_FLOW_ENABLED
     */
    static ADAPTIVE_FLOW_ENABLED = 'adaptive_flow_enabled';
    
    /**
     * Enables regex-backed topology extraction for LOD 1 (UnifiedExtractor).
     * Default: false (uses full AST fallback)
     * Env var: KAIRO_TOPOLOGY_SCANNER_ENABLED
     */
    static TOPOLOGY_SCANNER_ENABLED = 'topology_scanner_enabled';
    
    /**
     * Enables Unified Context Graph state management.
     * Default: false (uses legacy caches)
     * Env var: KAIRO_UCG_ENABLED
     */
    static UCG_ENABLED = 'ucg_enabled';
    
    /**
     * Enables dual-write validation (writes to both UCG and legacy caches).
     * Default: false
     * Env var: KAIRO_DUAL_WRITE_VALIDATION
     */
    static DUAL_WRITE_VALIDATION = 'dual_write_validation';

    /**
     * Enables modular handler dispatch (ADR-045).
     * Default: true (controlled by rollout controller)
     * Env var: KAIRO_MODULAR_HANDLERS_ENABLED
     */
    static MODULAR_HANDLERS_ENABLED = 'modular_handlers_enabled';

    /**
     * Enables unified extraction (regex + tree-sitter) pipeline (ADR-045).
     * Default: true (controlled by rollout controller)
     * Env var: KAIRO_UNIFIED_EXTRACTION_ENABLED
     */
    static UNIFIED_EXTRACTION_ENABLED = 'unified_extraction_enabled';

    /**
     * Enables decomposed pillar modules (ADR-045).
     * Default: true (controlled by rollout controller)
     * Env var: KAIRO_PILLAR_DECOMPOSITION_ENABLED
     */
    static PILLAR_DECOMPOSITION_ENABLED = 'pillar_decomposition_enabled';

    /**
     * Enables default dryRun for writer flow when sessionId is present.
     * Default: false
     * Env var: KAIRO_WRITERS_FLOW_DEFAULT_DRYRUN
     */
    static WRITERS_FLOW_DEFAULT_DRYRUN = 'writers_flow_default_dryrun';

    /**
     * Enables session-based reviewOptions defaults.
     * Default: false
     * Env var: KAIRO_WRITERS_FLOW_REVIEW_DEFAULTS
     */
    static WRITERS_FLOW_REVIEW_DEFAULTS = 'writers_flow_review_defaults';

    /**
     * Enables the Rust core engine.
     * Default: true
     * Env var: KAIRO_RUST_CORE_ENABLED
     */
    static RUST_CORE_ENABLED = 'rust_core_enabled';

    /**
     * Enables Rust chunking capability.
     * Default: true (when core enabled)
     * Env var: KAIRO_RUST_CHUNKING_ENABLED
     */
    static RUST_CHUNKING_ENABLED = 'rust_chunking_enabled';

    /**
     * Enables Rust diffing capability.
     * Default: true (when core enabled)
     * Env var: KAIRO_RUST_DIFF_ENABLED
     */
    static RUST_DIFF_ENABLED = 'rust_diff_enabled';

    /**
     * Enables Rust syntax validation capability.
     * Default: true (when core enabled)
     * Env var: KAIRO_RUST_SYNTAX_ENABLED
     */
    static RUST_SYNTAX_ENABLED = 'rust_syntax_enabled';

    /**
     * Enables Rust vector math capability.
     * Default: true (when core enabled)
     * Env var: KAIRO_RUST_VECTOR_ENABLED
     */
    static RUST_VECTOR_ENABLED = 'rust_vector_enabled';

    
    static initialize(): void {
        this.canaryUsers = this.parseCanaryUsers(process.env.KAIRO_CANARY_USERS);
        this.betaPercent = this.parseBetaPercent(process.env.KAIRO_BETA_PERCENT);

        this.applyEnvFlag(this.ADAPTIVE_FLOW_ENABLED, process.env.KAIRO_ADAPTIVE_FLOW_ENABLED);
        this.applyEnvFlag(this.TOPOLOGY_SCANNER_ENABLED, process.env.KAIRO_TOPOLOGY_SCANNER_ENABLED);
        this.applyEnvFlag(this.UCG_ENABLED, process.env.KAIRO_UCG_ENABLED);
        this.applyEnvFlag(this.DUAL_WRITE_VALIDATION, process.env.KAIRO_DUAL_WRITE_VALIDATION);
        this.applyEnvFlag(this.MODULAR_HANDLERS_ENABLED, process.env.KAIRO_MODULAR_HANDLERS_ENABLED);
        this.applyEnvFlag(this.UNIFIED_EXTRACTION_ENABLED, process.env.KAIRO_UNIFIED_EXTRACTION_ENABLED);
        this.applyEnvFlag(this.PILLAR_DECOMPOSITION_ENABLED, process.env.KAIRO_PILLAR_DECOMPOSITION_ENABLED);
        this.applyEnvFlag(this.WRITERS_FLOW_DEFAULT_DRYRUN, process.env.KAIRO_WRITERS_FLOW_DEFAULT_DRYRUN);
        this.applyEnvFlag(this.WRITERS_FLOW_REVIEW_DEFAULTS, process.env.KAIRO_WRITERS_FLOW_REVIEW_DEFAULTS);
        this.applyEnvFlag(this.RUST_CORE_ENABLED, process.env.KAIRO_RUST_CORE_ENABLED);
        this.applyEnvFlag(this.RUST_CHUNKING_ENABLED, process.env.KAIRO_RUST_CHUNKING_ENABLED);
        this.applyEnvFlag(this.RUST_DIFF_ENABLED, process.env.KAIRO_RUST_DIFF_ENABLED);
        this.applyEnvFlag(this.RUST_SYNTAX_ENABLED, process.env.KAIRO_RUST_SYNTAX_ENABLED);
        this.applyEnvFlag(this.RUST_VECTOR_ENABLED, process.env.KAIRO_RUST_VECTOR_ENABLED);
        const modularPercent = process.env.KAIRO_MODULAR_ROLLOUT_PERCENT;
        if (!process.env.KAIRO_MODULAR_HANDLERS_ENABLED && modularPercent === undefined) {
            this.set(this.MODULAR_HANDLERS_ENABLED, true, 'on');
        }
        if (!process.env.KAIRO_UNIFIED_EXTRACTION_ENABLED && modularPercent === undefined) {
            this.set(this.UNIFIED_EXTRACTION_ENABLED, true, 'on');
        }
        if (!process.env.KAIRO_PILLAR_DECOMPOSITION_ENABLED && modularPercent === undefined) {
            this.set(this.PILLAR_DECOMPOSITION_ENABLED, true, 'on');
        }

        if (!this.isExplicit(this.RUST_CORE_ENABLED)) {
            this.set(this.RUST_CORE_ENABLED, true, 'on');
        }
        if (!this.isExplicit(this.RUST_CHUNKING_ENABLED)) {
            this.set(this.RUST_CHUNKING_ENABLED, true, 'on');
        }
        if (!this.isExplicit(this.RUST_DIFF_ENABLED)) {
            this.set(this.RUST_DIFF_ENABLED, true, 'on');
        }
        if (!this.isExplicit(this.RUST_SYNTAX_ENABLED)) {
            this.set(this.RUST_SYNTAX_ENABLED, true, 'on');
        }
        if (!this.isExplicit(this.RUST_VECTOR_ENABLED)) {
            this.set(this.RUST_VECTOR_ENABLED, true, 'on');
        }

        console.log('[FeatureFlags] Initialized:', this.debugState());
    }
    
    static isEnabled(flag: string, context?: FeatureFlagContext): boolean {
        const enabled = this.flags.get(flag) ?? false;
        const mode = this.modes.get(flag) ?? (enabled ? 'on' : 'off');
        if (!enabled && mode !== 'canary' && mode !== 'beta') {
            return false;
        }

        const userId = context?.userId ?? this.contextStorage.getStore()?.userId;
        if (mode === 'canary') {
            if (!userId) return false;
            return this.isCanaryUser(userId);
        }
        if (mode === 'beta') {
            if (!userId) return false;
            return this.isInBetaCohort(flag, userId);
        }
        return enabled;
    }
    
    static set(flag: string, enabled: boolean, mode?: RolloutMode): void {
        this.flags.set(flag, enabled);
        this.modes.set(flag, mode ?? (enabled ? 'on' : 'off'));
    }

    static withContext<T>(context: FeatureFlagContext | undefined, fn: () => T): T {
        if (!this.contextStorage) {
            return fn();
        }
        return this.contextStorage.run(context ?? {}, fn);
    }

    static getContext(): FeatureFlagContext | undefined {
        return this.contextStorage.getStore();
    }
    
    static getAll(): Record<string, boolean> {
        return Object.fromEntries(this.flags);
    }

    static getMode(flag: string): RolloutMode {
        return this.modes.get(flag) ?? 'off';
    }

    static resetForTesting(): void {
        this.flags.clear();
        this.modes.clear();
        this.explicitFlags.clear();
        this.canaryUsers.clear();
        this.betaPercent = 10;
        this.betaPercentByFlag.clear();
    }

    static setExplicit(flag: string, enabled: boolean, mode?: RolloutMode): void {
        this.set(flag, enabled, mode);
        this.explicitFlags.add(flag);
    }

    static isExplicit(flag: string): boolean {
        return this.explicitFlags.has(flag);
    }

    private static applyEnvFlag(flag: string, rawValue: string | undefined): void {
        const { enabled, mode } = this.parseFlagState(rawValue);
        this.flags.set(flag, enabled);
        this.modes.set(flag, mode);
        if (rawValue !== undefined) {
            this.explicitFlags.add(flag);
        }
    }

    private static parseFlagState(rawValue: string | undefined): { enabled: boolean; mode: RolloutMode } {
        if (!rawValue) {
            return { enabled: false, mode: 'off' };
        }
        const [modePart, payload] = rawValue.split(':', 2);
        const normalized = modePart.trim().toLowerCase();
        switch (normalized) {
            case 'true':
            case '1':
            case 'on':
                return { enabled: true, mode: 'on' };
            case 'full':
                return { enabled: true, mode: 'full' };
            case 'canary':
                if (payload) {
                    this.addCanaryUsers(payload.split(',').map(value => value.trim()).filter(Boolean));
                }
                return { enabled: true, mode: 'canary' };
            case 'beta':
                if (payload) {
                    this.setBetaPercent(this.parseBetaPercent(payload));
                }
                return { enabled: true, mode: 'beta' };
            case 'false':
            case '0':
            case 'off':
                return { enabled: false, mode: 'off' };
            default:
                return { enabled: rawValue === 'true', mode: rawValue === 'true' ? 'on' : 'off' };
        }
    }

    private static parseCanaryUsers(raw?: string): Set<string> {
        const users = new Set<string>();
        if (!raw) return users;
        raw.split(',').map(value => value.trim()).filter(Boolean).forEach(user => users.add(user));
        return users;
    }

    private static parseBetaPercent(raw?: string): number {
        if (!raw) return this.betaPercent || 10;
        const value = Number(raw);
        if (!Number.isFinite(value)) return this.betaPercent || 10;
        return Math.max(0, Math.min(100, value));
    }

    private static isCanaryUser(userId: string): boolean {
        if (this.canaryUsers.size === 0) return false;
        return this.canaryUsers.has(userId);
    }

    private static isInBetaCohort(flag: string, userId: string): boolean {
        const percentOverride = this.betaPercentByFlag.get(flag);
        const percent = percentOverride ?? this.betaPercent;
        if (percent <= 0) return false;
        if (percent >= 100) return true;
        const hash = createHash('sha1').update(userId).digest('hex');
        const value = parseInt(hash.slice(0, 8), 16);
        const percentValue = value % 10000;
        return percentValue / 100 < percent;
    }

    static addCanaryUsers(users: Iterable<string>): void {
        for (const user of users) {
            const normalized = user?.trim();
            if (normalized) {
                this.canaryUsers.add(normalized);
            }
        }
    }

    static setBetaPercent(percent: number): void {
        if (!Number.isFinite(percent)) return;
        this.betaPercent = Math.max(0, Math.min(100, percent));
    }

    static setBetaPercentForFlag(flag: string, percent: number): void {
        if (!Number.isFinite(percent)) return;
        this.betaPercentByFlag.set(flag, Math.max(0, Math.min(100, percent)));
    }

    static resetForTesting(): void {
        this.flags.clear();
        this.modes.clear();
        this.canaryUsers.clear();
        this.betaPercent = 10;
        this.betaPercentByFlag.clear();
    }

    private static debugState(): Record<string, { enabled: boolean; mode: RolloutMode }> {
        const entries: Array<[string, { enabled: boolean; mode: RolloutMode }]> = [];
        for (const [flag, enabled] of this.flags.entries()) {
            entries.push([flag, { enabled, mode: this.modes.get(flag) ?? 'off' }]);
        }
        return Object.fromEntries(entries);
    }
}

// Auto-initialize on module load
FeatureFlags.initialize();
