import * as fs from "fs";
import { PathManager } from "../utils/PathManager.js";

export interface LanguageMapping {
    languageId: string;
    parserBackend: "web-tree-sitter" | "ts-compiler";
    wasmPath?: string;
    queryPacks?: {
        imports?: string;
        exports?: string;
        symbols?: string;
        skeleton?: string;
    };
    fallbackStrategy?: "regex" | "heuristic" | "none";
}

export interface LanguageConfig {
    version: number;
    mappings: Record<string, LanguageMapping>;
}

const buildQueryPacks = (languageId: string) => ({
    imports: `queries/${languageId}/imports.scm`,
    exports: `queries/${languageId}/exports.scm`,
    symbols: `queries/${languageId}/symbols.scm`,
    skeleton: `queries/${languageId}/skeleton.scm`
});

export const BUILTIN_LANGUAGE_MAPPINGS: Record<string, LanguageMapping> = {
    ".ts": { languageId: "typescript", parserBackend: "web-tree-sitter", queryPacks: buildQueryPacks("typescript") },
    ".mts": { languageId: "typescript", parserBackend: "web-tree-sitter", queryPacks: buildQueryPacks("typescript") },
    ".cts": { languageId: "typescript", parserBackend: "web-tree-sitter", queryPacks: buildQueryPacks("typescript") },
    ".tsx": { languageId: "tsx", parserBackend: "web-tree-sitter", queryPacks: buildQueryPacks("typescript") },
    ".js": { languageId: "tsx", parserBackend: "web-tree-sitter", queryPacks: buildQueryPacks("typescript") },
    ".jsx": { languageId: "tsx", parserBackend: "web-tree-sitter", queryPacks: buildQueryPacks("typescript") },
    ".mjs": { languageId: "tsx", parserBackend: "web-tree-sitter", queryPacks: buildQueryPacks("typescript") },
    ".cjs": { languageId: "tsx", parserBackend: "web-tree-sitter", queryPacks: buildQueryPacks("typescript") },
    ".py": { languageId: "python", parserBackend: "web-tree-sitter", queryPacks: buildQueryPacks("python"), fallbackStrategy: "regex" },
    ".go": { languageId: "go", parserBackend: "web-tree-sitter", queryPacks: buildQueryPacks("go"), fallbackStrategy: "regex" },
    ".rs": { languageId: "rust", parserBackend: "web-tree-sitter", queryPacks: buildQueryPacks("rust"), fallbackStrategy: "regex" },
    ".java": { languageId: "java", parserBackend: "web-tree-sitter", queryPacks: buildQueryPacks("java") },
    ".c": { languageId: "c", parserBackend: "web-tree-sitter" },
    ".h": { languageId: "c", parserBackend: "web-tree-sitter" },
    ".cpp": { languageId: "cpp", parserBackend: "web-tree-sitter" },
    ".hpp": { languageId: "cpp", parserBackend: "web-tree-sitter" },
    ".cs": { languageId: "c_sharp", parserBackend: "web-tree-sitter" },
    ".sql": { languageId: "sql", parserBackend: "web-tree-sitter" },
    ".json": { languageId: "json", parserBackend: "web-tree-sitter" },
    ".yaml": { languageId: "yaml", parserBackend: "web-tree-sitter" },
    ".yml": { languageId: "yaml", parserBackend: "web-tree-sitter" },
    ".css": { languageId: "css", parserBackend: "web-tree-sitter" },
    ".scss": { languageId: "scss", parserBackend: "web-tree-sitter" },
    ".php": { languageId: "php", parserBackend: "web-tree-sitter", queryPacks: buildQueryPacks("php") },
    ".md": { languageId: "markdown", parserBackend: "web-tree-sitter", queryPacks: buildQueryPacks("markdown") }
};

export class LanguageConfigLoader {
    private config: LanguageConfig;
    private watcher?: fs.FSWatcher;
    private readonly configPath: string;

    constructor(private readonly rootPath: string) {
        this.configPath = this.resolveConfigPath();
        this.config = this.loadConfig();
    }

    public getLanguageMapping(ext: string): LanguageMapping | undefined {
        const normalized = ext.toLowerCase();
        return this.config.mappings[normalized] || BUILTIN_LANGUAGE_MAPPINGS[normalized];
    }

    public reload(): void {
        this.config = this.loadConfig();
    }

    public watch(onChange: () => void): void {
        if (this.watcher) return;
        
        if (fs.existsSync(this.configPath)) {
            this.watcher = fs.watch(this.configPath, { persistent: false }, (event) => {
                if (event === "change" || event === "rename") {
                    this.reload();
                    onChange();
                }
            });
        }
    }

    public dispose(): void {
        this.watcher?.close();
    }

    private resolveConfigPath(): string {
        const primary = PathManager.resolveForRoot(this.rootPath, "config", "languages.json");
        if (fs.existsSync(primary)) {
            return primary;
        }

        const legacy = PathManager.resolveForRoot(this.rootPath, "languages.json");
        if (fs.existsSync(legacy)) {
            return legacy;
        }

        return primary;
    }

    private loadConfig(): LanguageConfig {
        let userConfig: Partial<LanguageConfig> | undefined;
        try {
            if (fs.existsSync(this.configPath)) {
                const raw = fs.readFileSync(this.configPath, "utf-8");
                userConfig = JSON.parse(raw);
            }
        } catch (error) {
            console.warn(`[LanguageConfig] Failed to parse ${this.configPath}:`, error);
        }

        return {
            version: userConfig?.version || 1,
            mappings: {
                ...BUILTIN_LANGUAGE_MAPPINGS,
                ...(userConfig?.mappings || {})
            }
        };
    }
}
