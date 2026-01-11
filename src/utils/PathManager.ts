import * as path from 'path';
import * as os from 'os';

/**
 * Standardizes all data paths used by kairo.
 * Root is typically '.kairo/' at the project root.
 */
export class PathManager {
    private static baseDir = PathManager.resolveBaseDir();
    private static rootPath: string = process.cwd();
    private static repoId?: string;

    /**
     * Explicitly sets the project root path for all subsequent path resolutions.
     */
    static setRoot(root: string, repoId?: string) {
        this.rootPath = path.resolve(root);
        this.repoId = repoId;
    }

    private static resolveBaseDir(): string {
        const raw = (process.env.KAIRO_DIR || '').trim();
        if (!raw) {
            return '.kairo';
        }

        const normalized = raw.replace(/\\/g, '/').replace(/\/+$/, '');
        const allowLegacy = process.env.KAIRO_ALLOW_LEGACY_MCP_DIR === 'true';
        if (!allowLegacy) {
            if (normalized === '.mcp' || normalized === '.mcp/kairo') {
                console.warn('[PathManager] KAIRO_DIR points to deprecated .mcp path; using .kairo instead.');
                return '.kairo';
            }
            if (normalized.includes('/.mcp/')) {
                console.warn('[PathManager] KAIRO_DIR points to deprecated .mcp path; using .kairo instead.');
                return '.kairo';
            }
        }

        return raw;
    }

    /**
     * Resolves a path relative to the unified .kairo directory.
     */
    static resolve(...segments: string[]): string {
        return path.join(this.rootPath, this.baseDir, ...segments);
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

    // --- Configuration Paths ---

    static getConfigDir() {
        return this.resolve('config');
    }

    // --- Ephemeral/Temp Paths ---

    static getTempDir() {
        return this.resolve('temp');
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
