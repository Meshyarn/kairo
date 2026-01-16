import * as path from "path";
import * as zlib from "zlib";
import { promises as fs } from "fs";
import { PathManager } from "../utils/PathManager.js";
import { hashContent } from "../utils/hash.js";
import { PatienceDiff } from "./PatienceDiff.js";
import type { TransactionSnapshot } from "./TransactionLog.js";
import type { EditOperation } from "../types.js";

export type PatchFormat = "unified_diff" | "structured_edits" | "both";

export type PatchManifest = {
    patchRef: string;
    patchFormat: PatchFormat;
    createdAt: number;
    diffPath?: string;
    editsPath?: string;
    diffSummary?: { fileCount: number; linesAdded: number; linesDeleted: number; linesChanged: number; skippedFiles?: number };
    filesTouched?: Array<{ path: string; beforeHash?: string; afterHash?: string; bytesBefore?: number; bytesAfter?: number }>;
};

export class PatchStore {
    private readonly rootDir: string;

    constructor() {
        this.rootDir = path.join(PathManager.getHistoryDir(), "patches");
    }

    public async storePatch(args: {
        snapshots: TransactionSnapshot[];
        operations?: EditOperation[];
        diffSummary?: PatchManifest["diffSummary"];
        filesTouched?: PatchManifest["filesTouched"];
    }): Promise<{ patchRef: string; patchFormat: PatchFormat }> {
        await this.ensureStorageReady();

        const diff = this.buildUnifiedDiff(args.snapshots);
        const structuredEdits = this.buildStructuredEdits(args.operations ?? []);
        const patchFormat = this.resolvePatchFormat(Boolean(diff), structuredEdits.length > 0);

        const payloadFingerprint = JSON.stringify({
            diff,
            structuredEdits,
            diffSummary: args.diffSummary,
            filesTouched: args.filesTouched
        });
        const patchRef = hashContent(payloadFingerprint);
        const prefix = patchRef.slice(0, 2);
        const patchDir = path.join(this.rootDir, prefix);

        await fs.mkdir(patchDir, { recursive: true });

        const diffPath = diff ? path.join(patchDir, `${patchRef}.diff.gz`) : undefined;
        const editsPath = structuredEdits.length > 0 ? path.join(patchDir, `${patchRef}.edits.json.gz`) : undefined;
        const manifestPath = path.join(patchDir, `${patchRef}.manifest.json.gz`);

        if (diff && diffPath) {
            await fs.writeFile(diffPath, zlib.gzipSync(diff));
        }
        if (structuredEdits.length > 0 && editsPath) {
            await fs.writeFile(editsPath, zlib.gzipSync(JSON.stringify(structuredEdits, null, 2)));
        }

        const manifest: PatchManifest = {
            patchRef,
            patchFormat,
            createdAt: Date.now(),
            diffPath: diffPath ? path.relative(this.rootDir, diffPath) : undefined,
            editsPath: editsPath ? path.relative(this.rootDir, editsPath) : undefined,
            diffSummary: args.diffSummary,
            filesTouched: args.filesTouched
        };
        await fs.writeFile(manifestPath, zlib.gzipSync(JSON.stringify(manifest, null, 2)));

        return { patchRef, patchFormat };
    }

    public async loadManifest(patchRef: string): Promise<PatchManifest | null> {
        const manifestPath = this.resolveManifestPath(patchRef);
        try {
            const raw = await fs.readFile(manifestPath);
            const decoded = zlib.gunzipSync(raw).toString("utf-8");
            return JSON.parse(decoded) as PatchManifest;
        } catch {
            return null;
        }
    }

    public resolveManifestPath(patchRef: string): string {
        const prefix = patchRef.slice(0, 2);
        return path.join(this.rootDir, prefix, `${patchRef}.manifest.json.gz`);
    }

    public resolvePayloadPath(relativePath: string): string {
        return path.join(this.rootDir, relativePath);
    }

    private buildUnifiedDiff(snapshots: TransactionSnapshot[]): string {
        const chunks: string[] = [];
        for (const snapshot of snapshots) {
            const before = snapshot.originalContent ?? "";
            const after = snapshot.newContent ?? "";
            const hunks = PatienceDiff.diff(before, after, { contextLines: 3 });
            if (hunks.length === 0) continue;
            const header = `--- a/${snapshot.filePath}\n+++ b/${snapshot.filePath}\n`;
            chunks.push(`${header}${PatienceDiff.formatUnified(hunks)}`);
        }
        return chunks.join("\n");
    }

    private buildStructuredEdits(operations: EditOperation[]): Array<{ filePath: string; edits: EditOperation["edits"] }> {
        return operations
            .filter(op => Boolean(op.filePath) && Array.isArray(op.edits) && op.edits.length > 0)
            .map(op => ({ filePath: op.filePath as string, edits: op.edits }));
    }

    private resolvePatchFormat(hasDiff: boolean, hasEdits: boolean): PatchFormat {
        if (hasDiff && hasEdits) return "both";
        if (hasEdits) return "structured_edits";
        return "unified_diff";
    }

    private async ensureStorageReady(): Promise<void> {
        await fs.mkdir(this.rootDir, { recursive: true });
        const warnPct = Number(process.env.KAIRO_PATCH_STORAGE_WARN_FREE_PCT ?? "8");
        const blockPct = Number(process.env.KAIRO_PATCH_STORAGE_BLOCK_FREE_PCT ?? "3");
        if (!Number.isFinite(warnPct) || !Number.isFinite(blockPct)) return;
        try {
            const stats = await fs.statfs(this.rootDir);
            const freePct = stats.blocks > 0 ? (stats.bavail / stats.blocks) * 100 : 100;
            if (freePct <= blockPct) {
                const error = new Error("ledger_storage_exhausted");
                (error as any).code = "ledger_storage_exhausted";
                throw error;
            }
            if (freePct <= warnPct) {
                console.warn(`[PatchStore] Low disk space: ${freePct.toFixed(2)}% free`);
            }
        } catch (error: any) {
            if (error?.code === "ledger_storage_exhausted") {
                throw error;
            }
        }
    }
}
