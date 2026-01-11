import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import path from "path";
import { initAstManager, loadFixture } from "./helpers.js";
import { SyntaxValidator } from "../../engine/validators/syntax-validator.js";
import { AstManager } from "../../ast/AstManager.js";
import { getSupportForLanguageId, SupportLevel } from "../../config/LanguageSupportLevels.js";
import { checkSkeletonSupport } from "../../ast/LanguageSupportSignals.js";
import { buildDegradedReasons } from "../../orchestration/DegradedReasonMapper.js";

type ParitySpec = {
  languageId: string;
  fixture: string;
  syntaxError: string;
  extension: string;
};

const L3_LANGUAGES: ParitySpec[] = [
  { languageId: "typescript", fixture: "valid.ts", syntaxError: "syntax-error.ts", extension: ".ts" },
  { languageId: "python", fixture: "valid.py", syntaxError: "syntax-error.py", extension: ".py" },
  { languageId: "go", fixture: "valid.go", syntaxError: "syntax-error.go", extension: ".go" },
  { languageId: "rust", fixture: "valid.rs", syntaxError: "syntax-error.rs", extension: ".rs" },
  { languageId: "java", fixture: "valid.java", syntaxError: "syntax-error.java", extension: ".java" },
  { languageId: "php", fixture: "valid.php", syntaxError: "syntax-error.php", extension: ".php" }
];

const L2_LANGUAGES: Array<Omit<ParitySpec, "syntaxError">> = [
  { languageId: "markdown", fixture: "valid.md", extension: ".md" },
  { languageId: "c", fixture: "valid.c", extension: ".c" },
  { languageId: "cpp", fixture: "valid.cpp", extension: ".cpp" },
  { languageId: "c_sharp", fixture: "valid.cs", extension: ".cs" }
];

describe("Language parity (L3)", () => {
  let manager: AstManager;
  const validator = new SyntaxValidator();

  beforeAll(async () => {
    manager = await initAstManager();
  });

  afterAll(async () => {
    await AstManager.resetForTestingAsync();
  });

  for (const spec of L3_LANGUAGES) {
    it(`${spec.languageId} valid files produce skeleton`, async () => {
      const content = loadFixture(spec.languageId, spec.fixture);
      const samplePath = path.join("fixtures", `sample${spec.extension}`);
      const support = getSupportForLanguageId(spec.languageId);
      expect(support?.level).toBe(SupportLevel.L3);
      const skeleton = await manager.generateUniversalSkeleton(samplePath, content);
      expect(skeleton.length).toBeGreaterThan(0);
    });

    it(`${spec.languageId} syntax errors block validation`, async () => {
      const content = loadFixture(spec.languageId, spec.syntaxError);
      const samplePath = path.join("fixtures", `broken${spec.extension}`);
      const result = await validator.validate(samplePath, content);
      expect(result.success).toBe(false);
      expect(result.blockingErrors?.length ?? 0).toBeGreaterThan(0);
    });
  }
});

describe("Language parity (L2)", () => {
  let manager: AstManager;

  beforeAll(async () => {
    manager = await initAstManager();
  });

  afterAll(async () => {
    await AstManager.resetForTestingAsync();
  });

  for (const spec of L2_LANGUAGES) {
    it(`${spec.languageId} provides skeleton or degraded reasons`, async () => {
      const content = loadFixture(spec.languageId, spec.fixture);
      const samplePath = path.join("fixtures", `sample${spec.extension}`);
      const support = getSupportForLanguageId(spec.languageId);
      expect(support?.level).toBe(SupportLevel.L2);

      try {
        const skeleton = await manager.generateUniversalSkeleton(samplePath, content);
        expect(skeleton.length).toBeGreaterThan(0);
      } catch {
        const signal = await checkSkeletonSupport(samplePath);
        expect(signal.degraded).toBe(true);
        const degradedReasons = buildDegradedReasons(signal.reason ? [signal.reason] : undefined, {
          languageId: spec.languageId,
          filePath: samplePath
        });
        expect(degradedReasons?.length ?? 0).toBeGreaterThan(0);
      }
    });
  }
});
