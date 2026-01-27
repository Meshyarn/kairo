import { promises as fs } from "fs";
import path from "path";
import { performance } from "perf_hooks";
import { SyntaxValidator } from "../src/engine/validators/syntax-validator.js";
import { SemanticValidator } from "../src/engine/validators/semantic-validator.js";

type BenchmarkResult = {
  name: string;
  lines: number;
  bytes: number;
  syntaxAvg: number;
  semanticAvg: number;
  totalAvg: number;
  totalP95: number;
  totalP99: number;
};

const FIXTURES = [
  "benchmarks/test-fixtures/sample-service.ts",
  "benchmarks/test-fixtures/ambiguous-matches.ts",
  "benchmarks/test-fixtures/large-file.ts"
];

async function benchmarkFile(
  validator: SyntaxValidator,
  semanticValidator: SemanticValidator,
  filePath: string,
  iterations: number
): Promise<BenchmarkResult> {
  const content = await fs.readFile(filePath, "utf-8");
  const lines = content.split(/\r?\n/).length;
  const bytes = Buffer.byteLength(content);

  const syntaxTimings: number[] = [];
  const semanticTimings: number[] = [];
  const totalTimings: number[] = [];

  for (let i = 0; i < iterations; i += 1) {
    let start = performance.now();
    await validator.validate(filePath, content);
    const syntaxDuration = performance.now() - start;
    syntaxTimings.push(syntaxDuration);

    start = performance.now();
    await semanticValidator.validate(filePath, content);
    const semanticDuration = performance.now() - start;
    semanticTimings.push(semanticDuration);
    totalTimings.push(syntaxDuration + semanticDuration);
  }

  const syntaxAvg = syntaxTimings.reduce((sum, value) => sum + value, 0) / iterations;
  const semanticAvg = semanticTimings.reduce((sum, value) => sum + value, 0) / iterations;
  totalTimings.sort((a, b) => a - b);
  const totalP95 = totalTimings[Math.floor(iterations * 0.95)] ?? totalTimings[totalTimings.length - 1] ?? 0;
  const totalP99 = totalTimings[Math.floor(iterations * 0.99)] ?? totalTimings[totalTimings.length - 1] ?? 0;

  return {
    name: path.basename(filePath),
    lines,
    bytes,
    syntaxAvg,
    semanticAvg,
    totalAvg: syntaxAvg + semanticAvg,
    totalP95,
    totalP99
  };
}

function renderReport(results: BenchmarkResult[]): string {
  const rows = results
    .map((result) => {
      return `| ${result.name} | ${result.lines} | ${result.bytes} | ${result.syntaxAvg.toFixed(2)} | ${result.semanticAvg.toFixed(2)} | ${result.totalAvg.toFixed(2)} | ${result.totalP95.toFixed(2)} | ${result.totalP99.toFixed(2)} |`;
    })
    .join("\n");

  return [
    "# Semantic Validation Benchmark",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "| File | Lines | Bytes | Syntax Avg (ms) | Semantic Avg (ms) | Total Avg (ms) | Total P95 (ms) | Total P99 (ms) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    rows,
    ""
  ].join("\n");
}

async function main() {
  const iterations = Number.parseInt(process.env.VALIDATION_BENCH_ITERS ?? "20", 10);
  const syntaxValidator = new SyntaxValidator();
  const semanticValidator = new SemanticValidator({ rootPath: process.cwd() });

  const results: BenchmarkResult[] = [];
  for (const fixture of FIXTURES) {
    results.push(await benchmarkFile(syntaxValidator, semanticValidator, fixture, iterations));
  }

  const report = renderReport(results);
  const reportDir = path.join("benchmarks", "reports");
  await fs.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `semantic-validation-${Date.now()}.md`);
  await fs.writeFile(reportPath, report, "utf-8");
  console.log(report);
  console.log(`\nSaved report to ${reportPath}`);
  process.exit(0);
}

main().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
