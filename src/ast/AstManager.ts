import * as path from 'path';
import { createHash } from 'crypto';
import { performance } from 'perf_hooks';
import { AstBackend, AstDocument } from './AstBackend.js';
import { EngineConfig, LOD_LEVEL, AnalysisRequest, LODResult, LODPromotionStats, SymbolInfo } from '../types.js';
import { LanguageConfigLoader } from '../config/LanguageConfig.js';
import { AdaptiveAstManager } from './AdaptiveAstManager.js';
import { FeatureFlags } from '../config/FeatureFlags.js';
import { AdaptiveFlowMetrics } from '../utils/AdaptiveFlowMetrics.js';
import { SkeletonCache } from './SkeletonCache.js';
import { SkeletonGenerator } from './SkeletonGenerator.js';
import { QueryProvider } from './QueryProvider.js';
import { UnifiedExtractor } from './extraction/UnifiedExtractor.js';
import { UniversalSkeletonGenerator } from './extraction/UniversalSkeletonGenerator.js';
import { UniversalSymbolExtractor } from './extraction/UniversalSymbolExtractor.js';
import { UniversalImportExtractor } from './extraction/UniversalImportExtractor.js';
import { UniversalExportExtractor } from './extraction/UniversalExportExtractor.js';
import { NodeFileSystem, type IFileSystem } from '../platform/FileSystem.js';
import {
    getLanguageMapping,
    instantiateBackend,
    initializeBackend,
    resolveConfig,
    resolveLanguageId
} from './AstManagerConfig.js';

export class AstManager implements AdaptiveAstManager {
    private static instance: AstManager | undefined;
    private initialized = false;
    private backend?: AstBackend;
    private engineConfig: EngineConfig;
    private activeBackend?: string;
    private languageConfig?: LanguageConfigLoader;
    private ucg?: { ensureLOD(req: AnalysisRequest): Promise<LODResult>; getNode(path: string): any; getStats(): { nodes: number }; invalidate(path: string, cascade?: boolean): void; dispose(): Promise<void> };
    private skeletonCache?: SkeletonCache;
    private skeletonGenerator?: SkeletonGenerator;
    private fileSystem: IFileSystem;

    private queryProvider: QueryProvider;
    private unifiedExtractor: UnifiedExtractor;
    private universalSkeletonGenerator: UniversalSkeletonGenerator;
    private universalSymbolExtractor: UniversalSymbolExtractor;
    private universalImportExtractor: UniversalImportExtractor;
    private universalExportExtractor: UniversalExportExtractor;

    // NEW: LOD promotion statistics
    private lodStats: LODPromotionStats = {
        l0_to_l1: 0,
        l1_to_l2: 0,
        l2_to_l3: 0,
        fallback_rate: 0,
        avg_promotion_time_ms: { l0_to_l1: 0, l1_to_l2: 0, l2_to_l3: 0 },
        total_files: 0
    };

    private dualWriteStats = {
        total: 0,
        mismatches: 0,
        samples: [] as Array<{ path: string; lod: LOD_LEVEL; ucgHash: string; legacyHash: string; timestamp: number }>
    };

    private constructor() {
        this.fileSystem = new NodeFileSystem(process.cwd());
        this.engineConfig = { mode: 'prod', parserBackend: 'auto' };
        this.backend = instantiateBackend('wasm', this.engineConfig);
        
        this.queryProvider = new QueryProvider(undefined, this.fileSystem);
        this.unifiedExtractor = new UnifiedExtractor(this.queryProvider);
        this.universalSkeletonGenerator = new UniversalSkeletonGenerator(this.queryProvider);
        this.universalSymbolExtractor = new UniversalSymbolExtractor(this.queryProvider);
        this.universalImportExtractor = new UniversalImportExtractor(this.queryProvider);
        this.universalExportExtractor = new UniversalExportExtractor(this.queryProvider);
    }

    public static getInstance(): AstManager {
        if (!AstManager.instance) {
            AstManager.instance = new AstManager();
        }
        return AstManager.instance;
    }

    public static resetForTesting(): void {
        if (AstManager.instance) {
            // Synchronous parts
            if (AstManager.instance.backend && typeof (AstManager.instance.backend as any).dispose === 'function') {
                (AstManager.instance.backend as any).dispose();
            }
            if (AstManager.instance.ucg) {
                // Fire and forget disposal for background watchers
                AstManager.instance.ucg.dispose().catch(() => {});
                AstManager.instance.ucg = undefined;
            }
            AstManager.instance.initialized = false;
            AstManager.instance.backend = undefined;
            AstManager.instance.engineConfig = { mode: 'prod', parserBackend: 'auto' };
            AstManager.instance.activeBackend = undefined;
            AstManager.instance.languageConfig?.dispose();
            AstManager.instance.languageConfig = undefined;
            AstManager.instance = undefined;
        }
    }

