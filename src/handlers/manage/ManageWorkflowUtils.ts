import type { HandlerContext } from "../HandlerContext.js";
import type { ArtifactManagerStatus, FlowArtifact, FlowSession } from "../../types/flow-artifacts.js";
import type { ToolSpec } from "../../server/tools/ToolSpecRegistry.js";

export const buildWorkflowSummary = (context: HandlerContext) => {
    const manager = context.flowArtifactManager;
    if (!manager) {
        return {};
    }
    const sessions = manager.listSessions(1);
    const currentSession = sessions[0]
        ? buildCurrentSessionSummary(context, sessions[0])
        : undefined;
    const artifacts = manager.listArtifacts();
    const artifactSummary = buildArtifactSummary(artifacts, manager.status());
    const styleDrift = buildStyleDriftStatus(manager);
    const recommendedActions = buildRecommendedActions(
        currentSession,
        artifactSummary,
        manager.status(),
        styleDrift?.suggestedActions
    );
    return { currentSession, artifactSummary, recommendedActions, styleDrift };
};

export const buildCurrentSessionSummary = (context: HandlerContext, session: FlowSession) => {
    const artifacts = context.flowArtifactManager.getBySession(session.id);
    const lastArtifact = artifacts
        .sort((a, b) => b.createdAt - a.createdAt)[0];
    const lastToolSummary = lastArtifact
        ? {
            tool: mapArtifactToTool(lastArtifact.type),
            outcome: "created",
            latencyMs: typeof lastArtifact.metadata?.latencyMs === "number" ? lastArtifact.metadata.latencyMs : undefined,
            degradedReasons: Array.isArray(lastArtifact.metadata?.degradedReasons) ? lastArtifact.metadata.degradedReasons : undefined
        }
        : undefined;
    return {
        sessionId: session.id,
        state: mapSessionState(session.status),
        lastActivityAt: new Date(session.updatedAt ?? session.startedAt).toISOString(),
        lastToolSummary
    };
};

export const buildArtifactSummary = (artifacts: FlowArtifact[], status: ArtifactManagerStatus) => {
    const expiringThresholdMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const expiringSoon = artifacts
        .filter((artifact) => typeof artifact.expiresAt === "number" && artifact.expiresAt > now)
        .filter((artifact) => (artifact.expiresAt ?? 0) - now <= expiringThresholdMs)
        .sort((a, b) => (a.expiresAt ?? 0) - (b.expiresAt ?? 0));
    const expiringItems = expiringSoon.slice(0, 5).map((artifact) => ({
        id: artifact.id,
        type: artifact.type,
        sessionId: artifact.sessionId,
        expiresAt: artifact.expiresAt
    }));
    const bytesUsed = artifacts.reduce((total, artifact) => {
        try {
            return total + Buffer.byteLength(JSON.stringify(artifact));
        } catch {
            return total;
        }
    }, 0);
    return {
        countsByType: status.byType,
        expiringSoon: expiringItems,
        expiringSoonTotal: expiringSoon.length,
        storage: {
            bytesUsed
        }
    };
};

export const buildStyleDriftStatus = (manager: { getByType: (type: any) => FlowArtifact[] }) => {
    const styleArtifacts = manager.getByType("style");
    if (!styleArtifacts || styleArtifacts.length === 0) {
        return {
            available: false,
            status: "missing",
            message: "No StylePack artifacts found.",
            suggestedActions: [
                {
                    actionId: "understand.vibe.extract",
                    reasonCode: "style_pack_missing",
                    toolCall: {
                        tool: "understand",
                        args: { vibe: { extract: true } }
                    },
                    risk: "low" as const
                }
            ]
        };
    }
    const latest = styleArtifacts.sort((a, b) => b.createdAt - a.createdAt)[0];
    const pack = (latest as any).pack;
    const configDetections = Array.isArray(pack?.configDetections) ? pack.configDetections : [];
    const references = Array.isArray(pack?.references) ? pack.references : [];
    const referenceFiles = new Set(references.map((entry: any) => entry?.filePath).filter((value: any) => typeof value === "string"));
    const hasGroundedRefs = references.length >= 3 && referenceFiles.size >= 2;
    const grounded = configDetections.length > 0 || hasGroundedRefs;
    const confidence = typeof pack?.confidence === "number" ? pack.confidence : undefined;
    const status = grounded ? "grounded" : "unverified";
    const suggestedActions = grounded
        ? []
        : [
            {
                actionId: "understand.vibe.extract",
                reasonCode: "style_pack_low_confidence",
                toolCall: {
                    tool: "understand",
                    args: { vibe: { extract: true } }
                },
                risk: "low" as const
            }
        ];
    return {
        available: true,
        status,
        confidence,
        scope: pack?.scope,
        configDetections: configDetections.length,
        references: references.length,
        referenceFiles: referenceFiles.size,
        grounded,
        suggestedActions
    };
};

