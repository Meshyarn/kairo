import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GhostInterfaceBuilder } from '../resolution/GhostInterfaceBuilder.js';
import { SearchEngine } from '../engine/Search.js';
import { CallSiteAnalyzer } from '../ast/analysis/CallSiteAnalyzer.js';
import { AstManager } from '../ast/AstManager.js';
import { NodeFileSystem } from '../platform/FileSystem.js';
import { IndexDatabase } from '../indexing/IndexDatabase.js';
import { NativeSearchCoreStub } from './utils/NativeSearchCoreStub.js';

jest.setTimeout(30000);

describe('GhostInterfaceBuilder', () => {
    let builder: GhostInterfaceBuilder;
    let tempDir: string;
    let astManager: AstManager;
    let searchEngine: SearchEngine;
    let db: IndexDatabase;
    let fileSystem: NodeFileSystem;
    let nativeCore: NativeSearchCoreStub;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-interface-test-'));
        fileSystem = new NodeFileSystem(tempDir);
        nativeCore = new NativeSearchCoreStub();
        
        AstManager.resetForTesting();
        astManager = AstManager.getInstance();
        await astManager.init({ mode: 'test', rootPath: tempDir });

        db = new IndexDatabase(tempDir);
        
        searchEngine = new SearchEngine(tempDir, fileSystem, [], {
            nativeSearchCore: nativeCore,
            repoId: "default"
        });

        builder = new GhostInterfaceBuilder(
            searchEngine,
            new CallSiteAnalyzer(),
            astManager,
            fileSystem,
            tempDir
        );
    });

    afterEach(async () => {
        await searchEngine.dispose();
        db.dispose();
        AstManager.resetForTesting();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should reconstruct a ghost interface from usage patterns', async () => {
        const usageFile = path.join(tempDir, 'usage.ts');
        fs.writeFileSync(usageFile, `
            import { MissingService } from './missing';
            
            async function test() {
                const svc = new MissingService();
                await svc.saveData({ id: 1 });
                const data = svc.fetchData(123);
                svc.unknownMethod();
            }
        `);

        await indexFile(nativeCore, tempDir, fileSystem, usageFile);
        const ghost = await builder.reconstruct('MissingService');

        expect(ghost).toBeDefined();
        expect(ghost?.name).toBe('MissingService');
        expect(ghost?.methods.length).toBeGreaterThan(0);
        
        const methodNames = ghost?.methods.map(m => m.name);
        expect(methodNames).toContain('saveData');
        expect(methodNames).toContain('fetchData');
        expect(methodNames).toContain('unknownMethod');
        expect(methodNames).toContain('constructor');
    });

    it('should reconstruct a ghost interface from usage patterns with async and arguments', async () => {
        const usageFile = path.join(tempDir, 'usage_advanced.ts');
        fs.writeFileSync(usageFile, `
            import { MissingService } from './missing';
            async function test() {
                const svc = new MissingService();
                await svc.saveData({ id: 1 }, true);
                const data = svc.fetchData(123);
            }
        `);

        await indexFile(nativeCore, tempDir, fileSystem, usageFile);
        const ghost = await builder.reconstruct('MissingService');

        expect(ghost).toBeDefined();
        
        const saveMethod = ghost?.methods.find(m => m.name === 'saveData');
        expect(saveMethod?.inferredSignature).toContain('arg0: any, arg1: any');
        expect(saveMethod?.inferredSignature).toContain('Promise<any>');

        const fetchMethod = ghost?.methods.find(m => m.name === 'fetchData');
        expect(fetchMethod?.inferredSignature).toContain('arg0: any');
        expect(fetchMethod?.inferredSignature).not.toContain('Promise<any>');
    });

    it('should downgrade confidence on inconsistent argument counts', async () => {
        const usageFile = path.join(tempDir, 'conflict.ts');
        fs.writeFileSync(usageFile, `
            import { BrokenSvc } from './broken';
            function t1() {
                const s = new BrokenSvc();
                s.fix(1);
            }
            function t2() {
                const s = new BrokenSvc();
                s.fix(1, 2, 3, 4);
            }
        `);

        await indexFile(nativeCore, tempDir, fileSystem, usageFile);
        const ghost = await builder.reconstruct('BrokenSvc');

        const fixMethod = ghost?.methods.find(m => m.name === 'fix');
        // Consistency will be 0.5 (1/2), which is low
        expect(fixMethod?.confidence).toBe('low');
    });

    it('should return null if no usage is found', async () => {
        const ghost = await builder.reconstruct('NonExistentSymbol');
        expect(ghost).toBeNull();
    });
});

async function indexFile(core: NativeSearchCoreStub, rootPath: string, fileSystem: NodeFileSystem, absPath: string) {
    const content = await fileSystem.readFile(absPath);
    const relative = path.relative(rootPath, absPath).replace(/\\/g, "/");
    core.upsert({
        kind: "code_file",
        repoId: "default",
        path: relative,
        content,
        pathDepth: Math.max(0, relative.split("/").filter(Boolean).length - 1),
        callgraphRank: 0
    });
}
