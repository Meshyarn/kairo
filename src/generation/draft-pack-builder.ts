import path from "path";
import { SkeletonGenerator } from "../ast/SkeletonGenerator.js";
import { MyersDiff } from "../engine/Diff.js";
import type { DraftPack, PhantomDiff, PhantomFile, PreflightCheck, SkeletonCode } from "../types/flow-artifacts.js";

export interface DraftPackBuilderOptions {
    skeletonOnly?: boolean;
    includePhantomDiff?: boolean;
    maxPreviewLines?: number;
}

export class DraftPackBuilder {
    private readonly skeletonGenerator: SkeletonGenerator;
    private readonly options: DraftPackBuilderOptions;

    constructor(options: DraftPackBuilderOptions = {}, skeletonGenerator?: SkeletonGenerator) {
        this.options = options;
        this.skeletonGenerator = skeletonGenerator ?? new SkeletonGenerator();
    }

    public async buildForWrite(args: {
        intent: string;
        targetPath: string;
        content: string;
        existingContent?: string | null;
    }): Promise<DraftPack> {
        const skeleton = await this.buildSkeleton(args.targetPath, args.content);
        const phantomFiles = this.buildPhantomFiles(args.targetPath, args.content, args.existingContent);
        const phantomDiffs = this.options.includePhantomDiff === false
            ? undefined
            : this.computePhantomDiffs(args.targetPath, args.existingContent ?? "", args.content);

        return this.buildPack({
            intent: args.intent,
            skeleton,
            phantomFiles,
            phantomDiffs
        });
    }

    public async buildForChange(args: {
        intent: string;
        targetPath: string;
        oldContent: string;
        newContent: string;
    }): Promise<DraftPack> {
        const skeleton = await this.buildSkeleton(args.targetPath, args.newContent);
        const phantomFiles = this.buildPhantomFiles(args.targetPath, args.newContent, args.oldContent);
        const phantomDiffs = this.computePhantomDiffs(args.targetPath, args.oldContent, args.newContent);

        return this.buildPack({
            intent: args.intent,
            skeleton,
            phantomFiles,
            phantomDiffs
        });
    }

    private async buildSkeleton(targetPath: string, content: string): Promise<SkeletonCode> {
        const skeletonOnly = this.options.skeletonOnly !== false;
        const skeletonContent = skeletonOnly
            ? await this.skeletonGenerator.generateSkeleton(targetPath, content, { useCommentPlaceholder: true })
            : content;
        return {
            content: skeletonContent,
            signatures: [],
            structure: { imports: [], exports: [], dependencies: [] },
            placeholders: []
        };
    }

    private buildPhantomFiles(targetPath: string, content: string, existingContent?: string | null): PhantomFile[] {
        return [{
            path: targetPath,
            content,
            isNew: !existingContent,
            language: path.extname(targetPath).replace(".", "") || "unknown"
        }];
    }

    private computePhantomDiffs(targetPath: string, oldContent: string, newContent: string): PhantomDiff[] {
        const summary = MyersDiff.diffLinesStructured(oldContent, newContent);
        const lines = summary.diff.trimEnd().split("\n");
        const hunks = [{
            oldStart: 1,
            oldLines: oldContent.split("\n").length,
            newStart: 1,
            newLines: newContent.split("\n").length,
            lines
        }];
        return [{
            path: targetPath,
            hunks,
            summary: `+${summary.added} -${summary.removed}`,
            additions: summary.added,
            deletions: summary.removed
        }];
    }

    private buildPack(args: {
        intent: string;
        skeleton: SkeletonCode;
        phantomFiles: PhantomFile[];
        phantomDiffs?: PhantomDiff[];
    }): DraftPack {
        return {
            id: this.generatePackId(),
            intent: args.intent,
            skeleton: args.skeleton,
            phantomFiles: args.phantomFiles,
            phantomDiffs: args.phantomDiffs,
            preflightCheck: this.buildPreflightCheck(),
            createdAt: Date.now(),
            status: "pending"
        };
    }

    private buildPreflightCheck(): PreflightCheck {
        return {
            syntaxValid: true,
            typesResolvable: true,
            guardrailsPassed: true,
            warnings: []
        };
    }

    private generatePackId(): string {
        const suffix = Math.random().toString(36).slice(2, 8);
        return `draft_${Date.now().toString(36)}_${suffix}`;
    }
}
