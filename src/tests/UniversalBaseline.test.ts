import { jest } from '@jest/globals';
import { AstManager } from '../ast/AstManager.js';

jest.setTimeout(20000);

describe('Universal Baseline (Phase 1 Infrastructure)', () => {
    let astManager: AstManager;

    beforeAll(async () => {
        astManager = AstManager.getInstance();
        await astManager.init();
    });

    it('should extract topology using queries', async () => {
        const content = `
            import { A } from './A';
            export function test() { return 1; }
        `;
        const result = await astManager.extractUniversalTopology('test.ts', content);
        
        expect(result.imports.length).toBeGreaterThan(0);
        expect(result.topLevelSymbols.length).toBeGreaterThan(0);
        expect(result.topLevelSymbols[0].name).toBe('test');
    });

    it('should generate skeleton using queries', async () => {
        const content = `
            function long() {
                console.log(1);
                console.log(2);
            }
        `;
        const skeleton = await astManager.generateUniversalSkeleton('test.ts', content);
        expect(skeleton).toContain('{ ... }');
        expect(skeleton).not.toContain('console.log');
    });
});
