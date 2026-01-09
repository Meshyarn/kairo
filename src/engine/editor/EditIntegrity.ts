import * as path from "path";
import { PathManager } from "../../utils/PathManager.js";
import type { IFileSystem } from "../../platform/FileSystem.js";

export class BackupManager {
    private readonly backupsDir: string;

    constructor(private readonly fileSystem: IFileSystem, backupsDir?: string) {
        this.backupsDir = backupsDir ?? PathManager.getBackupDir();
    }

    private async ensureBackupsDirExists(): Promise<void> {
        if (!(await this.fileSystem.exists(this.backupsDir))) {
            await this.fileSystem.createDir(this.backupsDir);
        }
    }

    private getBackupFilePath(originalFilePath: string): string {
        const now = new Date();
        const timestamp = now.toISOString().replace(/[:.-]/g, "");
        const encodedPath = originalFilePath
            .replace(/^[A-Z]:/i, (drive) => drive[0] + "_")
            .replace(/["/\\:]/g, "_")
            .replace(/^_/, "");
        return path.join(this.backupsDir, `${encodedPath}_${timestamp}.bak`);
    }

    public async createTimestampedBackup(originalFilePath: string, content: string): Promise<void> {
        const backupPath = this.getBackupFilePath(originalFilePath);
        await this.ensureBackupsDirExists();
        await this.fileSystem.writeFile(backupPath, content);
    }

    public async enforceRetentionPolicy(originalFilePath: string, maxBackups: number = 10): Promise<void> {
        try {
            const encodedPathPrefix = originalFilePath
                .replace(/^[A-Z]:/i, (drive) => drive[0] + "_")
                .replace(/["/\\:]/g, "_")
                .replace(/^_/, "");

            await this.ensureBackupsDirExists();
            const files = await this.fileSystem.readDir(this.backupsDir);
            const relevantBackups = files
                .filter((f) => f.startsWith(`${encodedPathPrefix}_`) && f.endsWith(".bak"))
                .sort((a, b) => b.localeCompare(a));

            if (relevantBackups.length > maxBackups) {
                const toDelete = relevantBackups.slice(maxBackups);
                for (const file of toDelete) {
                    await this.fileSystem.deleteFile(path.join(this.backupsDir, file));
                }
            }
        } catch (error: any) {
            console.warn(`[EditorEngine] Failed to enforce backup retention: ${error.message}`);
        }
    }
}
