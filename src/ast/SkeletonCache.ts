import * as path from 'path';
import { PathHelpers } from '../utils/PathHelpers.js';
import { createHash } from 'crypto';
import { LRUCache } from '../utils/LRUCache.js';
import { PathManager } from '../utils/PathManager.js';
import type { SkeletonOptions } from '../types.js';
import { NodeFileSystem, type IFileSystem, type FileStats } from '../platform/FileSystem.js';

interface CachedSkeleton {
    mtime: number;
    skeleton: string;
    optionsHash: string;
}

export class SkeletonCache {
    private readonly memoryCache: LRUCache<string, CachedSkeleton>;
    private readonly diskCacheDir: string;
    private l1Hits = 0;
    private l2Hits = 0;
    private misses = 0;
    private readonly pendingWrites = new Set<Promise<void>>();
    private readonly fileSystem: IFileSystem;

    constructor(
        projectRoot: string,
        memoryCacheSize = 1000,
        ttlMs = 60_000,
        fileSystem?: IFileSystem
    ) {
        this.memoryCache = new LRUCache(memoryCacheSize, ttlMs);
        this.diskCacheDir = PathHelpers.join(PathManager.getCacheDir(), 'skeletons');
        this.fileSystem = fileSystem ?? new NodeFileSystem(projectRoot);
    }

    public async getSkeleton(
        filePath: string,
        options: SkeletonOptions = {},
        generator: (filePath: string, options: SkeletonOptions) => Promise<string>
    ): Promise<string> {
        let stat: FileStats;
        try {
            stat = await this.fileSystem.stat(filePath);
        } catch {
            return generator(filePath, options);
        }

        const mtime = stat.mtime;
        const optionsHash = this.hashOptions(options);
        const cacheKey = this.getCacheKey(filePath, mtime, optionsHash);

        const memCached = this.memoryCache.get(cacheKey);
        if (memCached) {
            this.l1Hits++;
            return memCached.skeleton;
        }

        const diskCached = await this.loadFromDisk(filePath, mtime, optionsHash);
        if (diskCached) {
            this.l2Hits++;
            this.memoryCache.set(cacheKey, diskCached);
            return diskCached.skeleton;
        }

        this.misses++;
        const skeleton = await generator(filePath, options);
        const cached: CachedSkeleton = { mtime, skeleton, optionsHash };
        this.memoryCache.set(cacheKey, cached);

        const writePromise = this.saveToDisk(filePath, cached).catch(error => {
            console.warn(`[SkeletonCache] Failed to save cache for ${path.basename(filePath)}:`, error);
        }).finally(() => {
            this.pendingWrites.delete(writePromise);
        });

        this.pendingWrites.add(writePromise);
        return skeleton;
    }

    public async invalidate(filePath: string): Promise<void> {
        for (const key of this.memoryCache.keys()) {
            if (typeof key === 'string' && key.startsWith(`${filePath}:`)) {
                this.memoryCache.delete(key);
            }
        }

        const pathHash = this.hashPath(filePath);
        const dirPath = PathHelpers.join(this.diskCacheDir, pathHash);
        if (await this.fileSystem.exists(dirPath)) {
            await this.fileSystem.deleteFile(dirPath);
        }
    }

    public async clearAll(): Promise<void> {
        await this.flushPendingWrites();
        this.memoryCache.clear();
        if (await this.fileSystem.exists(this.diskCacheDir)) {
            await this.fileSystem.deleteFile(this.diskCacheDir);
        }
    }

    public async close(): Promise<void> {
        await this.flushPendingWrites();
        this.memoryCache.clear();
    }

    private async flushPendingWrites(): Promise<void> {
        const writes = Array.from(this.pendingWrites);
        this.pendingWrites.clear();
        await Promise.all(writes);
    }


    public getStats(): { memorySize: number; diskCacheDir: string; l1Hits: number; l2Hits: number; misses: number } {
        return {
            memorySize: this.memoryCache.size(),
            diskCacheDir: this.diskCacheDir,
            l1Hits: this.l1Hits,
            l2Hits: this.l2Hits,
            misses: this.misses
        };
    }

    private async loadFromDisk(filePath: string, expectedMtime: number, optionsHash: string): Promise<CachedSkeleton | null> {
        const cacheFilePath = this.getDiskCachePath(filePath, expectedMtime, optionsHash);
        try {
            const raw = await this.fileSystem.readFile(cacheFilePath);
            const cached = JSON.parse(raw) as CachedSkeleton;
            if (cached.mtime !== expectedMtime) {
                return null;
            }
            return cached;
        } catch (error) {
            const code = (error as NodeJS.ErrnoException)?.code;
            if (code !== 'ENOENT') {
                console.warn('[SkeletonCache] Error loading cache:', error);
            }
            return null;
        }
    }

    private async saveToDisk(filePath: string, cached: CachedSkeleton): Promise<void> {
        const cacheFilePath = this.getDiskCachePath(filePath, cached.mtime, cached.optionsHash);
        await this.fileSystem.createDir(path.dirname(cacheFilePath));
        await this.fileSystem.writeFile(cacheFilePath, JSON.stringify(cached, null, 2));
    }

    private getDiskCachePath(filePath: string, mtime: number, optionsHash: string): string {
        const pathHash = this.hashPath(filePath);
        const filename = `${mtime}-${optionsHash}.json`;
        return PathHelpers.join(this.diskCacheDir, pathHash, filename);
    }

    private getCacheKey(filePath: string, mtime: number, optionsHash: string): string {
        return `${filePath}:${mtime}:${optionsHash}`;
    }

    private hashOptions(options: SkeletonOptions): string {
        const normalized = JSON.stringify({
            detailLevel: options.detailLevel || 'standard',
                        includeComments: options.includeComments === true,
            includeMemberVars: options.includeMemberVars !== false,
            includeSummary: options.includeSummary === true,

            maxMemberPreview: Math.max(1, options.maxMemberPreview ?? 3)
        });
        return createHash('md5').update(normalized).digest('hex').slice(0, 8);
    }

    private hashPath(filePath: string): string {
        return createHash('md5').update(filePath).digest('hex').slice(0, 8);
    }
}
