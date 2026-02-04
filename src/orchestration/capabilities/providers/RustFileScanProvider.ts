import type { CapabilityProvider } from "../EngineManager.js";
import type { FileScanRequest, IFileScanProvider } from "../FileScan.js";
import type { FileSearchResult } from "../../../types.js";
import { NativeModuleLoader } from "../NativeModuleLoader.js";
import { FeatureFlags } from "../../../config/FeatureFlags.js";
import { metrics } from "../../../utils/MetricsCollector.js";

type NativeRegex = { source: string; flags: string };
type NativeFileScanRequest = {
    rootPath: string;
    basePath?: string;
    includeRegexes?: NativeRegex[];
    excludeRegexes: NativeRegex[];
    regexes: NativeRegex[];
    keywordRegexes: NativeRegex[];
    patternRegexes: NativeRegex[];
    keywords: string[];
    previewLength: number;
    matchesPerFileLimit: number;
    maxResults: number;
    fileTypes?: string[];
    budget?: FileScanRequest["budget"];
};

type NativeFileScanResult = {
    filePath?: string;
    path?: string;
    lineNumber?: number;
    preview?: string;
    score?: number;
    scoreDetails?: unknown;
    groupedMatches?: Array<{
        lineNumber: number;
        preview: string;
        score?: number;
        scoreDetails?: unknown;
    }>;
    matchCount?: number;
};

export class RustFileScanProvider implements CapabilityProvider<IFileScanProvider> {
    meta = { id: "RustFileScanProvider", tier: "native" as const, priority: 100 };

    isAvailable(): boolean {
        return this.resolveCore() !== null;
    }

    get(): IFileScanProvider {
        const core = this.resolveCore();
        if (!core?.fileScan) {
            throw new Error("Native file scan is unavailable.");
        }
        const nativeScan = core.fileScan;
        return {
            scanForMatches: async (args) => {
                if (args.usage) {
                    args.usage.degraded = true;
                    args.usage.reason = args.usage.reason ?? args.reason;
                }
                const stop = metrics.startTimer("search.scan.native_ms");
                try {
                    const request = this.buildNativeRequest(args);
                    const result = nativeScan(request) as NativeFileScanResult[] | undefined;
                    return this.normalizeResults(result ?? [], args).slice(0, args.maxResults);
                } finally {
                    stop();
                }
            }
        };
    }

    diagnose() {
        const enabled = FeatureFlags.isEnabled(FeatureFlags.RUST_FILE_SCAN_ENABLED, FeatureFlags.getContext());
        if (!enabled) {
            return { available: false, reason: "flag_disabled" };
        }
        const loader = NativeModuleLoader.getShared();
        const core = loader.getRustCore();
        if (!core) {
            const loadError = loader.getLoadError();
            return { available: false, reason: loadError ? `rust_core_unavailable: ${loadError.message}` : "rust_core_unavailable" };
        }
        if (typeof core.fileScan !== "function") {
            return { available: false, reason: "native_file_scan_missing" };
        }
        return { available: true };
    }

    private resolveCore(): { fileScan?: (args: NativeFileScanRequest) => NativeFileScanResult[] } | null {
        const enabled = FeatureFlags.isEnabled(FeatureFlags.RUST_FILE_SCAN_ENABLED, FeatureFlags.getContext());
        if (!enabled) return null;
        const core = NativeModuleLoader.getShared().getRustCore();
        if (!core || typeof core.fileScan !== "function") {
            return null;
        }
        return { fileScan: core.fileScan as (args: NativeFileScanRequest) => NativeFileScanResult[] };
    }

    private buildNativeRequest(args: FileScanRequest): NativeFileScanRequest {
        return {
            rootPath: args.rootPath,
            basePath: args.basePath,
            includeRegexes: args.includeRegexes?.map(this.serializeRegex),
            excludeRegexes: args.excludeRegexes.map(this.serializeRegex),
            regexes: args.regexes.map(this.serializeRegex),
            keywordRegexes: args.keywordRegexes.map(this.serializeRegex),
            patternRegexes: args.patternRegexes.map(this.serializeRegex),
            keywords: args.keywords,
            previewLength: args.previewLength,
            matchesPerFileLimit: args.matchesPerFileLimit,
            maxResults: args.maxResults,
            fileTypes: args.fileTypes,
            budget: args.budget
        };
    }

    private serializeRegex(regex: RegExp): NativeRegex {
        return { source: regex.source, flags: regex.flags };
    }

    private normalizeResults(results: NativeFileScanResult[], args: FileScanRequest) {
        const basePath = args.basePath ?? args.rootPath;
        return results
            .map((result) => {
                const pathValue = typeof result.filePath === "string"
                    ? result.filePath
                    : (typeof result.path === "string" ? result.path : "");
                const relative = pathValue ? args.normalizeRelativePath(pathValue, basePath) : null;
                if (!pathValue) return null;
                if (!relative) return null;
                return {
                    filePath: relative,
                    lineNumber: result.lineNumber ?? 1,
                    preview: result.preview ?? "",
                    score: result.score,
                    scoreDetails: result.scoreDetails as FileSearchResult["scoreDetails"],
                    groupedMatches: result.groupedMatches?.map((match) => ({
                        lineNumber: match.lineNumber,
                        preview: match.preview,
                        score: match.score,
                        scoreDetails: match.scoreDetails as FileSearchResult["scoreDetails"]
                    })),
                    matchCount: result.matchCount
                };
            })
            .filter((value): value is NonNullable<typeof value> => Boolean(value));
    }
}
