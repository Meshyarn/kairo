import * as path from 'path';
import { AstBackend, AstDocument } from './AstBackend.js';
import { NodeFileSystem, type IFileSystem } from '../platform/FileSystem.js';

interface SnapshotBackendOptions {
    snapshotDir: string;
    rootPath: string;
}

export class SnapshotBackend implements AstBackend {
    name = 'snapshot';
    capabilities = {
        supportsComments: false,
        supportsTypeAnnotations: false,
        supportsQueries: false,
        nodeTypeNormalization: 'native' as const
    };

    private snapshotDir: string;
    private rootPath: string;
    private readonly fileSystem: IFileSystem;

    constructor(options: SnapshotBackendOptions & { fileSystem?: IFileSystem }) {
        this.snapshotDir = options.snapshotDir;
        this.rootPath = options.rootPath;
        this.fileSystem = options.fileSystem ?? new NodeFileSystem(this.rootPath);
    }

    async initialize(): Promise<void> {
        if (!this.fileSystem.existsSync?.(this.snapshotDir)) {
            throw new Error(`Snapshot directory ${this.snapshotDir} does not exist`);
        }
    }

    async parseFile(absPath: string, content: string): Promise<AstDocument> {
        const rel = path.relative(this.rootPath, absPath);
        const snapshotPath = path.join(this.snapshotDir, rel + '.json');

        if (!this.fileSystem.existsSync?.(snapshotPath)) {
            throw new Error(`Snapshot not found for ${rel} at ${snapshotPath}`);
        }

        const raw = await this.fileSystem.readFile(snapshotPath);
        const snapshot = JSON.parse(raw);

        const fallbackLanguage = path.extname(absPath).replace('.', '') || 'unknown';

        return {
            rootNode: snapshot.rootNode ?? null,
            languageId: snapshot.languageId ?? fallbackLanguage,
            content,
            dispose: () => { /* nothing */ }
        };
    }

    async getLanguage(languageId: string): Promise<any> {
        return { name: languageId, backend: this.name };
    }
}
