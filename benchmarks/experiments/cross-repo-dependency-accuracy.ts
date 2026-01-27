import { AstManager } from "../src/ast/AstManager.js";
import { ModuleResolver } from "../src/ast/ModuleResolver.js";
import { UnifiedExtractor } from "../src/ast/extraction/UnifiedExtractor.js";
import { toRelativePath } from "../src/utils/PathHelpers.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

interface AccuracyResult {
    file: string;
    expected: string[];
    actual: string[];
    correct: number;
    precision: number;
    recall: number;
}

const createTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "cross-repo-deps-"));

const writeFile = (filePath: string, content: string) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content.trim() + "\n", "utf8");
};

async function run(): Promise<void> {
    const root = createTempDir();
    const repoA = path.join(root, "repo-a");
    const repoB = path.join(root, "repo-b");
    const repoC = path.join(root, "repo-c");

    writeFile(
        path.join(repoA, "src", "index.ts"),
        `
import { util } from "../../repo-b/src/util";
import { api } from "../../repo-c/src/api";

export const main = () => util(api());
`
    );
    writeFile(
        path.join(repoB, "src", "util.ts"),
        `
import { api } from "../../repo-c/src/api";

export const util = (value: string) => value + api();
`
    );
    writeFile(
        path.join(repoC, "src", "api.ts"),
        `
export const api = () => "ok";
`
    );

    const astManager = AstManager.getInstance();
    await astManager.init();
    const resolver = new ModuleResolver(root);
    const extractor = new UnifiedExtractor(astManager.getQueryProvider(), { moduleResolver: resolver });
    const expectations: Array<{ file: string; deps: string[] }> = [
        {
            file: path.join("repo-a", "src", "index.ts"),
            deps: [path.join("repo-b", "src", "util.ts"), path.join("repo-c", "src", "api.ts")]
        },
        {
            file: path.join("repo-b", "src", "util.ts"),
            deps: [path.join("repo-c", "src", "api.ts")]
        }
    ];

    const results: AccuracyResult[] = [];
    for (const expectation of expectations) {
        const absPath = path.join(root, expectation.file);
        const content = fs.readFileSync(absPath, "utf8");
        const languageId = astManager.getLanguageId(absPath);
        const imports = await extractor.extractImports(absPath, content, languageId, { preferBackend: "regex" });
        const actual = imports
            .map(entry => entry.resolvedPath)
            .filter((target): target is string => Boolean(target))
            .map(target => toRelativePath(root, target));
        const expectedSet = new Set(expectation.deps);
        const actualSet = new Set(actual);
        const correct = [...expectedSet].filter(dep => actualSet.has(dep)).length;
        const precision = actualSet.size > 0 ? correct / actualSet.size : 1;
        const recall = expectedSet.size > 0 ? correct / expectedSet.size : 1;
        results.push({
            file: expectation.file,
            expected: expectation.deps,
            actual,
            correct,
            precision,
            recall
        });
    }

    const totalExpected = results.reduce((sum, result) => sum + result.expected.length, 0);
    const totalCorrect = results.reduce((sum, result) => sum + result.correct, 0);
    const totalActual = results.reduce((sum, result) => sum + result.actual.length, 0);
    const overallPrecision = totalActual > 0 ? totalCorrect / totalActual : 1;
    const overallRecall = totalExpected > 0 ? totalCorrect / totalExpected : 1;

    const reportLines = [
        "# Cross-Repo Dependency Accuracy",
        "",
        `Total expected edges: ${totalExpected}`,
        `Total actual edges: ${totalActual}`,
        `Correct edges: ${totalCorrect}`,
        "",
        "| File | Expected | Actual | Precision | Recall |",
        "| --- | --- | --- | --- | --- |",
        ...results.map(result => [
            `| ${result.file}`,
            result.expected.length,
            result.actual.length,
            `${(result.precision * 100).toFixed(2)}%`,
            `${(result.recall * 100).toFixed(2)}% |`
        ].join(" | ")),
        "",
        `Overall precision: ${(overallPrecision * 100).toFixed(2)}%`,
        `Overall recall: ${(overallRecall * 100).toFixed(2)}%`
    ];

    const reportDir = path.join(process.cwd(), "benchmarks", "reports");
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, `cross-repo-dependency-accuracy-${Date.now()}.md`);
    fs.writeFileSync(reportPath, reportLines.join("\n"), "utf8");

    console.log(reportLines.join("\n"));
    console.log(`\nReport saved to ${reportPath}`);

    fs.rmSync(root, { recursive: true, force: true });
    await astManager.dispose();
    process.exit(0);
}

run().catch(error => {
    console.error("Benchmark failed:", error);
    process.exit(1);
});
