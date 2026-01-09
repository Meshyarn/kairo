import { AstManager } from '../ast/AstManager.js';

describe('Tree Dump', () => {
    it('should dump tree structure', async () => {
        const astManager = AstManager.getInstance();
        await astManager.init();
        const parser = await (astManager as any).getParserForFile('test.ts');
        if (parser) {
            const tree = parser.parse("import type { A } from 'b';");
            const importStmt = tree.rootNode.firstChild;
            if (importStmt) {
                console.log('Import Children:', importStmt.children.map((c: any) => `${c.type}('${c.text}')`));
                const clause = importStmt.children.find((c: any) => c.type === 'import_clause');
                if (clause) {
                    console.log('Clause Children:', clause.children.map((c: any) => `${c.type}('${c.text}')`));
                }
            }
        }
    });
});
