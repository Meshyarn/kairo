import { jest } from "@jest/globals";
import { PatternExtractor } from "../../generation/PatternExtractor.js";
import type { IFileSystem } from "../../platform/FileSystem.js";

export const createPatternExtractorFixture = () => {
  const mockFileSystem: IFileSystem = {
    readFile: jest.fn<() => Promise<string>>(),
    writeFile: jest.fn<() => Promise<void>>(),
    deleteFile: jest.fn<() => Promise<void>>(),
    exists: jest.fn<() => Promise<boolean>>(),
    readDir: jest.fn<() => Promise<string[]>>(),
    stat: jest.fn<() => Promise<{ isDirectory: () => boolean }>>(),
  } as unknown as IFileSystem;

  const extractor = new PatternExtractor(mockFileSystem, "/test/root");
  return { mockFileSystem, extractor };
};
