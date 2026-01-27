import { performance } from 'perf_hooks';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AstManager } from '../src/ast/AstManager.js';
import { FeatureFlags } from '../src/config/FeatureFlags.js';
import type { LOD_LEVEL } from '../src/types.js';

interface StageResult {
    name: string;
    requestedLOD: LOD_LEVEL;
    files: number;
    totalMs: number;
    avgMs: number;
}

async function runStage(manager: AstManager, name: string, files: string[], requestedLOD: LOD_LEVEL): Promise<StageResult> {
    const start = performance.now();
    for (const file of files) {
        await manager.ensureLOD({ path: file, minLOD: requestedLOD });
    }
    const totalMs = performance.now() - start;
    return {
        name,
        requestedLOD,
        files: files.length,
        totalMs,
        avgMs: totalMs / Math.max(1, files.length)
    };
}

function writeReport(results: StageResult[], promotionStats: ReturnType<AstManager['promotionStats']>): void {
    const reportDir = path.join(process.cwd(), 'benchmarks', 'reports');
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, `lod-promotion-flow-${Date.now()}.md`);

    const lines: string[] = [];
    lines.push('# LOD Promotion Flow Benchmark');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('| Stage | LOD | Files | Total (ms) | Avg/File (ms) |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const result of results) {
        lines.push(`| ${result.name} | ${result.requestedLOD} | ${result.files} | ${result.totalMs.toFixed(2)} | ${result.avgMs.toFixed(2)} |`);
    }
    lines.push('');
    lines.push('## Promotion Stats');
    lines.push(`- l0→l1: ${promotionStats.l0_to_l1}`);
    lines.push(`- l1→l2: ${promotionStats.l1_to_l2}`);
    lines.push(`- l2→l3: ${promotionStats.l2_to_l3}`);
    lines.push(`- avg l0→l1 ms: ${promotionStats.avg_promotion_time_ms.l0_to_l1.toFixed(2)}`);
    lines.push(`- avg l1→l2 ms: ${promotionStats.avg_promotion_time_ms.l1_to_l2.toFixed(2)}`);
    lines.push(`- avg l2→l3 ms: ${promotionStats.avg_promotion_time_ms.l2_to_l3.toFixed(2)}`);
    lines.push(`- total files tracked: ${promotionStats.total_files}`);

    fs.writeFileSync(reportPath, lines.join('\n'), 'utf-8');
    console.log(lines.join('\n'));
    console.log(`\nReport saved to ${reportPath}`);
}

async function run(): Promise<void> {
    FeatureFlags.set(FeatureFlags.ADAPTIVE_FLOW_ENABLED, true);
    FeatureFlags.set(FeatureFlags.UCG_ENABLED, true);
    FeatureFlags.set(FeatureFlags.TOPOLOGY_SCANNER_ENABLED, true);

    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-flow-'));
    const srcDir = path.join(testRoot, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    const files: string[] = [];
    for (let i = 0; i < 12; i += 1) {
        const filePath = path.join(srcDir, `file-${i}.ts`);
        fs.writeFileSync(filePath, `export const value${i} = ${i};\nexport function fn${i}() { return value${i}; }\n`);
        files.push(filePath);
    }

    await AstManager.resetForTestingAsync();
    const manager = AstManager.getInstance();
    await manager.init({ mode: 'test', parserBackend: 'wasm', rootPath: testRoot });

    const results: StageResult[] = [];
    results.push(await runStage(manager, 'Explore (LOD 1)', files, 1));
    results.push(await runStage(manager, 'Understand (LOD 2)', files.slice(0, 6), 2));
    results.push(await runStage(manager, 'Change (LOD 3)', files.slice(0, 3), 3));

    writeReport(results, manager.promotionStats());

    await AstManager.resetForTestingAsync();
    fs.rmSync(testRoot, { recursive: true, force: true });
}

run().catch((error) => {
    console.error('Benchmark failed:', error);
    process.exit(1);
});
