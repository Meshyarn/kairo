import path from "path";
import * as fs from "fs";
import { OrchestrationContext } from "../../OrchestrationContext.js";
import { InternalToolRegistry } from "../../InternalToolRegistry.js";
import { UnifiedContextGraph } from "../../context/UnifiedContextGraph.js";
import { AstManager } from "../../../ast/AstManager.js";
import { checkQuerySupport, checkSkeletonSupport } from "../../../ast/LanguageSupportSignals.js";
import { SyntaxValidator } from "../../../engine/validators/syntax-validator.js";
import { getSupportForFilePath, SupportLevel } from "../../../config/LanguageSupportLevels.js";
import { TopologyInfo } from "../../../types.js";
import { ExploreItem, truncate } from "./ResultFormatter.js";
import { isDocPath, isGlob } from "./FilteringStrategy.js";

const DEFAULT_DEPTH = 5;

export async function expandPaths(
    paths: string[],
    options: { allowGlobs: boolean; maxFiles: number; includeDocs: boolean; includeCode: boolean },
    registry: InternalToolRegistry
): Promise<{ entries: Array<{ path: string; mtime?: number; size?: number }>; blocked?: boolean; message?: string }> {
    const entries: Array<{ path: string; mtime?: number; size?: number }> = [];
    const seen = new Set<string>();

    for (const rawPath of paths) {
        if (isGlob(rawPath) && !options.allowGlobs) {
            return { entries: [], blocked: true, message: `Glob patterns are not allowed: ${rawPath}` };
        }

        if (isGlob(rawPath) && options.allowGlobs) {
            try {
                const matches = await registry.execute("file_search", {
                    patterns: [rawPath],
                    groupByFile: true,
                    deduplicateByContent: true,
                    maxResults: options.maxFiles
                });
                for (const item of matches ?? []) {
                    const filePath = item?.filePath;
                    if (!filePath || seen.has(filePath)) continue;
                    seen.add(filePath);
                    const stat = await registry.execute("file_stat", { path: filePath });
                    entries.push({ path: filePath, mtime: stat?.mtime, size: stat?.size });
                    if (entries.length >= options.maxFiles) break;
                }
            } catch {
                continue;
            }
            continue;
        }

        const listed = await registry.execute("file_list", {
            basePath: rawPath,
            depth: DEFAULT_DEPTH,
            maxFiles: options.maxFiles
        });
        for (const item of listed ?? []) {
            const filePath = item?.path;
            if (!filePath || seen.has(filePath)) continue;
            seen.add(filePath);
            entries.push({ path: filePath, mtime: item?.mtime, size: item?.size });
            if (entries.length >= options.maxFiles) break;
        }
        if (entries.length >= options.maxFiles) break;
    }

    return { entries };
}

export async function collectTopologyMetadata(
    ucg: UnifiedContextGraph | undefined,
    filePath: string
): Promise<{ topology?: TopologyInfo; lod?: number; dependencyCount?: number; dependents?: number }> {
    if (!filePath) {
        return {};
    }

    const astManager = AstManager.getInstance();
    let topology: TopologyInfo | undefined;
    let lod = 0;

    if (ucg) {
        try {
            await ucg.ensureLOD({ path: filePath, minLOD: 1 });
            const node = ucg.getNode(filePath);
            if (node && node.topology) {
                topology = node.topology;
                lod = node.lod;
            }
        } catch (error) {
            console.debug('[PathExpansion] UCG LOD promotion failed:', error);
        }
    }

    if (!topology) {
        try {
            const content = fs.readFileSync(filePath, "utf-8");
            topology = await astManager.extractUniversalTopology(filePath, content);
            lod = 1;
        } catch (error) {
            console.debug('[PathExpansion] Direct topology extraction failed:', error);
        }
    }

    if (!topology) {
        return {};
    }

    return {
        topology,
        lod,
        dependencyCount: topology.imports?.length ?? (ucg?.getNode(filePath)?.dependencies?.size),
        dependents: ucg?.getNode(filePath)?.dependents?.size
    };
}

