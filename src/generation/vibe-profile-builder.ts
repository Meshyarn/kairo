import path from "path";
import { NodeFileSystem, type IFileSystem } from "../platform/FileSystem.js";
import { StyleInference } from "./StyleInference.js";
import { PatternExtractor, type ProjectPatterns } from "./PatternExtractor.js";
import { extractClaimsFromText } from "../integrity/ClaimExtractor.js";
import { normalizePath, toRelativePath } from "../utils/PathHelpers.js";
import type {
    CodeStyle,
    NormClaim,
    PatternSet,
    StylePack,
    StylePackConfigDetection,
    StylePackReference,
    VibeProfile
} from "../types/flow-artifacts.js";

export interface VibeProfileBuilderOptions {
    sampleSize?: number;
    includeNorms?: boolean;
    scopeGlob?: string;
    languages?: string[];
}

export class VibeProfileBuilder {
    private readonly styleInference: StyleInference;
    private readonly patternExtractor: PatternExtractor;
    private readonly fileSystem: IFileSystem;
    private readonly rootPath: string;

    constructor(
        fileSystem: IFileSystem,
        rootPath: string,
        private readonly options: VibeProfileBuilderOptions = {}
    ) {
        this.fileSystem = fileSystem;
        this.rootPath = rootPath;
        this.styleInference = new StyleInference(fileSystem, rootPath);
        this.patternExtractor = new PatternExtractor(fileSystem, rootPath);
    }

    static create(rootPath: string, options?: VibeProfileBuilderOptions): VibeProfileBuilder {
        return new VibeProfileBuilder(new NodeFileSystem(rootPath), rootPath, options);
    }

    public async build(targetPath?: string): Promise<StylePack> {
        const scope = this.options.scopeGlob ?? "**/*";
        const targetExtension = targetPath ? path.extname(targetPath) : ".ts";

        const styleResult = await this.styleInference.inferStyle(targetExtension);
        const { confidence: styleConfidence, ...codeStyle } = styleResult;

        const sampleFiles = await this.collectSampleFiles(scope, this.options.sampleSize ?? 20);
        const references = await this.buildReferences(sampleFiles);
        const configDetections = await this.detectConfigDetections();
        const extracted = await this.patternExtractor.extractPatterns(sampleFiles);
        const patterns = this.normalizePatterns(extracted);

        const norms = this.options.includeNorms !== false
            ? await this.extractNorms(scope)
            : undefined;

        const packConfidence = this.computePackConfidence(styleConfidence, references, configDetections);
        const confidence = this.computeProfileConfidence(packConfidence);

        return {
            id: this.generatePackId(),
            profile: {
                codeStyle: codeStyle as CodeStyle,
                patterns,
                norms,
                confidence
            },
            scope,
            createdAt: Date.now(),
            expiresAt: Date.now() + 30 * 60 * 1000,
            references,
            configDetections,
            confidence: packConfidence
        };
    }

    private async collectSampleFiles(scope: string, limit: number): Promise<string[]> {
        const allFiles = await this.fileSystem.listFiles(".");
        const normalizedScope = normalizePath(scope ?? "**/*");
        const matcher = buildScopeMatcher(normalizedScope);
        const candidates = allFiles.filter((filePath) => {
            const relative = normalizePath(toRelativePath(this.rootPath, filePath));
            if (matcher && !matcher.test(relative)) return false;
            if (isIgnoredPath(relative)) return false;
            const ext = path.extname(relative).toLowerCase();
            return [".ts", ".tsx", ".js", ".jsx"].includes(ext);
        });

        return candidates.slice(0, Math.max(1, limit));
    }

    private normalizePatterns(extracted: ProjectPatterns): PatternSet {
        return {
            imports: extracted.imports.map((pattern) => ({
                module: pattern.module,
                style: pattern.style,
                count: pattern.count,
                example: pattern.namedImports?.[0]
            })),
            naming: extracted.naming.map((pattern) => ({
                type: mapNamingType(pattern.type),
                convention: mapNamingConvention(pattern.convention),
                confidence: pattern.confidence,
                examples: pattern.samples
            })),
            fileOrg: {
                fileNamePattern: extracted.fileOrg.fileNamePattern,
                directoryPattern: extracted.fileOrg.directoryPattern,
                testPattern: extracted.fileOrg.testPattern
            },
            exports: extracted.exports.map((pattern) => ({
                style: pattern.style,
                exportedNames: pattern.exportedNames,
                count: pattern.count
            })),
            affixes: extracted.affixes
        };
    }

    private async extractNorms(scope: string): Promise<NormClaim[] | undefined> {
        const normalizedScope = normalizePath(scope ?? "**/*");
        const matcher = buildScopeMatcher(normalizedScope);
        const allFiles = await this.fileSystem.listFiles(".");
        const normFiles = allFiles.filter((filePath) => {
            const relative = normalizePath(toRelativePath(this.rootPath, filePath));
            if (matcher && !matcher.test(relative)) return false;
            if (isIgnoredPath(relative)) return false;
            const base = path.basename(relative).toLowerCase();
            if (base === "readme.md" || base === "contributing.md") return true;
            if (relative.startsWith("docs/adr/") || relative.includes("/docs/adr/")) return true;
            return false;
        });
        if (normFiles.length === 0) return undefined;

        const norms: NormClaim[] = [];
        for (const filePath of normFiles) {
            let content = "";
            try {
                content = await this.fileSystem.readFile(filePath);
            } catch {
                continue;
            }
            const relative = normalizePath(toRelativePath(this.rootPath, filePath));
            const sourceType = resolveNormSourceType(relative);
            const evidenceRef = {
                packId: "stylepack",
                itemId: `${relative}:0`,
                filePath: relative
            };
            const claims = extractClaimsFromText({
                text: content,
                filePath: relative,
                sectionTitle: undefined,
                sourceType: "docs",
                evidenceRef
            });
            for (const claim of claims) {
                norms.push({
                    claim: claim.text,
                    source: relative,
                    sourceType,
                    confidence: strengthToConfidence(claim.strength),
                    keywords: claim.tags
                });
            }
        }

        return norms.length > 0 ? norms : undefined;
    }

