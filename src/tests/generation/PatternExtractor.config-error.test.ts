import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { PatternExtractor } from "../../generation/PatternExtractor.js";
import type { IFileSystem } from "../../platform/FileSystem.js";
import { createPatternExtractorFixture } from "./PatternExtractorTestUtils.js";

describe("PatternExtractor config and errors", () => {
  let mockFileSystem: IFileSystem;
  let extractor: ReturnType<typeof createPatternExtractorFixture>["extractor"];

  beforeEach(() => {
    ({ mockFileSystem, extractor } = createPatternExtractorFixture());
  });

  describe("Configuration", () => {
    it("should respect maxFiles configuration", async () => {
      const customExtractor = new PatternExtractor(mockFileSystem, "/test/root", {
        maxFiles: 2,
      });

      (mockFileSystem.readFile as jest.Mock<() => Promise<string>>).mockResolvedValue("");

      const files = ["/test/1.ts", "/test/2.ts", "/test/3.ts", "/test/4.ts"];
      await customExtractor.extractPatterns(files);

      expect(mockFileSystem.readFile).toHaveBeenCalledTimes(2);
    });

    it("should respect minFrequency configuration", async () => {
      const customExtractor = new PatternExtractor(mockFileSystem, "/test/root", {
        minFrequency: 3,
      });

      const fileContent = `
import { twice } from 'moduleA';
import { twice } from 'moduleA';
import { thrice } from 'moduleB';
import { thrice } from 'moduleB';
import { thrice } from 'moduleB';
      `;

      (mockFileSystem.readFile as jest.Mock<() => Promise<string>>).mockResolvedValue(fileContent);

      const patterns = await customExtractor.extractPatterns(["/test/file1.ts"]);

      expect(patterns.imports).toHaveLength(1);
      expect(patterns.imports[0].module).toBe("moduleB");
    });

    it("should return configuration via getConfig", () => {
      const config = extractor.getConfig();

      expect(config.maxFiles).toBe(50);
      expect(config.extensions).toEqual([".ts", ".tsx", ".js", ".jsx"]);
      expect(config.minFrequency).toBe(2);
    });
  });

  describe("Error Handling", () => {
    it("should skip files that cannot be read", async () => {
      (mockFileSystem.readFile as jest.Mock<() => Promise<string>>)
        .mockResolvedValueOnce('import { foo } from "moduleA";\nimport { foo } from "moduleA";')
        .mockRejectedValueOnce(new Error("File not found"))
        .mockResolvedValueOnce('import { bar } from "moduleB";\nimport { bar } from "moduleB";');

      const patterns = await extractor.extractPatterns([
        "/test/file1.ts",
        "/test/file2.ts",
        "/test/file3.ts",
      ]);

      expect(patterns.imports.length).toBeGreaterThan(0);
    });
  });
});
