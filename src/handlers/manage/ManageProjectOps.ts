import { StorageMaintenanceService } from "../../indexing/StorageMaintenanceService.js";
import { AuditLog } from "../../utils/AuditLog.js";
import type { ManageHandlerDeps } from "./ManageHandlerUtils.js";
import { handleConfig, handleMetrics, handleMetricsReset, handleStatus } from "./ManageProjectOpsStatus.js";
import { handleDoctor, handleInit, handleSchema } from "./ManageProjectOpsConfig.js";
import { handleSymbolIndexBuild, handleSymbolIndexClear, handleSymbolIndexStatus } from "./ManageProjectOpsSymbol.js";
import { handleReindex } from "./ManageProjectOpsReindex.js";
import { handleDetectRoot, handleSwitchRoot } from "./ManageProjectOpsWorkspace.js";
import {
    handleArtifact,
    handleArtifacts,
    handleDiscard,
    handleHistory,
    handleSession,
    handleSessionComplete,
    handleSessionUpdate,
    handleSessions
} from "./ManageProjectOpsHistory.js";
import { handleExport, handleImport } from "./ManageProjectOpsTransfer.js";

export const manageProjectRaw = async (deps: ManageHandlerDeps, args: any) => {
    const context = deps.context;
    const command = args?.command;
    switch (command) {
        case "undo":
            {
                const result = await context.editCoordinator.undo();
                return { success: result.success, output: result.message ?? "Undo complete.", result };
            }
        case "redo":
            {
                const result = await context.editCoordinator.redo();
                return { success: result.success, output: result.message ?? "Redo complete.", result };
            }
        case "audit":
            {
                const action = args?.action ?? "tail";
                const limit = typeof args?.limit === "number" ? args.limit : 100;
                const since = typeof args?.since === "string" ? args.since : undefined;
                const filter = args?.filter && typeof args.filter === "object" ? args.filter : undefined;
                if (action === "stats") {
                    const stats = await AuditLog.stats();
                    return { success: true, action, stats };
                }
                if (action === "query") {
                    const events = await AuditLog.query({ since, filter, limit });
                    return { success: true, action, events };
                }
                const events = await AuditLog.tail(limit);
                return { success: true, action: "tail", events };
            }
        case "status":
            {
                return handleStatus(deps, args);
            }
        case "metrics":
            {
                return handleMetrics(deps);
            }
        case "metrics_reset":
            {
                return handleMetricsReset();
            }
        case "config":
            {
                return handleConfig();
            }
        case "init":
            {
                return handleInit(deps, args);
            }
        case "doctor":
            {
                return handleDoctor(deps, args);
            }
        case "schema":
            {
                return handleSchema(deps, args);
            }
        case "symbol_index_status":
            {
                return handleSymbolIndexStatus(deps);
            }
        case "symbol_index_build":
            {
                return handleSymbolIndexBuild(deps);
            }
        case "symbol_index_clear":
            {
                return handleSymbolIndexClear(deps);
            }
        case "reindex":
            {
                return handleReindex(deps, args);
            }
        case "switch_root":
            {
                return handleSwitchRoot(deps, args);
            }
        case "detect_root":
            {
                return handleDetectRoot(deps, args);
            }
        case "history":
            {
                return handleHistory(deps, args);
            }
        case "sessions":
            {
                return handleSessions(deps, args);
            }
        case "session":
            {
                return handleSession(deps, args);
            }
        case "session_complete":
            {
                return handleSessionComplete(deps, args);
            }
        case "session_update":
            {
                return handleSessionUpdate(deps, args);
            }
        case "artifacts":
            {
                return handleArtifacts(deps, args);
            }
        case "artifact":
            {
                return handleArtifact(deps, args);
            }
        case "discard":
            {
                return handleDiscard(deps, args);
            }
        case "prune":
            {
                const mode = args?.mode === "plan" ? "plan" : "apply";
                const service = new StorageMaintenanceService(
                    context.indexDatabase,
                    context.documentSearchEngine,
                    context.flowArtifactManager
                );
                return service.prune({
                    mode,
                    targets: args?.pruneOptions?.targets,
                    includeExpired: args?.pruneOptions?.includeExpired,
                    includeStale: args?.pruneOptions?.includeStale,
                    enforceCaps: args?.pruneOptions?.enforceCaps,
                    compact: args?.pruneOptions?.compact,
                    limits: args?.pruneOptions?.limits,
                    flowArtifacts: args?.pruneOptions?.flowArtifacts
                });
            }
        case "export":
            {
                return handleExport(deps, args);
            }
        case "import":
            {
                return handleImport(deps, args);
            }
        default:
            return { success: false, output: `Unknown project_manage command: ${command}` };
    }
};
