import { ConfigurationManager } from "../../../config/ConfigurationManager.js";
import { ResolveError } from "../../../types.js";

export function normalizeOperation(raw: any): string {
  const value = String(raw ?? 'replace').trim().toLowerCase();
  if (value === 'remove') return 'delete';
  if (value === 'add') return 'insert';
  if (value === 'append') return 'insert';
  if (value === 'prepend') return 'insert';
  return value;
}

export function isLikelyFilePath(value: any): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.includes('\n')) return false;
  if (/\s/.test(trimmed)) return false;
  if (/[\\/]/.test(trimmed)) return true;
  return /\.[a-z0-9]+$/i.test(trimmed);
}

export function inferInsertConfig(
  operation: string,
  edit: any,
  targetString: any,
  replacementString: any
): { insertMode?: 'before' | 'after' | 'at'; insertLineRange?: { start: number }; replacementString?: string } {
  const normalizedTarget = typeof targetString === 'string' ? targetString : '';
  const position = String(edit?.position ?? edit?.insertPosition ?? edit?.anchorPosition ?? '').toLowerCase();
  let insertMode: 'before' | 'after' | 'at' | undefined = undefined;

  if (edit?.insertMode) {
    insertMode = edit.insertMode;
  } else if (position === 'before' || position === 'after' || position === 'at') {
    insertMode = position as any;
  } else if (position === 'append') {
    insertMode = 'after';
  } else if (position === 'prepend') {
    insertMode = 'before';
  }

  if (!insertMode && (operation === 'insert' || operation === 'append' || operation === 'prepend')) {
    if (operation === 'prepend') {
      insertMode = 'before';
    } else if (operation === 'append') {
      insertMode = 'after';
    } else if (edit?.insertLineRange?.start || edit?.lineRange?.start) {
      insertMode = 'at';
    } else if (normalizedTarget) {
      insertMode = 'after';
    }
  }

  const insertLineRange = edit?.insertLineRange ?? (edit?.lineRange?.start ? { start: edit.lineRange.start } : undefined);

  if (!insertMode) {
    return {};
  }

  let resolvedReplacement = replacementString;
  if (!resolvedReplacement && typeof edit?.insertContent === 'string') {
    resolvedReplacement = edit.insertContent;
  }

  return {
    insertMode,
    insertLineRange,
    replacementString: typeof resolvedReplacement === 'string' ? resolvedReplacement : replacementString
  };
}

export function normalizeEdits(
  rawEdits: any[],
  targetPath: string
): { edits: any[]; invalidEdits: any[] } {
  const edits: any[] = [];
  const invalidEdits: any[] = [];

  for (const edit of rawEdits) {
    const operation = normalizeOperation(edit?.operation ?? edit?.op);
    const filePath = typeof edit?.filePath === 'string' && edit.filePath.trim().length > 0
      ? edit.filePath
      : (typeof edit?.path === 'string' && edit.path.trim().length > 0
        ? edit.path
        : (isLikelyFilePath(edit?.target) ? edit.target : targetPath));
    const targetFallback = typeof edit?.target === 'string' && !isLikelyFilePath(edit.target)
      ? edit.target
      : '';
    const targetString = edit?.targetString
      ?? edit?.targetContent
      ?? edit?.from
      ?? edit?.search
      ?? edit?.anchor
      ?? edit?.anchorString
      ?? targetFallback
      ?? '';
    let replacementString = edit?.replacementString
      ?? edit?.replacement
      ?? edit?.replace
      ?? edit?.template
      ?? edit?.to
      ?? edit?.with
      ?? edit?.content
      ?? edit?.text
      ?? '';
    const insertOverrides = inferInsertConfig(operation, edit, targetString, replacementString);
    if (insertOverrides.replacementString !== undefined) {
      replacementString = insertOverrides.replacementString;
    }

    if (operation === 'delete') {
      replacementString = '';
    }

    const insertMode = insertOverrides.insertMode ?? edit?.insertMode;
    const insertLineRange = insertOverrides.insertLineRange ?? edit?.insertLineRange;

    const normalized = {
      filePath,
      targetString: typeof targetString === 'string' ? targetString : '',
      replacementString: typeof replacementString === 'string' ? replacementString : '',
      lineRange: edit?.lineRange,
      indexRange: edit?.indexRange,
      beforeContext: edit?.beforeContext ?? edit?.contextBefore,
      afterContext: edit?.afterContext ?? edit?.contextAfter,
      fuzzyMode: edit?.fuzzyMode,
      normalization: edit?.normalization,
      normalizationConfig: edit?.normalizationConfig,
      expectedHash: edit?.expectedHash,
      contextFuzziness: edit?.contextFuzziness,
      insertMode,
      insertLineRange,
      anchorSearchRange: edit?.anchorSearchRange,
      escapeMode: edit?.escapeMode
    };

    const requiresAnchor = normalized.insertMode === 'before' || normalized.insertMode === 'after';
    const missingInsertLine = normalized.insertMode === 'at' && !normalized.insertLineRange?.start;
    if ((!normalized.targetString && !normalized.insertMode) || (requiresAnchor && !normalized.targetString) || missingInsertLine) {
      invalidEdits.push(edit);
      continue;
    }

    edits.push(normalized);
  }

  return { edits, invalidEdits };
}

