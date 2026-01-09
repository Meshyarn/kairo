import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { RegexBackend } from '../ast/extraction/backends/RegexBackend.js';
import { AstManager } from '../ast/AstManager.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

jest.setTimeout(20000);

describe('RegexBackend', () => {
    let backend: RegexBackend;
    let manager: AstManager;
    let tempDir: string;
    
    beforeEach(async () => {
        backend = new RegexBackend();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'topology-test-'));
        
        AstManager.resetForTesting();
        manager = AstManager.getInstance();
        await manager.init({ mode: 'test', rootPath: process.cwd() });
    });
    
    afterEach(async () => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        await AstManager.resetForTestingAsync();
    });
    
    describe('Regex Extraction', () => {
        it('should extract named imports', async () => {
            const testFile = path.join(tempDir, 'test.ts');
            fs.writeFileSync(testFile, 'import { foo, bar } from "module1";\nimport { baz as qux } from "module2";');
            
            const result = await backend.extractTopology({
                filePath: testFile,
                content: fs.readFileSync(testFile, 'utf-8')
            });
            expect(result.imports).toHaveLength(2);
            expect(result.imports[0].source).toBe('module1');
            expect(result.imports[1].source).toBe('module2');
        });
        
        it('should extract default imports', async () => {
            const testFile = path.join(tempDir, 'test.ts');
            fs.writeFileSync(testFile, 'import React from "react";\nimport _ from "lodash";');
            
            const result = await backend.extractTopology({
                filePath: testFile,
                content: fs.readFileSync(testFile, 'utf-8')
            });
            expect(result.imports).toHaveLength(2);
            expect(result.imports[0].isDefault).toBe(true);
            expect(result.imports[0].namedImports).toContain('React');
        });

        it('should extract type-only imports', async () => {
            const testFile = path.join(tempDir, 'types.ts');
            fs.writeFileSync(testFile, 'import type { Foo } from "types";\nimport { type Bar } from "module";');

            const result = await backend.extractTopology({
                filePath: testFile,
                content: fs.readFileSync(testFile, 'utf-8')
            });
            expect(result.imports[0].isTypeOnly).toBe(true);
        });

        it('should extract namespace imports and re-exports', async () => {
            const testFile = path.join(tempDir, 'namespace.ts');
            fs.writeFileSync(testFile, 'import * as Utils from "./utils";\nexport * from "./shared";');

            const result = await backend.extractTopology({
                filePath: testFile,
                content: fs.readFileSync(testFile, 'utf-8')
            });
            const namespaceImport = result.imports.find(imp => imp.namedImports.includes('* as Utils'));
            expect(namespaceImport).toBeDefined();
            const reExport = result.exports.find(exp => exp.reExportFrom === './shared');
            expect(reExport).toBeDefined();
        });

        it('should extract dynamic imports', async () => {
            const testFile = path.join(tempDir, 'dynamic.ts');
            fs.writeFileSync(testFile, 'async function load() { return import("./feature"); }');

            const result = await backend.extractTopology({
                filePath: testFile,
                content: fs.readFileSync(testFile, 'utf-8')
            });
            const dynamicEntries = result.imports.filter(imp => imp.isDynamic);
            expect(dynamicEntries).toHaveLength(1);
            expect(dynamicEntries[0].source).toBe('./feature');
        });
        
        it('should extract top-level symbols', async () => {
            const testFile = path.join(tempDir, 'test.ts');
            fs.writeFileSync(testFile, 'function internalHelper() {}\nexport class Service {}\nexport interface Config {}\nconst API_KEY = "secret";');
            
            const result = await backend.extractTopology({
                filePath: testFile,
                content: fs.readFileSync(testFile, 'utf-8')
            });
            const symbols = result.topLevelSymbols.map(s => s.name);
            expect(symbols).toContain('internalHelper');
            expect(symbols).toContain('Service');
            expect(symbols).toContain('Config');
            expect(symbols).toContain('API_KEY');
        });
    });
    
    describe('Comment Handling', () => {
        it('should ignore imports in comments', async () => {
            const testFile = path.join(tempDir, 'test.ts');
            fs.writeFileSync(testFile, '// import { fake } from "commented";\nimport { real } from "actual";');
            
            const result = await backend.extractTopology({
                filePath: testFile,
                content: fs.readFileSync(testFile, 'utf-8')
            });
            expect(result.imports).toHaveLength(1);
            expect(result.imports[0].source).toBe('actual');
        });
    });
    
    describe('Confidence and Fallback', () => {
        it('should have high confidence for standard files', async () => {
            const testFile = path.join(tempDir, 'test.ts');
            fs.writeFileSync(testFile, 'import { foo } from "bar";\nexport const x = 1;');
            
            const result = await backend.extractTopology({
                filePath: testFile,
                content: fs.readFileSync(testFile, 'utf-8')
            });
            expect(result.confidence).toBeGreaterThanOrEqual(0.95);
            expect(result.fallbackUsed).toBe(false);
        });
        
        it('should fallback to AST for complex files (large files)', async () => {
            const testFile = path.join(tempDir, 'large.ts');
            let largeContent = 'import { foo } from "bar";\n';
            for (let i = 0; i < 1100; i++) {
                largeContent += '// line ' + i + '\n';
            }
            largeContent += 'export const x = 1;';
            fs.writeFileSync(testFile, largeContent);
            
            const result = await manager.extractUniversalTopology(testFile, largeContent);
            expect(result.fallbackUsed).toBe(true);
            expect(result.confidence).toBe(1.0);
        });
    });
});
