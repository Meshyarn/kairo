import * as path from 'path';

/**
 * Standardizes all data paths used by kairo.
 * Root is typically `.kairo/` at the project root (unless overridden via `KAIRO_DIR`).
 */
export class PathManager {
    private static rootPath: string = process.cwd();
    private static repoId?: string;
    private static warnedLegacyMcpDir = false;

    /**
     * Explicitly sets the project root path for all subsequent path resolutions.
     */
    static setRoot(root: string, repoId?: string) {
        this.rootPath = path.resolve(root);
        this.repoId = repoId;
    }

    static getRootPath() {
        return this.rootPath;
    }

    static getBaseDir() {
        return this.resolveBaseDir();
    }

    static resolveForRoot(rootPath: string, ...segments: string[]): string {
        const baseDir = this.getBaseDir();
        if (path.isAbsolute(baseDir)) {
            return path.join(baseDir, ...segments);
        }
        return path.join(path.resolve(rootPath), baseDir, ...segments);
    }

    private static resolveBaseDir(): string {
        const raw = (process.env.KAIRO_DIR || '').trim();
        if (!raw) {
            return '.kairo';
        }

        const trimmed = raw.replace(/[\\/]+$/, '');
        const normalized = trimmed.replace(/\\/g, '/').replace(/\/+$/, '');
        const allowLegacy = process.env.KAIRO_ALLOW_LEGACY_MCP_DIR === 'true';
        if (!allowLegacy) {
            const isAbsolute = path.isAbsolute(trimmed);
            const legacyRelative =
                normalized === '.mcp' ||
                normalized === '.mcp/kairo' ||
                (!isAbsolute && normalized.includes('/.mcp/'));
            const legacyAbsolute =
                isAbsolute && (normalized.endsWith('/.mcp') || normalized.endsWith('/.mcp/kairo'));
            if (legacyRelative || legacyAbsolute) {
                if (!this.warnedLegacyMcpDir) {
                    console.warn('[PathManager] KAIRO_DIR points to deprecated .mcp path; using .kairo instead.');
                    this.warnedLegacyMcpDir = true;
                }
                return '.kairo';
            }
        }

        return trimmed;
    }

    /**
     * Resolves a path relative to the unified base directory (`KAIRO_DIR` / default `.kairo`).
     */
    static resolve(...segments: string[]): string {
        const baseDir = this.getBaseDir();
        if (path.isAbsolute(baseDir)) {
            return path.join(baseDir, ...segments);
        }
        return path.join(this.rootPath, baseDir, ...segments);
    }

    // --- Operational Data Paths ---

    private static withRepo(basePath: string, repoId?: string) {
        const effectiveRepoId = repoId ?? this.repoId;
        return effectiveRepoId ? path.join(basePath, "repos", effectiveRepoId) : basePath;
    }

    static getIndexDir(repoId?: string) {
        return this.withRepo(this.resolve('data', 'index'), repoId);
    }

    static getStorageDir(repoId?: string) {
        return this.withRepo(this.resolve('storage'), repoId);
    }

    static getCacheDir(repoId?: string) {
        return this.withRepo(this.resolve('data', 'cache'), repoId);
    }

    static getVectorIndexDir(repoId?: string) {
        return this.withRepo(this.resolve('vector-index'), repoId);
    }

    static getHistoryDir() {
        return this.resolve('data', 'history');
    }

    static getBackupDir() {
        return path.join(this.getHistoryDir(), 'backups');
    }

    static getLogPath() {
        return path.join(this.getHistoryDir(), 'transactions.db');
    }

    static getAuditDir() {
        return this.resolve('data', 'audit');
    }

    static getAuditLogPath() {
        return path.join(this.getAuditDir(), 'audit.jsonl');
    }

    static getMetricsDir() {
        return this.resolve('data', 'metrics');
    }

    static getMetricsLogPath() {
        return path.join(this.getMetricsDir(), 'metrics.jsonl');
    }

    // --- Configuration Paths ---

    static getConfigDir() {
        return this.resolve('config');
    }

    // --- Ephemeral/Temp Paths ---

    static getTempDir() {
        return this.resolve('temp');
    }

    static getTmpDir() {
        return this.resolve('tmp');
    }

    static getTestRootDir() {
        return path.join(this.getTempDir(), 'tests');
    }

    static getBenchmarkRootDir() {
        return path.join(this.getTempDir(), 'benchmarks');
    }

    /**
     * Generates a unique, isolated directory for a specific test run.
     */
    static getTestRunDir(id: string = Date.now().toString()) {
        return path.join(this.getTestRootDir(), `run_${id}`);
    }
}
