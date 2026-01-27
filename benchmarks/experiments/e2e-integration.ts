
import { InternalToolRegistry } from '../src/orchestration/InternalToolRegistry.js';
import { OrchestrationContext } from '../src/orchestration/OrchestrationContext.js';
import { ExplorePillar } from '../src/orchestration/pillars/ExplorePillar.js';
import { UnderstandPillar } from '../src/orchestration/pillars/UnderstandPillar.js';
import { AstManager } from '../src/ast/AstManager.js';
import * as fs from 'fs';
import * as path from 'path';

async function runE2ETest() {
    console.log("============================================================");
    console.log("Phase 4: Multi-Language E2E Integration Test");
    console.log("============================================================");

    const registry = new InternalToolRegistry();
    const astManager = AstManager.getInstance();
    await astManager.init();

    // Mock Tool Registration (Simplified for E2E)
    registry.register('project_profile', async () => ({ fileCount: 100 }));
    registry.register('project_search', async (args) => {
        if (args.query?.includes('payment')) {
            return { results: [
                { path: 'src/backend/main.go', score: 0.9, type: 'file' },
                { path: 'docs/API.md', score: 0.8, type: 'file' }
            ] };
        }
        return { results: [] };
    });
    registry.register('file_list', async () => fixtures.map(f => ({ path: f.path, size: 100 })));
    registry.register('document_search', async () => ({ results: [] }));
    registry.register('document_skeleton', async () => ({ skeleton: '# Skeleton' }));
    registry.register('relationship_analyze', async () => ({ success: true, edges: [] }));
    registry.register('code_read', async (args) => {
        const content = fs.readFileSync(args.filePath, 'utf-8');
        if (args.view === 'skeleton') {
            const astManager = AstManager.getInstance();
            return await astManager.generateUniversalSkeleton(args.filePath, content);
        }
        return content;
    });
    registry.register('file_profile', async () => ({ structure: { symbols: [] } }));
    registry.register('document_analyze', async () => ({ skeleton: '', profile: {} }));

    const context = new OrchestrationContext();
    const explorePillar = new ExplorePillar(registry);
    const understandPillar = new UnderstandPillar(registry);

    // 1. Create a multi-language structure
    const fixtures = [
        { path: 'src/backend/main.go', content: 'package main\n\nimport "fmt"\n\nfunc ProcessPayment(amt float64) {\n  fmt.Println("Processing", amt)\n}' },
        { path: 'src/frontend/App.tsx', content: 'import React from "react";\nexport const App = () => <div>Payment App</div>;' },
        { path: 'docs/API.md', content: '# API Docs\nSee [Backend](src/backend/main.go) and [Frontend](src/frontend/App.tsx).\n#payment #api' }
    ];

    fixtures.forEach(f => {
        const dir = path.dirname(f.path);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(f.path, f.content);
    });

    try {
        // Test 1: Explore with query
        console.log("\n[Test 1] Exploring for 'payment'...");
        const exploreRes = await explorePillar.execute({
            intent: "explore",
            targets: [],
            constraints: { query: "payment", include: { code: true, docs: true } },
            originalIntent: "explore payment"
        }, context);
        console.log(`  Found ${exploreRes.data.code.length} code items and ${exploreRes.data.docs.length} docs.`);
        
        // Check if Go file was enriched with symbols
        const goItem = exploreRes.data.code.find(c => c.filePath.endsWith('.go'));
        if (goItem?.metadata?.symbols) {
            console.log(`  Go symbols found: ${goItem.metadata.symbols.join(', ')}`);
        }

        // Test 2: Understand Go file
        console.log("\n[Test 2] Understanding Go backend...");
        const understandRes = await understandPillar.execute({
            intent: "understand",
            targets: ["src/backend/main.go"],
            constraints: { depth: "standard" },
            originalIntent: "understand src/backend/main.go"
        }, context);
        console.log(`  Structure length: ${understandRes.structure.length} chars`);
        if (understandRes.structure.includes('{ ... }')) {
            console.log("  Skeleton folding applied correctly to Go.");
        }

        // Test 3: Markdown Navigation
        console.log("\n[Test 3] Analyzing Markdown with tags/mentions...");
        // Manual call to check enrichment in explore for docs
        const docItem = await explorePillar.execute({
            intent: "explore",
            targets: [],
            constraints: { paths: ["docs/API.md"], view: "preview" },
            originalIntent: "explore docs/API.md"
        }, context);
        
        const doc = docItem.data.docs[0];
        console.log(`  Doc Preview: ${doc.preview}`);
        // Note: Actual tag extraction happens in DocumentProfiler which is called via document_analyze or file_profile
        // But here we check if the pillar integrated the universal flow.

    } finally {
        // Cleanup
        fixtures.forEach(f => {
            if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
        });
        const dirs = ['src/backend', 'src/frontend', 'docs'];
        dirs.forEach(d => {
            if (fs.existsSync(d) && fs.readdirSync(d).length === 0) fs.rmdirSync(d);
        });
    }

    await astManager.dispose();
    console.log("\nE2E Test completed successfully.");
    process.exit(0);
}

runE2ETest().catch(err => {
    console.error(err);
    process.exit(1);
});
