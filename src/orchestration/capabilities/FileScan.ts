import type { FileSearchResult, ResourceBudget, ResourceUsage } from "../../types.js";
import type { IFileSystem } from "../../platform/FileSystem.js";

export type FileScanRequest = {
    fileSystem: IFileSystem;
    rootPath: string;
    basePath?: string;
    includeRegexes?: RegExp[];
    excludeRegexes: RegExp[];
    regexes: RegExp[];
    keywordRegexes: RegExp[];
    patternRegexes: RegExp[];
    keywords: string[];
    previewLength: number;
    matchesPerFileLimit: number;
    maxResults: number;
    fileTypes?: string[];
    budget?: ResourceBudget;
    usage?: ResourceUsage;
    startedAt: number;
    reason: string;
    normalizeRelativePath: (filePath: string, basePath: string) => string | null;
    shouldInclude: (relativePath: string, includeRegexes?: RegExp[], excludeRegexes?: RegExp[]) => boolean;
};

export interface IFileScanProvider {
    scanForMatches(request: FileScanRequest): Promise<FileSearchResult[]>;
}
