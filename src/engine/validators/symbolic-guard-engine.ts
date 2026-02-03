import { AstManager } from "../../ast/AstManager.js";
import { resolveSymbolicGuardConfig, type SymbolicGuardMode } from "../../config/SymbolicGuardConfig.js";
import { EngineManager } from "../../orchestration/capabilities/EngineManager.js";
import { CAP_SYMBOLIC_SOLVE } from "../../orchestration/capabilities/CapabilityIds.js";
import type { ISymbolicSolverProvider, SymbolicSolverConstraint } from "../../orchestration/capabilities/SymbolicSolver.js";
import { metrics } from "../../utils/MetricsCollector.js";
import {
    extractIndexFallbacks,
    extractIndexFromSubscript,
    extractNodeText,
    hasIndexGuard,
    hasNullGuard,
    hasZeroGuard,
    isLiteralZero,
    isNullLiteral,
    isSimpleIdentifier,
    positionFromIndex,
    resolveIndexNode,
    scopeKeyForNode
} from "./SymbolicGuardUtils.js";

export type SymbolicGuardSeverity = "warn" | "high";

export type SymbolicGuardDiagnostic = {
    code: string;
    severity: SymbolicGuardSeverity;
    message: string;
    filePath?: string;
    line?: number;
    column?: number;
    evidence?: { snippet?: string; note?: string };
};

export type SymbolicGuardStats = {
    durationMs: number;
    queryUsed: boolean;
    solverUsed: boolean;
    constraintsBuilt?: number;
    pathsExplored?: number;
};

export type SymbolicGuardResult = {
    enabled: boolean;
    mode: SymbolicGuardMode;
    diagnostics: SymbolicGuardDiagnostic[];
    degradedReasons?: string[];
    stats: SymbolicGuardStats;
};

type GuardCapture = { name: string; node: any };

