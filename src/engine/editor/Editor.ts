import type { Edit, EditResult, MatchDiagnostics, SemanticDiffProvider } from "../../types.js";
import type { IFileSystem } from "../../platform/FileSystem.js";
import { BackupManager } from "./EditIntegrity.js";
import { EditExecutor } from "./EditExecution.js";
import { EditPlanner } from "./EditPlanning.js";
import type { PlannedMatch } from "./EditTypes.js";

export { AmbiguousMatchError, HashMismatchError, MatchNotFoundError } from "./EditTypes.js";
export type { PlannedMatch } from "./EditTypes.js";

export class EditorEngine {
    private readonly planner: EditPlanner;
    private readonly executor: EditExecutor;

    constructor(rootPath: string, fileSystem: IFileSystem, semanticDiffProvider?: SemanticDiffProvider) {
        this.planner = new EditPlanner();
        const backupManager = new BackupManager(fileSystem);
        this.executor = new EditExecutor({
            rootPath,
            fileSystem,
            semanticDiffProvider,
            planner: this.planner,
            backupManager
        });
    }

    public getDiagnostics(content: string, edit: Edit): MatchDiagnostics {
        return this.planner.getDiagnostics(content, edit);
    }

    public planEditsFromContent(
        content: string,
        edits: Edit[],
        opts?: { allowAmbiguousAutoPick?: boolean; timeoutMs?: number }
    ): PlannedMatch[] {
        return this.planner.planEditsFromContent(content, edits, opts);
    }

    public async applyEdits(
        filePath: string,
        edits: Edit[],
        dryRun: boolean = false,
        options?: { diffMode?: "myers" | "semantic" }
    ): Promise<EditResult> {
        return this.executor.applyEdits(filePath, edits, dryRun, options);
    }
}
