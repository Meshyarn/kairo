import * as path from 'path';
import { ProjectIndex, FileIndexEntry } from './ProjectIndex.js';
import { PathManager } from '../utils/PathManager.js';
import { NodeFileSystem, type IFileSystem } from '../platform/FileSystem.js';

const CURRENT_INDEX_VERSION = '1.1.0';

/**
 * Manages persistent project index storage and retrieval
 */
export class ProjectIndexManager {
  private projectRoot: string;
  private indexPath: string;
  private readonly fileSystem: IFileSystem;
  
  constructor(projectRoot: string, fileSystem?: IFileSystem) {
    this.projectRoot = projectRoot;
    this.fileSystem = fileSystem ?? new NodeFileSystem(projectRoot);
    this.indexPath = this.resolveExistingIndexPath();
  }
  
  private resolveExistingIndexPath(): string {
    const unifiedIndexPath = path.join(PathManager.getIndexDir(), 'index.json');
    const legacyIndexPath = path.join(this.projectRoot, '.kairo-index', 'index.json');

    if (this.fileSystem.existsSync?.(unifiedIndexPath)) {
      return unifiedIndexPath;
    }
    if (this.fileSystem.existsSync?.(legacyIndexPath)) {
      return legacyIndexPath;
    }
    return unifiedIndexPath;
  }

  /**
   * Load persisted index from disk
   * Returns null if index doesn't exist or version mismatch
   */
  async loadPersistedIndex(): Promise<ProjectIndex | null> {
    try {
      this.indexPath = this.resolveExistingIndexPath();
      if (!await this.fileSystem.exists(this.indexPath)) {
        return null;
      }
      
      const data = await this.fileSystem.readFile(this.indexPath);
      const index: ProjectIndex = JSON.parse(data);
      
      if (index.version !== CURRENT_INDEX_VERSION) {
        console.log(`[ProjectIndex] Version mismatch: ${index.version} vs ${CURRENT_INDEX_VERSION}, rebuilding...`);
        return null;
      }

      if (index.projectRoot !== this.projectRoot) {
        console.log(`[ProjectIndex] Project root mismatch, rebuilding...`);
        return null;
      }

      console.log(`[ProjectIndex] Loaded existing index with ${Object.keys(index.files).length} files`);
      return index;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        console.log('[ProjectIndex] No existing index found, will build from scratch');
      } else {
        console.error('[ProjectIndex] Error loading index:', error);
      }
      return null;
    }
  }

  /**
   * Persist current index to disk
   */
  async persistIndex(index: ProjectIndex): Promise<void> {
    try {
      const targetPath = path.join(PathManager.getIndexDir(), 'index.json');
      const json = JSON.stringify(index, null, 2);

      // Ensure directory exists
      await this.fileSystem.createDir(path.dirname(targetPath));
      await this.fileSystem.writeFile(targetPath, json);
      this.indexPath = targetPath;
      
      console.log(`[ProjectIndex] Persisted index with ${Object.keys(index.files).length} files`);
    } catch (error) {
      console.error('[ProjectIndex] Error persisting index:', error);
    }
  }
  
  /**
   * Get list of files that changed since last index
   * Returns all files if no index exists (full rebuild)
   */
  async getChangedFilesSinceLastIndex(
    currentFiles: string[]
  ): Promise<{ changed: string[]; unchanged: string[] }> {
    const index = await this.loadPersistedIndex();
    // No index → full rebuild
    if (!index) {
      return { changed: currentFiles, unchanged: [] };
    }

    const changed: string[] = [];
    const unchanged: string[] = [];

    for (const file of currentFiles) {
      try {
        const stat = await this.fileSystem.stat(file);
        const indexedEntry = index.files[file];
        
        if (!indexedEntry || stat.mtime > indexedEntry.mtime) {
          changed.push(file);
        } else {
          unchanged.push(file);
        }
      } catch (e) {
        changed.push(file);
      }
    }

    console.log(`[ProjectIndex] Changed: ${changed.length}, Unchanged: ${unchanged.length}`);
    return { changed, unchanged };
  }
  
  /**
   * Create new empty index structure
   */
  createEmptyIndex(): ProjectIndex {
    return {
      version: CURRENT_INDEX_VERSION,
      projectRoot: this.projectRoot,
      lastUpdate: Date.now(),
      files: {},
      symbolIndex: Object.create(null) as ProjectIndex["symbolIndex"],
      reverseImports: Object.create(null) as ProjectIndex["reverseImports"]
    };
  }
  
  /**
   * Update index entry for a single file
   */
  updateFileEntry(
    index: ProjectIndex,
    filePath: string,
    entry: FileIndexEntry
  ): void {
    index.files[filePath] = entry;
    index.lastUpdate = Date.now();

    // Update symbol index
    for (const symbol of entry.symbols) {
      const name = symbol?.name;
      if (!name) continue;
      const existing = index.symbolIndex[name];
      const bucket = Array.isArray(existing) ? existing : [];
      if (bucket !== existing) {
        index.symbolIndex[name] = bucket;
      }
      if (!bucket.includes(filePath)) {
        bucket.push(filePath);
      }
    }

    // Update reverse imports
    for (const imp of entry.imports) {
      if (imp.resolvedPath) {
        const key = imp.resolvedPath;
        const existing = index.reverseImports[key];
        const bucket = Array.isArray(existing) ? existing : [];
        if (bucket !== existing) {
          index.reverseImports[key] = bucket;
        }
        if (!bucket.includes(filePath)) {
          bucket.push(filePath);
        }
      }
    }
  }
  
  /**
   * Remove file from index (e.g., when deleted)
   */
  removeFileEntry(index: ProjectIndex, filePath: string): void {
    const entry = index.files[filePath];
    if (!entry) return;

    // Remove from symbol index
    for (const symbol of entry.symbols) {
      const name = symbol?.name;
      if (!name) continue;
      const paths = index.symbolIndex[name];
      if (!Array.isArray(paths)) continue;
      const next = paths.filter(p => p !== filePath);
      if (next.length === 0) {
        delete index.symbolIndex[name];
      } else {
        index.symbolIndex[name] = next;
      }
    }

    // Remove from reverse imports
    for (const imp of entry.imports) {
      if (imp.resolvedPath) {
        const key = imp.resolvedPath;
        const paths = index.reverseImports[key];
        if (!Array.isArray(paths)) continue;
        const next = paths.filter(p => p !== filePath);
        if (next.length === 0) {
          delete index.reverseImports[key];
        } else {
          index.reverseImports[key] = next;
        }
      }
    }

    delete index.files[filePath];
    index.lastUpdate = Date.now();
  }
}
