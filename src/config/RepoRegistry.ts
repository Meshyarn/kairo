import * as fs from "fs";
import * as path from "path";
import { PathManager } from "../utils/PathManager.js";

export interface RepoConfig {
    id: string;
    path: string;
    name: string;
    type: "primary" | "linked" | "reference";
    languages: string[];
    excludePatterns?: string[];
    allowCrossRepoEdits?: boolean;
}

export interface MultiRepoConfig {
    version: string;
    repositories: Record<string, Omit<RepoConfig, "id">>;
    defaultRepo: string;
}

export class RepoRegistry {
    private repos: Map<string, RepoConfig> = new Map();
    private defaultRepoId = "default";
    private configPath: string;
    private watcher?: fs.FSWatcher;
    private readonly validRepoTypes = new Set(["primary", "linked", "reference"]);

    constructor(private readonly rootPath: string) {
        this.configPath = this.resolveConfigPath();
        this.loadConfig();
    }

    private resolveConfigPath(): string {
        const configDir = PathManager.getConfigDir();
        const primary = path.join(configDir, ".mcp-config.json");
        if (fs.existsSync(primary)) return primary;

        const legacyConfigDir = path.join(configDir, "mcp-config.json");
        if (fs.existsSync(legacyConfigDir)) return legacyConfigDir;

        const legacyRoot = path.join(this.rootPath, ".mcp-config.json");
        if (fs.existsSync(legacyRoot)) return legacyRoot;

        return primary;
    }

    private loadConfig(): void {
        let config: MultiRepoConfig | undefined;

        if (fs.existsSync(this.configPath)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(this.configPath, "utf-8"));
                const candidate = (parsed && typeof parsed === "object" && !Array.isArray(parsed) && (parsed as any).multiRepo && typeof (parsed as any).multiRepo === "object")
                    ? (parsed as any).multiRepo
                    : parsed;
                config = candidate as MultiRepoConfig;
            } catch (error) {
                console.warn(`[RepoRegistry] Failed to parse ${this.configPath}:`, error);
            }
        }

        const normalized = this.normalizeConfig(config);
        this.repos = normalized.repos;
        this.defaultRepoId = normalized.defaultRepoId;
    }

    private normalizeConfig(config: MultiRepoConfig | undefined): { repos: Map<string, RepoConfig>; defaultRepoId: string } {
        const repos = new Map<string, RepoConfig>();
        const fallback = {
            repos: new Map<string, RepoConfig>([
                ["default", {
                    id: "default",
                    path: path.resolve(this.rootPath, "."),
                    name: "Default Repository",
                    type: "primary",
                    languages: []
                }]
            ]),
            defaultRepoId: "default"
        };

        if (!config || !config.repositories || typeof config.repositories !== "object") {
            return fallback;
        }

        for (const [id, repoData] of Object.entries(config.repositories)) {
            const normalizedRepo = this.normalizeRepo(id, repoData);
            if (!normalizedRepo) {
                console.warn(`[RepoRegistry] Skipping invalid repo config: ${id}`);
                continue;
            }
            const absolutePath = path.isAbsolute(normalizedRepo.path)
                ? normalizedRepo.path
                : path.resolve(this.rootPath, normalizedRepo.path);
            repos.set(id, { ...normalizedRepo, id, path: absolutePath });
        }

        if (repos.size === 0) {
            return fallback;
        }

        const firstRepoId = repos.keys().next().value;
        const defaultRepoId = repos.has(config.defaultRepo)
            ? config.defaultRepo
            : (typeof firstRepoId === "string" ? firstRepoId : "default");
        return { repos, defaultRepoId };
    }

    private normalizeRepo(id: string, repoData: any): Omit<RepoConfig, "id"> | null {
        if (!repoData || typeof repoData.path !== "string") return null;
        const name = typeof repoData.name === "string" && repoData.name.length > 0 ? repoData.name : id;
        const type = this.validRepoTypes.has(repoData.type) ? repoData.type : "primary";
        const languages = Array.isArray(repoData.languages)
            ? repoData.languages.filter((lang: unknown) => typeof lang === "string")
            : [];
        const excludePatterns = Array.isArray(repoData.excludePatterns)
            ? repoData.excludePatterns.filter((pattern: unknown) => typeof pattern === "string")
            : undefined;
        const allowCrossRepoEdits = repoData.allowCrossRepoEdits === true;
        return {
            path: repoData.path,
            name,
            type,
            languages,
            excludePatterns,
            allowCrossRepoEdits
        };
    }

    public getRepo(id: string): RepoConfig | undefined {
        return this.repos.get(id);
    }

    public getDefaultRepo(): RepoConfig | undefined {
        return this.repos.get(this.defaultRepoId);
    }

    public getAllRepos(): RepoConfig[] {
        return Array.from(this.repos.values());
    }

    public findRepoByPath(filePath: string): RepoConfig | undefined {
        const absolutePath = path.resolve(filePath);
        for (const repo of this.repos.values()) {
            if (absolutePath.startsWith(repo.path)) {
                return repo;
            }
        }
        return undefined;
    }

    public watch(onChange: () => void): void {
        if (this.watcher) return;
        if (fs.existsSync(this.configPath)) {
            this.watcher = fs.watch(this.configPath, { persistent: false }, (event) => {
                if (event === "change" || event === "rename") {
                    this.loadConfig();
                    onChange();
                }
            });
        }
    }

    public dispose(): void {
        this.watcher?.close();
    }
}
