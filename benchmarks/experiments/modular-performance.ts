import { performance } from 'perf_hooks';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SmartContextServer } from '../src/index.js';

async function runBenchmark() {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-'));
    fs.mkdirSync(path.join(testRoot, 'src'), { recursive: true });
    
    // Create 50 small files
    for (let i = 0; i < 50; i++) {
        fs.writeFileSync(
            path.join(testRoot, 'src', `file-${i}.ts`),
            `export function func${i}() { return ${i}; }`
        );
    }

    const server = new SmartContextServer(testRoot);
    
    console.log('--- Modular Architecture Performance Benchmark ---');

    // 1. Exploration Benchmark
    const startExplore = performance.now();
    await (server as any).handleCallTool('explore', { query: 'func' });
    const endExplore = performance.now();
    console.log(`Explore (LOD 1 Search): ${(endExplore - startExplore).toFixed(2)}ms`);

    // 2. Understanding Benchmark
    const startUnderstand = performance.now();
    await (server as any).handleCallTool('understand', { 
        goal: 'Analyze dependencies', 
        target: 'src/file-0.ts',
        include: { dependencies: true }
    });
    const endUnderstand = performance.now();
    console.log(`Understand (LOD 2 Analysis): ${(endUnderstand - startUnderstand).toFixed(2)}ms`);

    // 3. Batch Change Benchmark
    const startChange = performance.now();
    await (server as any).handleCallTool('change', {
        intent: 'Batch update',
        targetFiles: ['src/file-1.ts', 'src/file-2.ts'],
        edits: [
            { filePath: 'src/file-1.ts', targetString: 'return 1;', replacementString: 'return 10;' },
            { filePath: 'src/file-2.ts', targetString: 'return 2;', replacementString: 'return 20;' }
        ],
        options: { dryRun: false, batchMode: true }
    });
    const endChange = performance.now();
    console.log(`Batch Change (Multi-file Execution): ${(endChange - startChange).toFixed(2)}ms`);

    await server.shutdown();
    fs.rmSync(testRoot, { recursive: true, force: true });
}

runBenchmark().catch(console.error);
