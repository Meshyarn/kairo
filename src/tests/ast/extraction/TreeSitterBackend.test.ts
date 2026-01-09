import { jest } from '@jest/globals';
import { TreeSitterBackend } from '../../../ast/extraction/backends/TreeSitterBackend.js';
import { AstManager } from '../../../ast/AstManager.js';

jest.setTimeout(20000);

describe('TreeSitterBackend', () => {
    let manager: AstManager;
    let backend: TreeSitterBackend;

    beforeAll(async () => {
        AstManager.resetForTesting();
        manager = AstManager.getInstance();
        await manager.init({ mode: 'test', parserBackend: 'wasm' });
        backend = new TreeSitterBackend(manager.getQueryProvider());
    });

    afterAll(async () => {
        await AstManager.resetForTestingAsync();
    });

    test('extracts imports, exports, and symbols', async () => {
        const content = `
import { foo as bar } from './utils';
export const value = 1;
class User {
  greet() {
    return 'hi';
  }
}
`;
        const doc = await manager.parseFile('sample.ts', content);
        try {
            const imports = await backend.extractImports({
                filePath: 'sample.ts',
                content,
                languageId: 'typescript',
                doc
            });
            const exports = await backend.extractExports({
                filePath: 'sample.ts',
                content,
                languageId: 'typescript',
                doc
            });
            const symbols = await backend.extractSymbols({
                filePath: 'sample.ts',
                content,
                languageId: 'typescript',
                doc
            });

            expect(imports[0].specifier).toBe('./utils');
            expect(imports[0].what).toContain('bar');
            expect(exports.some(entry => entry.exportType === 'named')).toBe(true);
            expect(symbols.some(symbol => symbol.name === 'User')).toBe(true);
        } finally {
            doc.dispose?.();
        }
    });

    test('throws when AST document is missing', async () => {
        await expect(backend.extractImports({
            filePath: 'sample.ts',
            content: 'export const value = 1;',
            languageId: 'typescript'
        } as any)).rejects.toThrow('AST document');
    });
});
