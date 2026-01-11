import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { AstManager } from "../../ast/AstManager.js";
import { TreeSitterBackend } from "../../ast/extraction/backends/TreeSitterBackend.js";
import { TreeSitterSyntaxProvider } from "../../orchestration/capabilities/providers/TreeSitterSyntaxProvider.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesRoot = path.join(__dirname, "fixtures");

export type ExpectedSpec = {
  imports?: string[];
  exports?: string[];
  symbols?: string[];
  skeletonIncludes?: string[];
};

export function loadFixture(language: string, fileName: string): string {
  const fullPath = path.join(fixturesRoot, language, fileName);
  return fs.readFileSync(fullPath, "utf-8");
}

export function loadExpected(language: string): ExpectedSpec {
  const fullPath = path.join(fixturesRoot, language, "expected.json");
  return JSON.parse(fs.readFileSync(fullPath, "utf-8")) as ExpectedSpec;
}

export async function initAstManager(): Promise<AstManager> {
  AstManager.resetForTesting();
  const manager = AstManager.getInstance();
  await manager.init({ mode: "test", parserBackend: "wasm" });
  return manager;
}

export async function createBackend(manager: AstManager): Promise<TreeSitterBackend> {
  return new TreeSitterBackend(manager.getQueryProvider());
}

export async function validateSyntax(filePath: string, content: string) {
  const provider = new TreeSitterSyntaxProvider();
  return provider.get().validate(filePath, content);
}