    private computeProfileConfidence(confidence: number): VibeProfile["confidence"] {
        if (confidence >= 0.85) return "high";
        if (confidence >= 0.6) return "medium";
        return "low";
    }

    private computePackConfidence(
        styleConfidence: number,
        references: StylePackReference[],
        configDetections: StylePackConfigDetection[]
    ): number {
        const uniqueRefs = new Set(references.map(ref => ref.filePath));
        const hasConfig = configDetections.length > 0;
        const hasReferences = references.length >= 3 && uniqueRefs.size >= 2;
        if (!hasConfig && !hasReferences) {
            return Math.min(styleConfidence, 0.4);
        }
        return Math.max(styleConfidence, 0.7);
    }

    private async buildReferences(sampleFiles: string[]): Promise<StylePackReference[]> {
        const refs: StylePackReference[] = [];
        for (const filePath of sampleFiles) {
            try {
                const content = await this.fileSystem.readFile(filePath);
                const lineCount = content.split(/\r?\n/).length;
                const relative = normalizePath(toRelativePath(this.rootPath, filePath));
                refs.push({
                    filePath: relative,
                    lineStart: 1,
                    lineEnd: Math.max(1, Math.min(10, lineCount)),
                    reason: "sample"
                });
            } catch {
                continue;
            }
        }
        return refs;
    }

    private async detectConfigDetections(): Promise<StylePackConfigDetection[]> {
        const detections: StylePackConfigDetection[] = [];
        const configGroups: Array<{ kind: string; files: string[] }> = [
            {
                kind: "prettier",
                files: [
                    ".prettierrc",
                    ".prettierrc.json",
                    ".prettierrc.js",
                    ".prettierrc.cjs",
                    ".prettierrc.yml",
                    ".prettierrc.yaml",
                    "prettier.config.js",
                    "prettier.config.cjs",
                    "prettier.config.mjs"
                ]
            },
            {
                kind: "eslint",
                files: [
                    ".eslintrc",
                    ".eslintrc.json",
                    ".eslintrc.js",
                    ".eslintrc.cjs",
                    ".eslintrc.yml",
                    ".eslintrc.yaml",
                    "eslint.config.js",
                    "eslint.config.mjs",
                    "eslint.config.cjs"
                ]
            },
            {
                kind: "biome",
                files: [
                    "biome.json",
                    "biome.jsonc"
                ]
            },
            {
                kind: "rustfmt",
                files: [
                    "rustfmt.toml"
                ]
            }
        ];
        for (const group of configGroups) {
            for (const file of group.files) {
                if (await this.fileSystem.exists(file)) {
                    detections.push({
                        kind: group.kind,
                        path: normalizePath(file),
                        scope: "repoRoot"
                    });
                }
            }
        }
        return detections;
    }

    private generatePackId(): string {
        const suffix = Math.random().toString(36).slice(2, 8);
        return `style_${Date.now().toString(36)}_${suffix}`;
    }
}

function strengthToConfidence(strength: "must" | "should" | "info"): number {
    if (strength === "must") return 0.9;
    if (strength === "should") return 0.7;
    return 0.5;
}

function resolveNormSourceType(relative: string): NormClaim["sourceType"] {
    const normalized = normalizePath(relative);
    const base = path.basename(normalized).toLowerCase();
    if (normalized.startsWith("docs/adr/") || normalized.includes("/docs/adr/")) return "adr";
    if (base === "readme.md") return "readme";
    if (base === "contributing.md") return "contributing";
    return "comment";
}

function isIgnoredPath(relative: string): boolean {
    const normalized = normalizePath(relative);
    return normalized.includes("/.kairo/")
        || normalized.startsWith(".kairo/")
        || normalized.includes("/.mcp/")
        || normalized.startsWith(".mcp/")
        || normalized.includes("/node_modules/")
        || normalized.startsWith("node_modules/")
        || normalized.includes("/dist/")
        || normalized.startsWith("dist/")
        || normalized.includes("/coverage/")
        || normalized.startsWith("coverage/");
}

function globToRegex(pattern: string): RegExp {
    const escaped = pattern
        .replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&")
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^/]*");
    return new RegExp(`^${escaped}$`);
}

function mapNamingType(type: ProjectPatterns["naming"][number]["type"]): PatternSet["naming"][number]["type"] {
    if (type === "class") return "class";
    if (type === "function") return "function";
    if (type === "variable") return "variable";
    if (type === "constant") return "constant";
    return "class";
}

function mapNamingConvention(
    convention: ProjectPatterns["naming"][number]["convention"]
): PatternSet["naming"][number]["convention"] {
    if (convention === "UPPER_CASE") return "SCREAMING_SNAKE";
    return convention;
}

function buildScopeMatcher(scope: string): RegExp | undefined {
    if (scope === "**/*" || scope === "**") {
        return undefined;
    }
    return globToRegex(scope);
}
