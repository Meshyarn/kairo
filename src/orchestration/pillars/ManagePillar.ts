
import { InternalToolRegistry } from '../InternalToolRegistry.js';
import { OrchestrationContext } from '../OrchestrationContext.js';
import { ParsedIntent } from '../IntentRouter.js';
import { buildDegradedReasons } from '../DegradedReasonMapper.js';
import { TraceBuilder } from '../trace/TraceBuilder.js';


export class ManagePillar {
  constructor(private readonly registry: InternalToolRegistry) {}

  public async execute(intent: ParsedIntent, context: OrchestrationContext): Promise<any> {
    const { action, targets, constraints } = intent;
    const target = targets[0];
    const scope = constraints.scope;
    const detail = typeof (constraints as any).detail === "string" ? (constraints as any).detail : undefined;
    const traceEnabled = constraints.trace === true;
    const traceBuilder = traceEnabled
      ? new TraceBuilder(
        "manage",
        {
          trace: {
            source: "explicit",
            explicit: true,
            resolved: true
          }
        },
        { startedAtMs: Date.now() }
      )
      : undefined;
    const artifactOptions = constraints.artifactOptions;
    const limit = constraints.limit;
    const sessionId = constraints.sessionId;
    const outcome = (constraints as any).outcome;
    const policy = (constraints as any).policy;
    const policyMode = (constraints as any).policyMode;
    const mode = (constraints as any).mode;
    const configTargets = (constraints as any).targets;
    const root = (constraints as any).root;
    const multiRepo = (constraints as any).multiRepo;
    const presets = (constraints as any).presets;
    const languageScan = (constraints as any).languageScan;
    const applyOptions = (constraints as any).applyOptions;
    const pruneOptions = (constraints as any).pruneOptions;
    const apply = (constraints as any).apply;
    const execute = async (command: string) => {
      const started = Date.now();
        const output = await this.registry.execute('project_manage', {
          command,
          target,
          scope,
          detail,
          artifactOptions,
          limit,
          sessionId,
          outcome,
          policy,
          policyMode,
          mode,
          targets: configTargets,
          root,
          multiRepo,
          presets,
          languageScan,
          applyOptions,
          pruneOptions,
          apply
        });
      context.addStep({
        id: `${command}_${context.getFullHistory().length + 1}`,
        tool: 'project_manage',
        args: {
          command,
          target,
          scope,
          detail,
          artifactOptions,
          limit,
          sessionId,
          outcome,
          policy,
          policyMode,
          mode,
          targets: configTargets,
          root,
          multiRepo,
          presets,
          languageScan,
          applyOptions,
          pruneOptions,
          apply
        },
        output,
        status: output?.success === false || output?.isError ? 'failure' : 'success',
        duration: Date.now() - started
      });
      return output;
    };
    const wrap = (command: string, result: any) =>
      this.wrapResponse(result, {
        command,
        scope,
        detail,
        traceBuilder
      });
    
    switch (action) {
      case 'undo':
        return wrap('undo', await execute('undo'));
      case 'redo':
        return wrap('redo', await execute('redo'));
      case 'status':
        return wrap('status', await execute('status'));
      case 'rebuild':
        return wrap('reindex', await execute('reindex'));
      case 'init':
        return wrap('init', await execute('init'));
      case 'doctor':
        return wrap('doctor', await execute('doctor'));
      case 'history':
        return wrap('history', await execute('history'));
      case 'test':
        return wrap('test', await execute('test'));
      case 'artifacts':
        return wrap('artifacts', await execute('artifacts'));
      case 'artifact':
        return wrap('artifact', await execute('artifact'));
      case 'discard':
        return wrap('discard', await execute('discard'));
      case 'prune':
        return wrap('prune', await execute('prune'));
      case 'export':
        return wrap('export', await execute('export'));
      case 'import':
        return wrap('import', await execute('import'));
      case 'sessions':
        return wrap('sessions', await execute('sessions'));
      case 'session':
        return wrap('session', await execute('session'));
      case 'session_complete':
        return wrap('session_complete', await execute('session_complete'));
      case 'session_update':
        return wrap('session_update', await execute('session_update'));
      default:
        // Check intent directly if action mapping is imprecise
        if (intent.originalIntent.includes('undo')) return wrap('undo', await execute('undo'));
        if (intent.originalIntent.includes('redo')) return wrap('redo', await execute('redo'));
        if (intent.originalIntent.includes('rebuild') || intent.originalIntent.includes('reindex')) {
          return wrap('reindex', await execute('reindex'));
        }
        if (intent.originalIntent.includes('history')) {
          return wrap('history', await execute('history'));
        }
        if (intent.originalIntent.includes('test')) {
          return wrap('test', await execute('test'));
        }
        if (intent.originalIntent.includes('session')) {
          return wrap('sessions', await execute('sessions'));
        }
        if (intent.originalIntent.includes('artifact')) {
          return wrap('artifacts', await execute('artifacts'));
        }
        return wrap('status', await execute('status'));
    }
  }

  private wrapResponse(raw: any, trace?: { command?: string; scope?: string; detail?: string; traceBuilder?: TraceBuilder }) {
    const indexStatus = raw?.status?.status ?? raw?.status ?? undefined;
    const projectState = indexStatus ? { indexStatus, pendingTransactions: raw?.history?.pendingTransactions?.length ?? 0, lastModified: new Date().toISOString() } : undefined;
    const reasons = Array.isArray(raw?.reasons)
      ? raw.reasons
      : (Array.isArray(raw?.result?.reasons) ? raw.result.reasons : undefined);
    const degraded = Boolean(raw?.degraded ?? raw?.result?.degraded);
    const response = {
      success: raw?.success ?? false,
      result: raw,
      projectState,
      degraded,
      degradedReasons: buildDegradedReasons(reasons)
    };
    if (trace?.traceBuilder) {
      return {
        ...response,
        effectiveOptions: {
          version: 1,
          pillar: "manage",
          command: trace.command,
          scope: trace.scope,
          detail: trace.detail
        },
        decisionTrace: trace.traceBuilder.finalize()
      };
    }
    return response;
  }
}
