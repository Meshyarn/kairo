import crypto from 'crypto';
import { InternalToolRegistry } from '../InternalToolRegistry.js';
import { OrchestrationContext } from '../OrchestrationContext.js';
import { ParsedIntent } from '../IntentRouter.js';

export class ReadPillar {
  constructor(private readonly registry: InternalToolRegistry) {}

  public async execute(intent: ParsedIntent, context: OrchestrationContext): Promise<any> {
    const { targets, constraints, originalIntent } = intent;
    const target = constraints.targetPath || targets[0] || originalIntent;
    const view = constraints.view ?? (constraints.depth === 'deep' ? 'full' : 'skeleton');
    const includeProfile = constraints.includeProfile === true;
    const includeHash = constraints.includeHash === true;
    const resolvedPath = await this.resolveTargetPath(target);
    const lineRange = this.normalizeLineRange(constraints.lineRange);
    const sectionId = constraints.sectionId;
    const headingPath = constraints.headingPath;
    const isDocument = this.isDocumentPath(resolvedPath);

    let content: string;
    let documentOutline: any = undefined;

    if (isDocument && (sectionId || headingPath)) {
      const mode = (constraints.mode ?? (view === 'full' ? 'raw' : 'preview')) as 'summary' | 'preview' | 'raw';
      const maxChars = typeof constraints.maxChars === 'number'
        ? constraints.maxChars
        : Number.parseInt(process.env.KAIRO_DOC_SECTION_MAX_CHARS ?? (mode === 'raw' ? '12000' : '4000'), 10);
      const docSection = await this.runTool(context, 'document_section', {
        filePath: resolvedPath,
        sectionId,
        headingPath,
        includeSubsections: constraints.includeSubsections === true,
        mode,
        maxChars
      });
      content = docSection?.content ?? '';
      documentOutline = docSection?.section ? [docSection.section] : undefined;
    } else if (isDocument && view === 'skeleton') {
      const docSkeleton = await this.runTool(context, 'document_skeleton', {
        filePath: resolvedPath,
        options: constraints.outlineOptions
      });
      const maxChars = Number.parseInt(process.env.KAIRO_DOC_SKELETON_MAX_CHARS ?? "2000", 10);
      content = truncateText(docSkeleton?.skeleton ?? '', maxChars);
      documentOutline = docSkeleton?.outline;
    } else {
      content = await this.runTool(context, 'code_read', {
        filePath: resolvedPath,
        view,
        lineRange
      });
    }

    const needsFullContent = view === 'full' || includeHash;
    const includeSkeleton = view === 'skeleton';

    const [profile, skeleton, fullContent] = await Promise.all([
      this.runTool(context, 'file_profile', { filePath: resolvedPath }),
      includeSkeleton ? Promise.resolve(content) : Promise.resolve(null),
      needsFullContent
        ? (view === 'full' ? Promise.resolve(content) : this.runTool(context, 'code_read', { filePath: resolvedPath, view: 'full' }))
        : Promise.resolve(null)
    ]);

    const hashSource = typeof fullContent === 'string' ? fullContent : content;
    const hash = includeHash ? this.computeHash(hashSource) : '';
    const metadata = {
      filePath: profile?.metadata?.relativePath ?? profile?.metadata?.filePath ?? resolvedPath,
      hash,
      lineCount: profile?.metadata?.lineCount ?? (typeof fullContent === 'string' ? fullContent.split(/\r?\n/).length : (typeof content === 'string' ? content.split(/\r?\n/).length : 0)),
      language: profile?.metadata?.language ?? null
    };

    return {
      success: true,
      status: 'success',
      content,
      metadata,
      profile: includeProfile ? (profile ?? undefined) : undefined,
      skeleton: typeof skeleton === 'string' ? skeleton : undefined,
      document: documentOutline ? { outline: documentOutline } : undefined,
      guidance: {
        message: view === 'full'
          ? 'Full content loaded.'
          : 'Content loaded. Use view="full" or includeProfile/includeHash for more detail.',
        suggestedActions: view === 'full'
          ? []
          : [
              { pillar: 'read', action: 'view_full', target: resolvedPath },
              { pillar: 'read', action: 'include_profile', target: resolvedPath, options: { includeProfile: true } }
            ]
      }
    };
  }

  private async resolveTargetPath(target: string): Promise<string> {
    if (this.looksLikePath(target)) {
      if (!/[\\/]/.test(target)) {
        const filenameMatch = await this.registry.execute('project_search', { query: target, type: 'filename', maxResults: 1 });
        if (filenameMatch?.results?.length > 0) {
          return filenameMatch.results[0].path;
        }
      }
      return target;
    }
    const symbolMatch = await this.registry.execute('project_search', { query: target, type: 'symbol', maxResults: 1 });
    if (symbolMatch?.results?.length > 0) {
      return symbolMatch.results[0].path;
    }
    const fileMatch = await this.registry.execute('project_search', { query: target, type: 'file', maxResults: 1 });
    if (fileMatch?.results?.length > 0) {
      return fileMatch.results[0].path;
    }
    return target;
  }

  private looksLikePath(target: string): boolean {
    return /[\\/]/.test(target) || /\.[a-z0-9]+$/i.test(target);
  }

  private isDocumentPath(target: string): boolean {
    return /\.(md|mdx|txt|log|docx|xlsx|pdf)$/i.test(target);
  }

  private normalizeLineRange(raw?: string | [number, number]): string | undefined {
    if (!raw) return undefined;
    if (Array.isArray(raw) && raw.length === 2) {
      return `${raw[0]}-${raw[1]}`;
    }
    return raw;
  }

  private computeHash(content: string): string {
    return crypto.createHash('sha256').update(content ?? '').digest('hex');
  }

  private async runTool(context: OrchestrationContext, tool: string, args: any) {
    const started = Date.now();
    const output = await this.registry.execute(tool, args);
    context.addStep({
      id: `${tool}_${context.getFullHistory().length + 1}`,
      tool,
      args,
      output,
      status: output?.success === false || output?.isError ? 'failure' : 'success',
      duration: Date.now() - started
    });
    return output;
  }
}

function truncateText(text: string, maxChars: number): string {
  const limit = Number.isFinite(maxChars) && maxChars > 0 ? maxChars : 2000;
  const value = String(text ?? "");
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(1, limit - 1))}…`;
}
