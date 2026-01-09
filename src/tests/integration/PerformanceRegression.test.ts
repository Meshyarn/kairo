import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { performance } from 'perf_hooks';
import { AstManager } from '../../ast/AstManager.js';
import { UnifiedExtractor } from '../../ast/extraction/UnifiedExtractor.js';
import { AdaptiveFlowMetrics } from '../../utils/AdaptiveFlowMetrics.js';

describe('Performance regression', () => {
    let manager: AstManager;

    beforeAll(async () => {
        AstManager.resetForTesting();
        manager = AstManager.getInstance();
        await manager.init({ mode: 'test', parserBackend: 'wasm' });
    });

    afterAll(async () => {
        await AstManager.resetForTestingAsync();
    });

    it('records topology scans within a reasonable time', async () => {
        const extractor = new UnifiedExtractor(manager.getQueryProvider(), { regexConfidenceThreshold: 1.1 });
        const content = 'import { foo } from "./foo";\nexport const bar = 1;';
        const before = AdaptiveFlowMetrics.getMetrics();
        const beforeCount = before.topology_scanner.success_count + before.topology_scanner.fallback_count;

        const start = performance.now();
        const result = await extractor.extractTopology('sample.ts', content, 'typescript', {
            docProvider: () => manager.parseFile('sample.ts', content)
        });
        const elapsed = performance.now() - start;

        const after = AdaptiveFlowMetrics.getMetrics();
        const afterCount = after.topology_scanner.success_count + after.topology_scanner.fallback_count;

        expect(afterCount).toBeGreaterThan(beforeCount);
        expect(result.imports.length).toBeGreaterThan(0);
        expect(elapsed).toBeLessThan(5000);
    }, 10000);
});
