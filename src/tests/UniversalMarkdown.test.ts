import { jest } from '@jest/globals';
import { AstManager } from '../ast/AstManager.js';

jest.setTimeout(30000);

describe('Universal Language Parity - Markdown Support', () => {
    let astManager: AstManager;

    beforeAll(async () => {
        astManager = AstManager.getInstance();
        await astManager.init();
    });

    it('should extract headings from markdown using universal topology', async () => {
        const content = `
# Project Title
## Introduction
Some text here.
### Detailed Section
# Final Thoughts
        `.trim();
        
        const filePath = 'test.md';
        const topology = await (astManager as any).extractUniversalTopology(filePath, content);
        
        // Check symbols (headings)
        const symbolNames = topology.topLevelSymbols.map((s: any) => s.name);
        expect(symbolNames).toContain('Project Title');
        expect(symbolNames).toContain('Introduction');
        expect(symbolNames).toContain('Detailed Section');
        expect(symbolNames).toContain('Final Thoughts');
    });

    it('should generate markdown skeleton by folding body blocks', async () => {
        const content = `
# Title
This is a long paragraph that should be folded in the skeleton view to save tokens.
It has multiple lines.

## Section
Another paragraph here.
- List item 1
- List item 2

\`\`\`typescript
const x = 1;
\`\`\`
        `.trim();
        
        const filePath = 'test.md';
        const skeleton = await (astManager as any).generateUniversalSkeleton(filePath, content);
        
        expect(skeleton).toContain('# Title');
        expect(skeleton).toContain('## Section');
        // Universal engine defaults to { ... } for folded blocks
        expect(skeleton).toContain('{ ... }');
        
        // Paragraphs and lists and code blocks should be replaced
        expect(skeleton).not.toContain('This is a long paragraph');
        expect(skeleton).not.toContain('List item 1');
        expect(skeleton).not.toContain('const x = 1');
    });

    it('should extract links from markdown using regex fallback in universal topology', async () => {
        const content = `
# Title
[Link Text](https://example.com)
![Image](img.png)
[ref]: /path/to/resource
        `.trim();
        
        const topology = await (astManager as any).extractUniversalTopology('test.md', content);
        const links = topology.imports;
        // Image ![]() should be ignored by our regex
        expect(links.length).toBe(2); 
        
        expect(links).toContainEqual(expect.objectContaining({
            name: 'Link Text',
            source: 'https://example.com'
        }));
        expect(links).toContainEqual(expect.objectContaining({
            name: 'ref',
            source: '/path/to/resource'
        }));
    });
});
