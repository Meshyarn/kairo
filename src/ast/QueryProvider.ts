import * as fs from 'fs';
import * as path from 'path';
import { Query, Language } from 'web-tree-sitter';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class QueryProvider {
    private queryCache = new Map<string, Query>();
    private queriesRoot: string;
    private readonly languageAliases: Record<string, string[]> = {
        ts: ['typescript'],
        tsx: ['typescript'],
        javascript: ['typescript'],
        js: ['typescript'],
        md: ['markdown'],
        mdx: ['markdown'],
        py: ['python'],
        rs: ['rust']
    };

    constructor(queriesRoot?: string) {
        // Default to src/queries in dev, dist/queries in prod
        this.queriesRoot = queriesRoot || path.resolve(__dirname, '..', 'queries');
        if (!fs.existsSync(this.queriesRoot)) {
            // Fallback for different build structures
            this.queriesRoot = path.resolve(process.cwd(), 'src', 'queries');
        }
        const isTestEnv = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
        if (!isTestEnv) {
            console.debug(`[QueryProvider] Queries root set to: ${this.queriesRoot}`);
        }
    }

    public async getQuery(lang: Language, languageId: string, queryName: string): Promise<Query | null> {
        const normalized = languageId.toLowerCase();
        const candidates = [normalized, ...(this.languageAliases[normalized] ?? [])];

        for (const candidate of candidates) {
            const cacheKey = `${candidate}/${queryName}`;
            if (this.queryCache.has(cacheKey)) {
                return this.queryCache.get(cacheKey)!;
            }

            const queryPath = path.join(this.queriesRoot, candidate, `${queryName}.scm`);
            if (!fs.existsSync(queryPath)) {
                continue;
            }

            try {
                const source = fs.readFileSync(queryPath, 'utf-8');
                const query = new Query(lang, source);
                this.queryCache.set(cacheKey, query);
                return query;
            } catch (error) {
                console.warn(`[QueryProvider] Failed to compile query for ${cacheKey}:`, error);
                return null;
            }
        }

        return null;
    }

    public clearCache(): void {
        this.queryCache.clear();
    }
}