export const buildRecommendedActions = (
    currentSession: { sessionId: string; state: string; lastActivityAt: string } | undefined,
    artifactSummary: { expiringSoon: Array<{ id: string }>; expiringSoonTotal: number } | undefined,
    status: ArtifactManagerStatus,
    extraActions?: Array<{ actionId: string; reasonCode: string; toolCall: { tool: string; args: any }; risk: "low" | "med" | "high" }>
): Array<{ actionId: string; reasonCode: string; toolCall: { tool: string; args: any }; risk: "low" | "med" | "high" }> => {
    const actions: Array<{ actionId: string; reasonCode: string; toolCall: { tool: string; args: any }; risk: "low" | "med" | "high" }> = [];
    const expiring = artifactSummary?.expiringSoon ?? [];
    if (expiring.length > 0) {
        actions.push({
            actionId: "manage.export",
            reasonCode: "artifact_expiring_soon",
            toolCall: {
                tool: "manage",
                args: { command: "export", targetType: "artifact", target: expiring[0].id }
            },
            risk: "med"
        });
    }
    if (status.cacheUtilization >= 0.8) {
        actions.push({
            actionId: "manage.prune",
            reasonCode: "artifact_cache_pressure",
            toolCall: {
                tool: "manage",
                args: { command: "prune", mode: "plan", pruneOptions: { includeExpired: true } }
            },
            risk: "low"
        });
    }
    if (currentSession?.state === "active") {
        const lastActivityMs = Date.parse(currentSession.lastActivityAt);
        const idleThresholdMs = 30 * 60 * 1000;
        if (Number.isFinite(lastActivityMs) && Date.now() - lastActivityMs > idleThresholdMs) {
            actions.push({
                actionId: "manage.session_complete",
                reasonCode: "session_idle",
                toolCall: {
                    tool: "manage",
                    args: { command: "session_complete", target: currentSession.sessionId }
                },
                risk: "low"
            });
        }
    }
    if (Array.isArray(extraActions) && extraActions.length > 0) {
        actions.push(...extraActions);
    }
    return actions.slice(0, 5);
};

export const mapArtifactToTool = (type: FlowArtifact["type"]): string => {
    if (type === "research") return "explore";
    if (type === "analysis" || type === "style") return "understand";
    if (type === "draft" || type === "review") return "change";
    return "manage";
};

export const resolveToolSpec = (context: HandlerContext, toolName: string): ToolSpec | undefined => {
    return context.toolSpecRegistry?.get(toolName);
};

export const buildSchemaSummary = (toolSpec: ToolSpec): {
    tool: string;
    schemaVersion: string;
    description?: string;
    required: string[];
    properties: Array<{ name: string; type?: string; enum?: unknown[]; description?: string }>;
    propertyCount: number;
    additionalProperties?: boolean;
    truncated: boolean;
} => {
    const schema = toolSpec.inputSchema ?? { type: "object", properties: {} };
    const properties = schema.properties ?? {};
    const entries = Object.entries(properties).map(([name, value]) => {
        const detail = value && typeof value === "object" ? value as Record<string, unknown> : {};
        const type = typeof detail.type === "string"
            ? detail.type
            : (Array.isArray(detail.enum) ? "enum" : (Array.isArray(detail.anyOf) ? "anyOf" : "object"));
        const entry: { name: string; type?: string; enum?: unknown[]; description?: string } = { name, type };
        if (Array.isArray(detail.enum)) {
            entry.enum = detail.enum.slice(0, 12);
        }
        if (typeof detail.description === "string") {
            entry.description = detail.description;
        }
        return entry;
    });
    const limited = entries.slice(0, 50);
    return {
        tool: toolSpec.name,
        schemaVersion: toolSpec.schemaVersion,
        description: toolSpec.description,
        required: Array.isArray(schema.required) ? schema.required : [],
        properties: limited,
        propertyCount: entries.length,
        additionalProperties: schema.additionalProperties === true,
        truncated: entries.length > limited.length
    };
};

export const generateSchemaArtifactId = (nowMs: number): string => {
    const suffix = Math.random().toString(36).slice(2, 8);
    return `schema_${nowMs.toString(36)}_${suffix}`;
};

export const mapSessionState = (status: FlowSession["status"]): "active" | "idle" | "completed" | "degraded" => {
    if (status === "completed") return "completed";
    if (status === "abandoned") return "idle";
    return "active";
};
