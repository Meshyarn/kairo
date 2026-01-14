import { promises as fs } from "fs";
import * as path from "path";
import crypto from "crypto";
import { PathManager } from "./PathManager.js";

export type AuditEvent = {
    id?: string;
    ts?: string;
    actor?: string;
    pillar: "change" | "write" | "edit_apply" | "manage";
    operation: "plan" | "apply" | "dry_run" | "override_check" | "audit_query";
    decision?: "accepted" | "rejected" | "expired" | "out_of_scope";
    reason?: string;
    ticket?: string;
    scope?: { fileGlobs?: string[]; repoIds?: string[]; maxFiles?: number };
    requested?: Record<string, unknown>;
    effective?: Record<string, unknown>;
    targetFiles?: string[];
    result?: { success: boolean; status?: string; errorCode?: string; transactionId?: string };
};

type AuditQueryFilter = {
    approvedBy?: string;
    pillar?: string;
    decision?: string;
    overrideKind?: string;
};

export class AuditLog {
    static async append(event: AuditEvent): Promise<string> {
        const auditDir = PathManager.getAuditDir();
        await fs.mkdir(auditDir, { recursive: true });
        const id = event.id ?? crypto.randomUUID();
        const payload = {
            ...event,
            id,
            ts: event.ts ?? new Date().toISOString()
        };
        const line = `${JSON.stringify(payload)}\n`;
        await fs.appendFile(PathManager.getAuditLogPath(), line, "utf-8");
        return id;
    }

    static async tail(limit: number = 100): Promise<AuditEvent[]> {
        const lines = await AuditLog.readLines();
        return lines.slice(-limit);
    }

    static async query(params: {
        since?: string;
        filter?: AuditQueryFilter;
        limit?: number;
    }): Promise<AuditEvent[]> {
        const lines = await AuditLog.readLines();
        const since = params.since ? Date.parse(params.since) : undefined;
        const limit = params.limit ?? 100;
        const filter = params.filter;
        const results: AuditEvent[] = [];
        for (const entry of lines) {
            if (since && entry.ts) {
                const ts = Date.parse(entry.ts);
                if (Number.isFinite(ts) && ts < since) {
                    continue;
                }
            }
            if (filter && !AuditLog.matchesFilter(entry, filter)) {
                continue;
            }
            results.push(entry);
            if (results.length >= limit) break;
        }
        return results;
    }

    static async stats(): Promise<{ total: number; lastEventAt?: string }> {
        const lines = await AuditLog.readLines();
        const last = lines[lines.length - 1];
        return {
            total: lines.length,
            lastEventAt: last?.ts
        };
    }

    private static matchesFilter(entry: AuditEvent, filter: AuditQueryFilter): boolean {
        if (filter.approvedBy && entry.actor !== filter.approvedBy) {
            return false;
        }
        if (filter.pillar && entry.pillar !== filter.pillar) {
            return false;
        }
        if (filter.decision && entry.decision !== filter.decision) {
            return false;
        }
        if (filter.overrideKind) {
            const requested = entry.requested ?? {};
            if (!(filter.overrideKind in requested)) {
                return false;
            }
        }
        return true;
    }

    private static async readLines(): Promise<AuditEvent[]> {
        const filePath = PathManager.getAuditLogPath();
        try {
            const raw = await fs.readFile(filePath, "utf-8");
            return raw
                .split("\n")
                .map(line => line.trim())
                .filter(Boolean)
                .map(line => {
                    try {
                        return JSON.parse(line) as AuditEvent;
                    } catch {
                        return null;
                    }
                })
                .filter((entry): entry is AuditEvent => Boolean(entry));
        } catch {
            return [];
        }
    }
}
