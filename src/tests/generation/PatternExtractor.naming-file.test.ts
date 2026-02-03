import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { IFileSystem } from "../../platform/FileSystem.js";
import { createPatternExtractorFixture } from "./PatternExtractorTestUtils.js";

describe("PatternExtractor naming and file patterns", () => {
  let mockFileSystem: IFileSystem;
  let extractor: ReturnType<typeof createPatternExtractorFixture>["extractor"];

  beforeEach(() => {
    ({ mockFileSystem, extractor } = createPatternExtractorFixture());
  });

  describe("Naming Convention Detection", () => {
    it("should detect camelCase for function names", async () => {
      const fileContent = `
function myFunction() {}
function anotherFunction() {}
function thirdFunction() {}
      `;

      (mockFileSystem.readFile as jest.Mock<() => Promise<string>>).mockResolvedValue(fileContent);

      const patterns = await extractor.extractPatterns(["/test/file1.ts"]);

      const funcPattern = patterns.naming.find(p => p.type === "function");
      expect(funcPattern).toBeDefined();
      expect(funcPattern?.convention).toBe("camelCase");
      expect(funcPattern?.confidence).toBeGreaterThan(0.9);
    });

    it("should detect PascalCase for class names", async () => {
      const fileContent = `
class MyClass {}
class AnotherClass {}
class ThirdClass {}
      `;

      (mockFileSystem.readFile as jest.Mock<() => Promise<string>>).mockResolvedValue(fileContent);

      const patterns = await extractor.extractPatterns(["/test/file1.ts"]);

      const classPattern = patterns.naming.find(p => p.type === "class");
      expect(classPattern).toBeDefined();
      expect(classPattern?.convention).toBe("PascalCase");
      expect(classPattern?.confidence).toBeGreaterThan(0.9);
    });

    it("should detect PascalCase for interface names", async () => {
      const fileContent = `
interface MyInterface {}
interface AnotherInterface {}
interface ThirdInterface {}
      `;

      (mockFileSystem.readFile as jest.Mock<() => Promise<string>>).mockResolvedValue(fileContent);

      const patterns = await extractor.extractPatterns(["/test/file1.ts"]);

      const interfacePattern = patterns.naming.find(p => p.type === "interface");
      expect(interfacePattern).toBeDefined();
      expect(interfacePattern?.convention).toBe("PascalCase");
      expect(interfacePattern?.confidence).toBeGreaterThan(0.9);
    });

    it("should detect UPPER_CASE for constants", async () => {
      const fileContent = `
const MY_CONSTANT = 1;
const ANOTHER_CONSTANT = 2;
const THIRD_CONSTANT = 3;
      `;

      (mockFileSystem.readFile as jest.Mock<() => Promise<string>>).mockResolvedValue(fileContent);

      const patterns = await extractor.extractPatterns(["/test/file1.ts"]);

      const constantPattern = patterns.naming.find(p => p.type === "constant");
      expect(constantPattern).toBeDefined();
      expect(constantPattern?.convention).toBe("UPPER_CASE");
      expect(constantPattern?.confidence).toBeGreaterThan(0.9);
    });

    it("should detect camelCase for variables", async () => {
      const fileContent = `
const myVariable = 1;
let anotherVariable = 2;
const thirdVariable = 3;
      `;

      (mockFileSystem.readFile as jest.Mock<() => Promise<string>>).mockResolvedValue(fileContent);

      const patterns = await extractor.extractPatterns(["/test/file1.ts"]);

      const varPattern = patterns.naming.find(p => p.type === "variable");
      expect(varPattern).toBeDefined();
      expect(varPattern?.convention).toBe("camelCase");
    });

    it("should include sample names", async () => {
      const fileContent = `
function sampleOne() {}
function sampleTwo() {}
function sampleThree() {}
      `;

      (mockFileSystem.readFile as jest.Mock<() => Promise<string>>).mockResolvedValue(fileContent);

      const patterns = await extractor.extractPatterns(["/test/file1.ts"]);

      const funcPattern = patterns.naming.find(p => p.type === "function");
      expect(funcPattern?.samples).toBeDefined();
      expect(funcPattern?.samples.length).toBeGreaterThan(0);
      expect(funcPattern?.samples).toContain("sampleOne");
    });
  });

  describe("File Pattern Extraction", () => {
    it("should detect index file pattern", async () => {
      (mockFileSystem.readFile as jest.Mock<() => Promise<string>>).mockResolvedValue("");

      const patterns = await extractor.extractPatterns([
        "/test/src/index.ts",
        "/test/src/components/index.ts",
        "/test/src/utils/index.ts",
      ]);

      expect(patterns.fileOrg.fileNamePattern).toBe("index.*");
    });

    it("should detect test file pattern with .test suffix", async () => {
      (mockFileSystem.readFile as jest.Mock<() => Promise<string>>).mockResolvedValue("");

      const patterns = await extractor.extractPatterns([
        "/test/src/foo.test.ts",
        "/test/src/bar.test.ts",
      ]);

      expect(patterns.fileOrg.testPattern).toBe("*.test.ts");
    });

    it("should detect test file pattern with tests directory", async () => {
      (mockFileSystem.readFile as jest.Mock<() => Promise<string>>).mockResolvedValue("");

      const patterns = await extractor.extractPatterns([
        "/test/src/tests/foo.ts",
        "/test/src/tests/bar.ts",
      ]);

      expect(patterns.fileOrg.testPattern).toBe("tests/*.ts");
    });

    it("should find common directory pattern", async () => {
      (mockFileSystem.readFile as jest.Mock<() => Promise<string>>).mockResolvedValue("");

      const patterns = await extractor.extractPatterns([
        "/test/src/components/A.ts",
        "/test/src/components/B.ts",
        "/test/src/utils/C.ts",
      ]);

      expect(patterns.fileOrg.directoryPattern).toContain("src");
    });
  });

  describe("Prefix and Suffix Extraction", () => {
    it("should extract common prefixes", async () => {
      const fileContent = `
function getUserData() {}
function getUserId() {}
function getUserName() {}
class UserService {}
class UserRepository {}
      `;

      (mockFileSystem.readFile as jest.Mock<() => Promise<string>>).mockResolvedValue(fileContent);

      const patterns = await extractor.extractPatterns(["/test/file1.ts"]);

      expect(patterns.affixes.prefixes.length).toBeGreaterThan(0);
    });

    it("should extract common suffixes", async () => {
      const fileContent = `
class UserService {}
class DataService {}
class AuthService {}
class OrderService {}
interface UserRepository {}
interface DataRepository {}
      `;

      (mockFileSystem.readFile as jest.Mock<() => Promise<string>>).mockResolvedValue(fileContent);

      const patterns = await extractor.extractPatterns(["/test/file1.ts"]);

      expect(patterns.affixes.suffixes.length).toBeGreaterThan(0);
      expect(patterns.affixes.suffixes).toContain("Service");
    });

    it("should filter affixes by minimum frequency", async () => {
      const fileContent = `
class OnceService {}
class TwiceHelper {}
class TwiceHelper {}
      `;

      (mockFileSystem.readFile as jest.Mock<() => Promise<string>>).mockResolvedValue(fileContent);

      const patterns = await extractor.extractPatterns(["/test/file1.ts"]);

      expect(patterns.affixes.suffixes).not.toContain("Service");
    });
  });
});