    /**
     * Complete asynchronous cleanup for tests that use UCG/FileWatcher.
     */
    public static async resetForTestingAsync(): Promise<void> {
        if (AstManager.instance) {
            await AstManager.instance.dispose();
            AstManager.instance = undefined;
        }
    }

    public registerBackend(backend: AstBackend): void {
        if (this.backend && this.backend.dispose) {
            this.backend.dispose();
        }
        this.backend = backend;
        this.activeBackend = backend.name;
        this.initialized = true;
    }

    public async init(config?: EngineConfig): Promise<void> {
        const resolved = resolveConfig(config, this.engineConfig);
        this.engineConfig = resolved;
        const root = resolved.rootPath ?? process.cwd();
        this.fileSystem = new NodeFileSystem(root);
        if (this.queryProvider) {
            this.queryProvider = new QueryProvider(undefined, this.fileSystem);
            this.unifiedExtractor = new UnifiedExtractor(this.queryProvider);
            this.universalSkeletonGenerator = new UniversalSkeletonGenerator(this.queryProvider);
            this.universalSymbolExtractor = new UniversalSymbolExtractor(this.queryProvider);
            this.universalImportExtractor = new UniversalImportExtractor(this.queryProvider);
            this.universalExportExtractor = new UniversalExportExtractor(this.queryProvider);
        }
        this.languageConfig?.dispose();
        this.languageConfig = new LanguageConfigLoader(root);
        const isTestEnv = resolved.mode === 'test' || process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
        if (!isTestEnv) {
            this.languageConfig.watch(() => {
                console.info('[LanguageConfig] Reloaded language mappings');
            });
        }

        if (this.initialized) {
            return;
        }

        await initializeBackend(this.engineConfig, this.backend, ({ backend, activeBackend }) => {
            this.backend = backend;
            this.activeBackend = activeBackend;
            this.initialized = true;
        });
    }

    public async warmup(languages: string[] = ['tsx', 'python', 'json']): Promise<void> {
        // Backend specific warmup could be added to interface, for now assume initialized
        if (!this.initialized) await this.init();
    }

    public async parseFile(filePath: string, content: string): Promise<AstDocument> {
        if (!this.initialized) await this.init();
        const mapping = this.getLanguageMapping(filePath);
        return this.backend!.parseFile(filePath, content, mapping?.languageId);
    }

    public async getParserForFile(filePath: string): Promise<any> {
        if (!this.initialized) await this.init();
        const mapping = this.getLanguageMapping(filePath);
        const langName = mapping?.languageId;
        if (!langName) {
            return null;
        }
        if (typeof (this.backend! as any).getParser === 'function') {
            try {
                return await (this.backend! as any).getParser(langName);
            } catch (error) {
                console.warn(`Failed to retrieve parser for ${filePath}:`, error);
                return null;
            }
        }
        return null;
    }

    public async getLanguageForFile(filePath: string): Promise<any> {
        if (!this.initialized) await this.init();
        const languageId = resolveLanguageId(filePath, this.languageConfig);
        if (languageId === "plain_text") {
            return null;
        }
        return this.backend!.getLanguage(languageId);
    }

    public getLanguageId(filePath: string): string {
        return resolveLanguageId(filePath, this.languageConfig);
    }

    public getQueryProvider(): QueryProvider {
        return this.queryProvider;
    }

    public async extractUniversalTopology(filePath: string, content: string): Promise<any> {
        const languageId = this.getLanguageId(filePath);
        const unifiedEnabled = FeatureFlags.isEnabled(FeatureFlags.UNIFIED_EXTRACTION_ENABLED, FeatureFlags.getContext());
        return this.unifiedExtractor.extractTopology(filePath, content, languageId, {
            docProvider: () => this.parseFile(filePath, content),
            forceBackend: unifiedEnabled ? undefined : 'treesitter'
        });
    }

    public async generateUniversalSkeleton(filePath: string, content: string, options?: any): Promise<string> {
        if (this.getLanguageId(filePath) === "plain_text") {
            return content;
        }
        let doc: AstDocument | undefined;
        try {
            doc = await this.parseFile(filePath, content);
            const hasError = typeof (doc.rootNode as any)?.hasError === 'function'
                ? (doc.rootNode as any).hasError()
                : Boolean((doc.rootNode as any)?.hasError);
            if (hasError) {
                throw new Error('Parser reported syntax errors');
            }
            return await this.universalSkeletonGenerator.generate(doc, this.getLanguageId(filePath), options);
        } finally {
            doc?.dispose?.();
        }
    }

