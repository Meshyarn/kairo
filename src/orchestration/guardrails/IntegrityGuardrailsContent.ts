import path from "path";
import { EditPlanner } from "../../engine/editor/EditPlanning.js";
import { TextNormalizer } from "../../utils/textNormalization.js";
import { PathManager } from "../../utils/PathManager.js";
import type { Edit } from "../../types.js";

export const applyEditsToContent = (content: string, edits: Edit[]): { newContent: string } => {
    if (!edits || edits.length === 0) {
        return { newContent: content };
    }
    const planner = new EditPlanner();
    const matches = planner.applyEditsInternal(content, edits);
    const targetEol = TextNormalizer.detectEOL(content) ?? "\n";

    const ordered = [...matches].sort((a, b) => a.start - b.start);
    let newContent = "";
    let cursor = 0;
    for (const match of ordered) {
        newContent += content.substring(cursor, match.start);
        const normalizedReplacement = TextNormalizer.normalizeForFileSystem(match.replacement, {
            unescapeNewlines: true,
            trimTrailing: true,
            targetEOL: targetEol
        });
        newContent += normalizedReplacement;
        cursor = match.end;
    }
    newContent += content.substring(cursor);
    return { newContent };
};

export const resolveGuardrailTargetPath = (targetPath: string): string => {
    if (path.isAbsolute(targetPath)) {
        return targetPath;
    }
    return path.join(PathManager.getRootPath(), targetPath);
};

export const normalizeGuardrailContent = (content: string | null | undefined): string => {
    return typeof content === "string" ? content : "";
};