export function mapEditsToFiles(args: {
  targetFiles: string[];
  rawEdits: any[];
  fallbackTarget?: string;
  extractEditFilePath: (edit: any) => string | undefined;
}): { fileEdits?: Map<string, any[]>; error?: { errorCode: string; message: string } } {
  const { targetFiles, rawEdits, fallbackTarget, extractEditFilePath } = args;
  const fileEdits = new Map<string, any[]>();

  const hasExplicitFile = rawEdits.some(edit => Boolean(extractEditFilePath(edit)));
  const canIndexMap = !hasExplicitFile && targetFiles.length > 0 && targetFiles.length === rawEdits.length;

  for (let i = 0; i < rawEdits.length; i++) {
    const edit = rawEdits[i];
    const explicitPath = extractEditFilePath(edit);
    const filePath = explicitPath ?? (canIndexMap ? targetFiles[i] : fallbackTarget);
    if (!filePath) {
      return {
        error: {
          errorCode: "MULTI_FILE_MAPPING_REQUIRED",
          message: "멀티파일 변경에서 각 edit의 filePath가 필요하거나, targetFiles와 edits 길이가 동일해야 합니다."
        }
      };
    }
    if (!fileEdits.has(filePath)) {
      fileEdits.set(filePath, []);
    }
    fileEdits.get(filePath)!.push(edit);
  }

  return { fileEdits };
}

export function formatBatchDiff(filePath: string, diff: string): string {
  return `# ${filePath}\n${diff}`;
}

export function resolveBatchImpactLimit(constraints: any): number {
  const raw = constraints?.batchImpactLimit ?? process.env.KAIRO_CHANGE_BATCH_IMPACT_LIMIT;
  const parsed = Number.parseInt(raw ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 0;
}

export function formatResolveErrors(
  errors: ResolveError[],
  intent: string,
  targetFiles: string[]
): { message: string; suggestedActions: any[] } {
  const messages: string[] = [];
  const actions: any[] = [];

  const ambiguousErrors = errors.filter(e => e.errorCode === 'AMBIGUOUS_MATCH');
  const timeoutErrors = errors.filter(e => e.errorCode === 'RESOLVE_TIMEOUT');
  const otherErrors = errors.filter(e => e.errorCode !== 'AMBIGUOUS_MATCH' && e.errorCode !== 'RESOLVE_TIMEOUT');

  if (ambiguousErrors.length > 0) {
    const first = ambiguousErrors[0];
    messages.push(`Ambiguous match detected.`);
    
    if (first.suggestion?.lineRange) {
      messages.push(`Try narrowing to lines ${first.suggestion.lineRange.start}-${first.suggestion.lineRange.end}.`);
      actions.push({
        id: 'read.view_fragment',
        priority: 1,
        description: 'View the target fragment.',
        rationale: 'Narrowing the range improves resolve accuracy.',
        toolCall: {
          tool: 'read',
          args: {
            action: 'view_fragment',
            target: first.filePath,
            options: { view: 'fragment', lineRange: `${first.suggestion.lineRange.start}-${first.suggestion.lineRange.end}` }
          }
        }
      });
    } else {
      actions.push({
        id: 'read.view_full',
        priority: 1,
        description: 'View the full file.',
        rationale: 'Full context helps resolve ambiguous matches.',
        toolCall: { tool: 'read', args: { action: 'view_full', target: first.filePath } }
      });
    }
  }

  if (timeoutErrors.length > 0) {
    messages.push(`Resolve timeout (>${ConfigurationManager.getResolveTimeoutMs()}ms). Provide more precise targetString.`);
  }

  if (otherErrors.length > 0) {
    const first = otherErrors[0];
    messages.push(`Resolve failed: ${first.message}`);
  }

  actions.push({
    id: 'change.retry',
    priority: 2,
    description: 'Retry change with updated target text.',
    rationale: 'Retry after confirming the correct target.',
    toolCall: { tool: 'change', args: { action: 'retry', intent, target: targetFiles[0] } }
  });

  actions.push({
    id: 'write.overwrite',
    priority: 3,
    description: 'Overwrite the file with corrected content.',
    rationale: 'Fallback when targeted edits cannot be resolved.',
    toolCall: {
      tool: 'write',
      args: { action: 'overwrite', intent: `Rewrite ${targetFiles[0]} with corrected content`, targetPath: targetFiles[0] }
    }
  });

  return {
    message: messages.join(' '),
    suggestedActions: actions
  };
}