    public async findIdentifiers(filePath: string, content: string, targetNames: string[]): Promise<any[]> {
        if (this.getLanguageId(filePath) === "plain_text") {
            return [];
        }
        let doc: AstDocument | undefined;
        try {
            doc = await this.parseFile(filePath, content);
            return await this.universalSkeletonGenerator.findIdentifiers(doc, this.getLanguageId(filePath), targetNames);
        } finally {
            doc?.dispose?.();
        }
    }

    public async generateStructureJson(filePath: string, content: string): Promise<SymbolInfo[]> {
        if (!content.trim()) {
            return [];
        }
        let doc: AstDocument | undefined;
        try {
            doc = await this.parseFile(filePath, content);
            const languageId = this.getLanguageId(filePath);
            const [imports, exports, symbols] = await Promise.all([
                this.universalImportExtractor.extract(doc, languageId),
                this.universalExportExtractor.extract(doc, languageId),
                this.universalSymbolExtractor.extract(doc, languageId)
            ]);
            return [...imports, ...exports, ...symbols];
        } catch (error: any) {
            const message = typeof error?.message === 'string' ? error.message : '';
            if (message.includes('Unsupported language') || message.includes('Failed to load language')) {
                return [];
            }
            throw error;
        } finally {
            doc?.dispose?.();
        }
    }

    public getActiveBackend(): string | undefined {
        return this.activeBackend;
    }

    public getUCG(): NonNullable<AstManager['ucg']> {
        if (!this.ucg) {
            // UCG module was removed in ADR-092. Stub that always returns undefined nodes.
            this.ucg = {
                async ensureLOD(req: AnalysisRequest): Promise<LODResult> {
                    return { path: req.path, previousLOD: 0, currentLOD: 0, requestedLOD: req.minLOD ?? 0, promoted: false, durationMs: 0, fallbackUsed: false, confidence: 0 };
                },
                getNode(_path: string) { return undefined; },
                getStats() { return { nodes: 0 }; },
                invalidate() {},
                async dispose() {}
            };
        }
        return this.ucg;
    }

    // NEW: Implement AdaptiveAstManager interface
    async ensureLOD(request: AnalysisRequest): Promise<LODResult> {
        const context = FeatureFlags.getContext();
        if (!FeatureFlags.isEnabled(FeatureFlags.ADAPTIVE_FLOW_ENABLED, context)) {
            return await this.fallbackToFullAST(request.path);
        }
        
        const ucg = this.getUCG();
        const result = await ucg.ensureLOD(request);
        
        // ADR-043: Record promotion metrics
        if (result.promoted) {
            AdaptiveFlowMetrics.recordPromotion(result.previousLOD, result.currentLOD);
            this.updateStats(result);
        }
        
        // Dual-write validation (if enabled)
        if (FeatureFlags.isEnabled(FeatureFlags.DUAL_WRITE_VALIDATION)) {
            await this.validateDualWrite(request.path, result);
        }
        
        return result;
    }

    private updateStats(result: LODResult) {
        const prev = result.previousLOD;
        const curr = result.currentLOD;
        const duration = result.durationMs;

        if (prev === 0 && curr >= 1) {
            this.lodStats.l0_to_l1++;
            this.lodStats.avg_promotion_time_ms.l0_to_l1 = 
                (this.lodStats.avg_promotion_time_ms.l0_to_l1 * (this.lodStats.l0_to_l1 - 1) + duration) / this.lodStats.l0_to_l1;
        }
        if (prev <= 1 && curr >= 2) {
            this.lodStats.l1_to_l2++;
            this.lodStats.avg_promotion_time_ms.l1_to_l2 = 
                (this.lodStats.avg_promotion_time_ms.l1_to_l2 * (this.lodStats.l1_to_l2 - 1) + duration) / this.lodStats.l1_to_l2;
        }
        if (prev <= 2 && curr === 3) {
            this.lodStats.l2_to_l3++;
            this.lodStats.avg_promotion_time_ms.l2_to_l3 = 
                (this.lodStats.avg_promotion_time_ms.l2_to_l3 * (this.lodStats.l2_to_l3 - 1) + duration) / this.lodStats.l2_to_l3;
        }

        if (result.fallbackUsed) {
            const total = this.lodStats.l0_to_l1 + this.lodStats.l1_to_l2 + this.lodStats.l2_to_l3;
            this.lodStats.fallback_rate = total > 0 ? (this.lodStats.l0_to_l1 / total) : 0;
        }
    }