export async function buildItemForPath(
    filePath: string,
    options: {
        view: "auto" | "preview" | "section" | "full";
        maxChars: number;
        maxItemChars: number;
        allowSensitive: boolean;
        allowBinary: boolean;
        wantsFull: boolean;
        section?: { sectionId?: string; headingPath?: string[]; includeSubsections?: boolean };
    },
    context: OrchestrationContext,
    runTool: (context: OrchestrationContext, tool: string, args: any) => Promise<any>
): Promise<{ value?: ExploreItem; degraded?: boolean; reason?: string; blocked?: boolean; message?: string }> {
    const docPath = isDocPath(filePath);
    const safePreview = (value: string) => truncate(value ?? "", options.maxItemChars);

    if (options.wantsFull) {
        if (docPath) {
            const section = options.section ?? {};
            const result = await runTool(context, "document_section", {
                filePath,
                sectionId: section.sectionId,
                headingPath: section.headingPath,
                includeSubsections: section.includeSubsections === true,
                mode: "raw",
                maxChars: options.maxChars
            });
            if (result?.truncated) {
                return { blocked: true, message: `Full read blocked by maxChars for ${filePath}.` };
            }
            return {
                value: {
                    kind: "file_full",
                    filePath,
                    content: result?.content ?? "",
                    range: result?.section?.range ? { startLine: result.section.range.startLine, endLine: result.section.range.endLine } : undefined,
                    why: ["document_section"]
                }
            };
        }

        const content = await runTool(context, "code_read", { filePath, view: "full" });
        const text = typeof content === "string" ? content : "";
        if (text.length > options.maxChars) {
            return { blocked: true, message: `Full read blocked by maxChars for ${filePath}.` };
        }
        return {
            value: {
                kind: "file_full",
                filePath,
                content: text,
                why: ["code_read"]
            }
        };
    }

    if (docPath) {
        const section = options.section ?? {};
        if (section.sectionId || section.headingPath) {
            const result = await runTool(context, "document_section", {
                filePath,
                sectionId: section.sectionId,
                headingPath: section.headingPath,
                includeSubsections: section.includeSubsections === true,
                mode: "preview",
                maxChars: options.maxItemChars
            });
            const preview = safePreview(result?.content ?? "");
            return {
                value: {
                    kind: "document_section",
                    filePath,
                    preview,
                    range: result?.section?.range ? { startLine: result.section.range.startLine, endLine: result.section.range.endLine } : undefined,
                    why: ["document_section"]
                },
                degraded: result?.truncated === true,
                reason: result?.truncated === true ? "truncated" : undefined
            };
        }
        const skeleton = await runTool(context, "document_skeleton", { filePath });
        const preview = safePreview(skeleton?.skeleton ?? "");
        return {
            value: {
                kind: "file_preview",
                filePath,
                preview,
                why: ["document_skeleton"]
            }
        };
    }

    const supportSpec = getSupportForFilePath(filePath);
    let l3Content: string | undefined;
    let queryDegraded = false;
    let queryReason: string | undefined;

    if (supportSpec?.level === SupportLevel.L3) {
        const requiredQueries = supportSpec.editPolicy.requireQueries ?? [];
        if (requiredQueries.length > 0) {
            const querySupport = await checkQuerySupport(filePath, requiredQueries, { required: true });
            if (querySupport.degraded) {
                if (querySupport.reason === "missing_query_pack") {
                    const languageId = AstManager.getInstance().getLanguageId(filePath);
                    const missing = Array.isArray(querySupport.missing) ? querySupport.missing : [];
                    const missingSummary = missing.length > 0 ? ` (${missing.join(", ")})` : "";
                    return {
                        blocked: true,
                        message: `Missing query pack for ${languageId}${missingSummary}.`,
                        reason: querySupport.reason
                    };
                }
                queryDegraded = true;
                queryReason = querySupport.reason;
            }
        }

        if (supportSpec.editPolicy.requireSyntaxValidation) {
            try {
                l3Content = fs.readFileSync(path.resolve(filePath), "utf-8");
            } catch {
                if (options.wantsFull) {
                    return {
                        blocked: true,
                        message: `Unable to read ${filePath} for syntax validation.`,
                        reason: "syntax_validation_failed"
                    };
                } else {
                    // Fallback to tool-based read if direct FS read fails (common in tests)
                    try {
                        const toolContent = await runTool(context, "code_read", { filePath, view: "full" });
                        l3Content = typeof toolContent === "string" ? toolContent : undefined;
                    } catch {
                        l3Content = undefined;
                    }

                    if (!l3Content) {
                        return {
                            value: {
                                kind: "file_preview",
                                filePath,
                                preview: "(content unavailable)",
                                why: ["code_read"]
                            },
                            degraded: true,
                            reason: "syntax_validation_failed"
                        };
                    }
                }
            }

            if (l3Content) {
                const validator = new SyntaxValidator();
                const validation = await validator.validate(filePath, l3Content);
                if (!validation.success) {
                    const codes = (validation.blockingErrors ?? []).map((error) => error.code);
                    const hasSyntaxError = codes.includes("SYNTAX_ERROR");
                    const hasValidatorUnavailable = codes.includes("SYNTAX_VALIDATOR_UNAVAILABLE");
                    const hasLanguageUnavailable = codes.includes("SYNTAX_LANGUAGE_UNAVAILABLE");

                    if (hasSyntaxError && !options.wantsFull) {
                        return {
                            blocked: true,
                            message: `Syntax validation failed for ${filePath}.`,
                            reason: "syntax_validation_failed"
                        };
                    }

                    queryDegraded = true;
                    if (hasValidatorUnavailable) {
                        queryReason = "missing_syntax_validator";
                    } else if (hasLanguageUnavailable) {
                        queryReason = "missing_wasm_grammar";
                    } else {
                        queryReason = "syntax_validation_failed";
                    }
                }
            }
        }
    }

    const support = await checkSkeletonSupport(filePath);
    const content = await runTool(context, "code_read", { filePath, view: "skeleton" });
    const preview = safePreview(typeof content === "string" ? content : "");
    return {
        value: {
            kind: "file_preview",
            filePath,
            preview,
            why: ["code_read"]
        },
        degraded: support.degraded || queryDegraded,
        reason: support.reason || queryReason
    };
}
