import { IndexDatabase } from "./IndexDatabase.js";
import type { RepoRegistry } from "../config/RepoRegistry.js";
import type { StoredDependency } from "../storage/IndexStore.js";
import { createLogger } from "../utils/StructuredLogger.js";

export class MultiRepoIndexCoordinator {
    private indexDatabases: Map<string, IndexDatabase> = new Map();
    private readonly logger = createLogger("MultiRepoIndex");

    constructor(private readonly repoRegistry: RepoRegistry) {
        this.initializeIndexes();
    }

    private initializeIndexes(): void {
        for (const repo of this.repoRegistry.getAllRepos()) {
            const db = new IndexDatabase(repo.path, repo.id);
            this.indexDatabases.set(repo.id, db);
        }
    }

    public searchSymbolsAcrossRepos(
        pattern: string,
        options?: { repoIds?: string[]; limit?: number }
    ): Array<{ repoId: string; path: string; data_json: string }> {
        const results: Array<{ repoId: string; path: string; data_json: string }> = [];
        const targetRepos = options?.repoIds ?? Array.from(this.indexDatabases.keys());

        this.logger.debug(`[MultiRepo] searchSymbolsAcrossRepos pattern="${pattern}" repos=${targetRepos.length}`);
        for (const repoId of targetRepos) {
            const db = this.indexDatabases.get(repoId);
            if (!db) continue;
            const repoResults = db.searchSymbols(pattern, options?.limit);
            results.push(...repoResults.map(entry => ({ ...entry, repoId })));
        }

        return results;
    }

    public getDependenciesAcrossRepos(
        repoId: string,
        relativePath: string,
        direction: "incoming" | "outgoing"
    ): Array<StoredDependency & { repoId: string }> {
        const db = this.indexDatabases.get(repoId);
        if (!db) return [];

        this.logger.debug(`[MultiRepo] getDependenciesAcrossRepos repoId=${repoId} direction=${direction}`);
        const deps = db.getDependencies(relativePath, direction);
        return deps.map(dep => ({
            ...dep,
            repoId
        }));
    }
}
