import { UnifiedExtractor } from '../../../ast/extraction/UnifiedExtractor.js';
import { AstManager } from '../../../ast/AstManager.js';

const buildContent = () => `
import React, { useState as useStateAlias } from './react';
export const greeting = 'hello';
`;

describe('UnifiedExtractor', () => {
    let manager: AstManager;

    beforeAll(async () => {
        AstManager.resetForTesting();
        manager = AstManager.getInstance();
        await manager.init({ mode: 'test', parserBackend: 'wasm' });
    });

    afterAll(async () => {
        await AstManager.resetForTestingAsync();
    });

    test('uses regex when no document is provided', async () => {
        const extractor = new UnifiedExtractor(manager.getQueryProvider());
        const content = buildContent();

        const result = await extractor.extractTopology('sample.ts', content, 'typescript');

        expect(result.imports.length).toBeGreaterThan(0);
        expect(result.exports.some(exp => exp.name === 'greeting')).toBe(true);
        expect(result.fallbackUsed).toBe(false);
    });

    test('falls back to tree-sitter when confidence is below threshold', async () => {
        const extractor = new UnifiedExtractor(manager.getQueryProvider(), { regexConfidenceThreshold: 1.1 });
        const content = buildContent();

        const result = await extractor.extractTopology('sample.ts', content, 'typescript', {
            docProvider: () => manager.parseFile('sample.ts', content)
        });

        expect(result.fallbackUsed).toBe(true);
        expect(result.confidence).toBe(1.0);
        expect(result.topLevelSymbols.some(symbol => symbol.name === 'greeting')).toBe(true);
    });
});