export class SymbolicGuardEngine {
    public async evaluate(args: { filePath: string; content: string }): Promise<SymbolicGuardResult> {
        const start = Date.now();
        const config = resolveSymbolicGuardConfig();
        const mode: SymbolicGuardMode = config.enabled ? config.mode : "off";
        const diagnostics: SymbolicGuardDiagnostic[] = [];
        const degradedReasons: string[] = [];

        if (!config.enabled || mode === "off") {
            return {
                enabled: false,
                mode,
                diagnostics,
                degradedReasons: ["symbolic_guards_disabled"],
                stats: { durationMs: Date.now() - start, queryUsed: false, solverUsed: false }
            };
        }

        const astManager = AstManager.getInstance();
        const languageId = astManager.getLanguageId(args.filePath);
        if (!astManager.supportsQueries()) {
            return {
                enabled: true,
                mode,
                diagnostics,
                degradedReasons: ["symbolic_query_missing"],
                stats: { durationMs: Date.now() - start, queryUsed: false, solverUsed: false }
            };
        }

        const language = await astManager.getLanguageForFile(args.filePath);
        if (!language) {
            return {
                enabled: true,
                mode,
                diagnostics,
                degradedReasons: ["unsupported_language"],
                stats: { durationMs: Date.now() - start, queryUsed: false, solverUsed: false }
            };
        }

        const query = await astManager.getQueryProvider().getQuery(language, languageId, "guards");
        if (!query) {
            return {
                enabled: true,
                mode,
                diagnostics,
                degradedReasons: ["symbolic_query_missing"],
                stats: { durationMs: Date.now() - start, queryUsed: false, solverUsed: false }
            };
        }

        let doc: any;
        try {
            doc = await astManager.parseFile(args.filePath, args.content);
            const captures = query.captures(doc.rootNode) as GuardCapture[];
            const guardTextsByScope = new Map<string, string[]>();
            const indexAccesses: Array<{ node: any; scopeKey: string }> = [];
            const derefAccesses: Array<{ node: any; scopeKey: string }> = [];
            const binaryExpressions: Array<{ node: any; scopeKey: string }> = [];
            const solverConstraints: SymbolicSolverConstraint[] = [];

            const pushSolverConstraint = (
                kind: SymbolicSolverConstraint["kind"],
                node: any,
                scopeKey: string
            ) => {
                if (solverConstraints.length >= config.maxConstraints) return;
                const text = extractNodeText(node, args.content).trim();
                if (!text) return;
                const position = node.startPosition;
                solverConstraints.push({
                    kind,
                    text: text.slice(0, 200),
                    scopeKey,
                    line: position?.row ? position.row + 1 : 0,
                    column: position?.column ? position.column + 1 : 0
                });
            };

            let constraintsBuilt = 0;
            for (const capture of captures) {
                if (Date.now() - start > config.timeoutMs) {
                    degradedReasons.push("symbolic_budget_exceeded");
                    break;
                }
                const scopeKey = scopeKeyForNode(capture.node);
                if (!guardTextsByScope.has(scopeKey) && guardTextsByScope.size >= config.maxPaths) {
                    degradedReasons.push("symbolic_budget_exceeded");
                    continue;
                }
                switch (capture.name) {
                    case "guard.condition":
                    case "guard.null_check": {
                        const text = extractNodeText(capture.node, args.content);
                        if (!text) break;
                        const list = guardTextsByScope.get(scopeKey) ?? [];
                        if (list.length < config.maxConstraints) {
                            list.push(text);
                            guardTextsByScope.set(scopeKey, list);
                            constraintsBuilt += 1;
                        }
                        pushSolverConstraint("guard", capture.node, scopeKey);
                        break;
                    }
                    case "guard.index_access":
                        if (indexAccesses.length < config.maxConstraints) {
                            indexAccesses.push({ node: capture.node, scopeKey });
                        }
                        pushSolverConstraint("index_access", capture.node, scopeKey);
                        break;
                    case "guard.deref":
                        if (derefAccesses.length < config.maxConstraints) {
                            derefAccesses.push({ node: capture.node, scopeKey });
                        }
                        pushSolverConstraint("deref", capture.node, scopeKey);
                        break;
                    case "guard.binary":
                        if (binaryExpressions.length < config.maxConstraints) {
                            binaryExpressions.push({ node: capture.node, scopeKey });
                        }
                        pushSolverConstraint("binary", capture.node, scopeKey);
                        break;
                    default:
                        break;
                }
            }

            const pushDiagnostic = (diag: SymbolicGuardDiagnostic) => {
                if (diagnostics.length >= config.maxDiagnostics) {
                    degradedReasons.push("symbolic_budget_exceeded");
                    return;
                }
                diagnostics.push(diag);
            };

            const indexRule = config.rules.index_bounds;
            if (indexRule?.enabled) {
                if (indexAccesses.length === 0) {
                    const fallbacks = extractIndexFallbacks(args.content, config.maxConstraints);
                    for (const fallback of fallbacks) {
                        const guardTexts: string[] = [];
                        const guarded = hasIndexGuard(fallback.indexText, guardTexts);
                        if (!guarded && isSimpleIdentifier(fallback.indexText)) {
                            const position = positionFromIndex(args.content, fallback.startIndex);
                            pushDiagnostic({
                                code: "index_bounds",
                                severity: indexRule.severity,
                                message: `Index access uses '${fallback.indexText}' without an obvious bounds guard.`,
                                filePath: args.filePath,
                                line: position.line,
                                column: position.column,
                                evidence: { snippet: fallback.snippet }
                            });
                        }
                    }
                }
                for (const access of indexAccesses) {
                    if (Date.now() - start > config.timeoutMs) {
                        degradedReasons.push("symbolic_budget_exceeded");
                        break;
                    }
                    const indexNode = resolveIndexNode(access.node);
                    let indexText = extractNodeText(indexNode ?? access.node, args.content).trim();
                    if (!indexText || !isSimpleIdentifier(indexText)) {
                        const fallback = extractIndexFromSubscript(extractNodeText(access.node, args.content));
                        if (fallback) {
                            indexText = fallback;
                        }
                    }
                    if (!indexText) continue;
                    const guardTexts = guardTextsByScope.get(access.scopeKey) ?? [];
                    const guarded = hasIndexGuard(indexText, guardTexts);
                    if (!guarded && isSimpleIdentifier(indexText)) {
                        const position = indexNode?.startPosition ?? access.node.startPosition;
                        pushDiagnostic({
                            code: "index_bounds",
                            severity: indexRule.severity,
                            message: `Index access uses '${indexText}' without an obvious bounds guard.`,
                            filePath: args.filePath,
                            line: position?.row ? position.row + 1 : 0,
                            column: position?.column ? position.column + 1 : 0,
                            evidence: {
                                snippet: extractNodeText(access.node, args.content).slice(0, 160)
                            }
                        });
                    }
                }
            }

            const divRule = config.rules.division_by_zero;
            if (divRule?.enabled) {
                for (const expr of binaryExpressions) {
                    if (Date.now() - start > config.timeoutMs) {
                        degradedReasons.push("symbolic_budget_exceeded");
                        break;
                    }
                    const leftNode = expr.node.childForFieldName?.("left");
                    const rightNode = expr.node.childForFieldName?.("right");
                    if (!leftNode || !rightNode) continue;
                    const operatorText = args.content.slice(leftNode.endIndex, rightNode.startIndex).trim();
                    if (operatorText !== "/" && operatorText !== "%") continue;
                    const denomText = extractNodeText(rightNode, args.content).trim();
                    const guardTexts = guardTextsByScope.get(expr.scopeKey) ?? [];
                    if (isLiteralZero(denomText)) {
                        const position = rightNode.startPosition ?? expr.node.startPosition;
                        pushDiagnostic({
                            code: "division_by_zero",
                            severity: divRule.severity,
                            message: "Division by zero detected.",
                            filePath: args.filePath,
                            line: position?.row ? position.row + 1 : 0,
                            column: position?.column ? position.column + 1 : 0,
                            evidence: { snippet: extractNodeText(expr.node, args.content).slice(0, 160) }
                        });
                        continue;
                    }
                    if (isSimpleIdentifier(denomText) && !hasZeroGuard(denomText, guardTexts)) {
                        const position = rightNode.startPosition ?? expr.node.startPosition;
                        pushDiagnostic({
                            code: "division_by_zero",
                            severity: divRule.severity,
                            message: `Division uses '${denomText}' without an obvious non-zero guard.`,
                            filePath: args.filePath,
                            line: position?.row ? position.row + 1 : 0,
                            column: position?.column ? position.column + 1 : 0,
                            evidence: { snippet: extractNodeText(expr.node, args.content).slice(0, 160) }
                        });
                    }
                }
            }

            const nullRule = config.rules.null_deref_without_guard;
            if (nullRule?.enabled) {
                for (const access of derefAccesses) {
                    if (Date.now() - start > config.timeoutMs) {
                        degradedReasons.push("symbolic_budget_exceeded");
                        break;
                    }
                    const objectNode = access.node.childForFieldName?.("object");
                    if (!objectNode) continue;
                    const objectText = extractNodeText(objectNode, args.content).trim();
                    const guardTexts = guardTextsByScope.get(access.scopeKey) ?? [];
                    if (isNullLiteral(objectText)) {
                        const position = objectNode.startPosition ?? access.node.startPosition;
                        pushDiagnostic({
                            code: "null_deref_without_guard",
                            severity: nullRule.severity,
                            message: "Null/undefined dereference detected.",
                            filePath: args.filePath,
                            line: position?.row ? position.row + 1 : 0,
                            column: position?.column ? position.column + 1 : 0,
                            evidence: { snippet: extractNodeText(access.node, args.content).slice(0, 160) }
                        });
                        continue;
                    }
                    if (isSimpleIdentifier(objectText) && !hasNullGuard(objectText, guardTexts)) {
                        const position = objectNode.startPosition ?? access.node.startPosition;
                        pushDiagnostic({
                            code: "null_deref_without_guard",
                            severity: nullRule.severity,
                            message: `Dereference of '${objectText}' without an obvious null guard.`,
                            filePath: args.filePath,
                            line: position?.row ? position.row + 1 : 0,
                            column: position?.column ? position.column + 1 : 0,
                            evidence: { snippet: extractNodeText(access.node, args.content).slice(0, 160) }
                        });
                    }
                }
            }

            const ruleCodesSnapshot = new Set(diagnostics.map((diag) => String(diag.code)));
            let solverUsed = false;
            let solverStats: { durationMs?: number; pathsExplored?: number; constraintsBuilt?: number } | undefined;
            if (mode === "strict" && config.solver.enabled) {
                const provider = EngineManager.getProvider<ISymbolicSolverProvider>(CAP_SYMBOLIC_SOLVE, { preferredTier: "native" });
                if (!provider) {
                    degradedReasons.push("solver_unavailable");
                } else {
                    const stopTimer = metrics.startTimer("symbolic_solver.duration_ms", "detailed");
                    try {
                        metrics.inc("symbolic_solver.used", 1, "detailed");
                        const solverResult = await provider.solve({
                            filePath: args.filePath,
                            content: args.content,
                            constraints: solverConstraints,
                            maxPaths: config.maxPaths,
                            maxConstraints: config.maxConstraints,
                            timeSliceMs: config.solver.timeSliceMs
                        });
                        solverUsed = true;
                        solverStats = solverResult.stats;
                        if (Array.isArray(solverResult.degradedReasons)) {
                            degradedReasons.push(...solverResult.degradedReasons);
                        }
                        const solverDiagnostics = solverResult.diagnostics ?? [];
                        metrics.inc("symbolic_solver.diagnostics", solverDiagnostics.length, "detailed");
                        const solverCodes = new Set(solverDiagnostics.map((diag) => String(diag.code)));
                        const solverOnly = Array.from(solverCodes).filter((code) => !ruleCodesSnapshot.has(code)).length;
                        const ruleOnly = Array.from(ruleCodesSnapshot).filter((code) => !solverCodes.has(code)).length;
                        metrics.inc("symbolic_solver.rule_only_missed", solverOnly, "detailed");
                        metrics.inc("symbolic_solver.solver_only_missed", ruleOnly, "detailed");
                        for (const diag of solverDiagnostics) {
                            const ruleEnabled = config.rules[diag.code]?.enabled;
                            if (ruleEnabled === false) {
                                continue;
                            }
                            const normalized: SymbolicGuardDiagnostic = {
                                code: diag.code,
                                severity: diag.severity,
                                message: diag.message,
                                filePath: diag.filePath ?? args.filePath,
                                line: diag.line ?? 0,
                                column: diag.column ?? 0,
                                evidence: diag.evidence
                            };
                            pushDiagnostic(normalized);
                        }
                        stopTimer();
                    } catch {
                        stopTimer();
                        degradedReasons.push("solver_unavailable");
                    }
                }
            }

            const mergedConstraints = Math.max(constraintsBuilt, solverConstraints.length, solverStats?.constraintsBuilt ?? 0);
            const pathsExplored = Math.max(guardTextsByScope.size, solverStats?.pathsExplored ?? 0);

            return {
                enabled: true,
                mode,
                diagnostics,
                degradedReasons: degradedReasons.length > 0 ? degradedReasons : undefined,
                stats: {
                    durationMs: Date.now() - start,
                    queryUsed: true,
                    solverUsed,
                    constraintsBuilt: mergedConstraints,
                    pathsExplored
                }
            };
        } catch {
            return {
                enabled: true,
                mode,
                diagnostics,
                degradedReasons: ["symbolic_query_missing"],
                stats: { durationMs: Date.now() - start, queryUsed: false, solverUsed: false }
            };
        } finally {
            doc?.dispose?.();
        }
    }
}