    private async validateDualWrite(path: string, result: LODResult): Promise<void> {
        if (result.currentLOD < 2) {
            return;
        }

        const ucgNode = this.getUCG().getNode(path);
        const ucgSkeleton = ucgNode?.skeleton;
        if (!ucgSkeleton) {
            return;
        }

        try {
            const cache = this.getSkeletonCache();
            const generator = this.getSkeletonGenerator();
            const legacySkeleton = await cache.getSkeleton(
                path,
                { detailLevel: 'standard', includeComments: false },
                async (filePath, options) => {
                    const content = await this.fileSystem.readFile(filePath);
                    return generator.generateSkeleton(filePath, content, options);
                }
            );

            const ucgHash = this.hashSkeleton(ucgSkeleton);
            const legacyHash = this.hashSkeleton(legacySkeleton);

            this.dualWriteStats.total++;
            if (ucgHash !== legacyHash) {
                this.dualWriteStats.mismatches++;
                this.dualWriteStats.samples.unshift({
                    path,
                    lod: result.currentLOD,
                    ucgHash,
                    legacyHash,
                    timestamp: Date.now()
                });
                this.dualWriteStats.samples = this.dualWriteStats.samples.slice(0, 10);
                console.warn(`[DualWrite] Skeleton mismatch detected for ${path}`, {
                    lod: result.currentLOD,
                    ucgHash,
                    legacyHash
                });
            } else if (this.dualWriteStats.total % 100 === 0) {
                console.info(`[DualWrite] ${this.dualWriteStats.total} validations executed (${this.dualWriteStats.mismatches} mismatches).`);
            }
        } catch (error) {
            console.warn(`[DualWrite] Failed to validate ${path}:`, error);
        }
    }

    private getSkeletonCache(): SkeletonCache {
        if (!this.skeletonCache) {
            const root = this.engineConfig.rootPath ?? process.cwd();
            this.skeletonCache = new SkeletonCache(root);
        }
        return this.skeletonCache;
    }

    private getSkeletonGenerator(): SkeletonGenerator {
        if (!this.skeletonGenerator) {
            this.skeletonGenerator = new SkeletonGenerator();
        }
        return this.skeletonGenerator;
    }

    private hashSkeleton(content: string): string {
        return createHash('sha1').update(content).digest('hex').slice(0, 12);
    }
    
    getFileNode(path: string) {
        if (!FeatureFlags.isEnabled(FeatureFlags.UCG_ENABLED)) return undefined;
        return this.getUCG().getNode(path);
    }
    
    getCurrentLOD(path: string): LOD_LEVEL {
        if (!FeatureFlags.isEnabled(FeatureFlags.UCG_ENABLED)) return 0;
        return this.getUCG().getNode(path)?.lod ?? 0;
    }
    
    promotionStats(): LODPromotionStats {
        return { ...this.lodStats, total_files: this.ucg ? this.getUCG().getStats().nodes : 0 };
    }
    
    async fallbackToFullAST(path: string): Promise<LODResult> {
        const startTime = performance.now();
        // Read actual content for accurate parsing
        const content = this.fileSystem.existsSync?.(path)
            ? (this.fileSystem.readFileSync?.(path) ?? await this.fileSystem.readFile(path))
            : '';
        await this.parseFile(path, content);
        const durationMs = performance.now() - startTime;
        AdaptiveFlowMetrics.recordPromotion(0, 3);
        
        return {
            path, previousLOD: 0, currentLOD: 3, requestedLOD: 3,
            promoted: true, durationMs, fallbackUsed: true, confidence: 1.0
        };
    }
    
    invalidate(path: string, cascade: boolean = false): void {
        if (FeatureFlags.isEnabled(FeatureFlags.UCG_ENABLED)) {
            this.getUCG().invalidate(path, cascade);
        }
    }

    public supportsQueries(): boolean {
        if (!this.backend) return false;
        return this.backend.capabilities.supportsQueries;
    }

    private getLanguageMapping(filePath: string) {
        return getLanguageMapping(filePath, this.languageConfig);
    }

    public async dispose(): Promise<void> {
        if (this.backend && typeof (this.backend as any).dispose === 'function') {
            (this.backend as any).dispose();
        }
        if (this.ucg) {
            await this.ucg.dispose();
            this.ucg = undefined;
        }
        this.languageConfig?.dispose();
        this.initialized = false;
    }
}
