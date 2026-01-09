import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as path from 'path';

describe('PathManager', () => {
    let PathManager: any;
    const originalEnv = process.env;

    beforeEach(async () => {
        jest.resetModules();
        process.env = { ...originalEnv };
        const module = await import('../../utils/PathManager.js');
        PathManager = module.PathManager;
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('defaults to .kairo baseDir', () => {
        PathManager.setRoot('/root');
        expect(PathManager.resolve('test')).toBe(path.join('/root', '.kairo', 'test'));
    });

    it('respects KAIRO_DIR environment variable', async () => {
        jest.resetModules();
        process.env.KAIRO_DIR = '.custom-context';
        const module = await import('../../utils/PathManager.js');
        const CustomPathManager = module.PathManager;
        CustomPathManager.setRoot('/root');
        expect(CustomPathManager.resolve('test')).toBe(path.join('/root', '.custom-context', 'test'));
    });

    it('warns and falls back from legacy .mcp directory', async () => {
        jest.resetModules();
        process.env.KAIRO_DIR = '.mcp';
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        
        const module = await import('../../utils/PathManager.js');
        const LegacyPathManager = module.PathManager;
        LegacyPathManager.setRoot('/root');
        
        expect(LegacyPathManager.resolve('test')).toBe(path.join('/root', '.kairo', 'test'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('deprecated .mcp path'));
        
        consoleSpy.mockRestore();
    });

    it('allows legacy .mcp directory if KAIRO_ALLOW_LEGACY_MCP_DIR is true', async () => {
        jest.resetModules();
        process.env.KAIRO_DIR = '.mcp';
        process.env.KAIRO_ALLOW_LEGACY_MCP_DIR = 'true';
        
        const module = await import('../../utils/PathManager.js');
        const LegacyPathManager = module.PathManager;
        LegacyPathManager.setRoot('/root');
        
        expect(LegacyPathManager.resolve('test')).toBe(path.join('/root', '.mcp', 'test'));
    });

    it('provides various operational directories', () => {
        PathManager.setRoot('/root');
        const base = path.join('/root', '.kairo');
        
        expect(PathManager.getIndexDir()).toBe(path.join(base, 'data', 'index'));
        expect(PathManager.getStorageDir()).toBe(path.join(base, 'storage'));
        expect(PathManager.getCacheDir()).toBe(path.join(base, 'data', 'cache'));
        expect(PathManager.getVectorIndexDir()).toBe(path.join(base, 'vector-index'));
        expect(PathManager.getHistoryDir()).toBe(path.join(base, 'data', 'history'));
        expect(PathManager.getBackupDir()).toBe(path.join(base, 'data', 'history', 'backups'));
        expect(PathManager.getLogPath()).toBe(path.join(base, 'data', 'history', 'transactions.db'));
        expect(PathManager.getConfigDir()).toBe(path.join(base, 'config'));
        expect(PathManager.getTempDir()).toBe(path.join(base, 'temp'));
        expect(PathManager.getTestRootDir()).toBe(path.join(base, 'temp', 'tests'));
        expect(PathManager.getBenchmarkRootDir()).toBe(path.join(base, 'temp', 'benchmarks'));
    });

    it('generates test run directories', () => {
        PathManager.setRoot('/root');
        const runDir = PathManager.getTestRunDir('123');
        expect(runDir).toBe(path.join('/root', '.kairo', 'temp', 'tests', 'run_123'));
    });
});
