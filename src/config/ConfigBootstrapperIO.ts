import fs from "fs";
import path from "path";
import * as crypto from "crypto";
import type { BootstrapApplyResult, ConfigWriteOp, ManageInitArgs } from "./ConfigBootstrapperTypes.js";

export const hashContent = (content: string): string => {
    return crypto.createHash("sha256").update(content).digest("hex");
};

export const readJsonFile = (filePath: string): { value?: any; error?: string; hash?: string } => {
    if (!fs.existsSync(filePath)) {
        return {};
    }
    try {
        const raw = fs.readFileSync(filePath, "utf-8");
        return {
            value: JSON.parse(raw),
            hash: hashContent(raw)
        };
    } catch (error: any) {
        return { error: error?.message ?? "Unknown parse error" };
    }
};

export const deepMerge = (target: any, patch: any): any => {
    if (patch === undefined || patch === null) return target;
    if (typeof patch !== "object" || patch === null) return patch;
    if (Array.isArray(patch)) return patch;
    const output = { ...(target ?? {}) };
    for (const [key, value] of Object.entries(patch)) {
        if (value && typeof value === "object" && !Array.isArray(value)) {
            output[key] = deepMerge((output as any)[key], value);
        } else {
            output[key] = value;
        }
    }
    return output;
};

export const applyPlan = async (
    plan: ConfigWriteOp[],
    options?: ManageInitArgs["applyOptions"]
): Promise<BootstrapApplyResult[]> => {
    const results: BootstrapApplyResult[] = [];
    const backup = options?.backup !== false;
    for (const entry of plan) {
        if (entry.op === "noop") {
            results.push({ path: entry.path, op: entry.op, success: true, message: entry.reason ?? "No changes." });
            continue;
        }
        if (entry.op === "create") {
            if (fs.existsSync(entry.path)) {
                results.push({ path: entry.path, op: entry.op, success: false, message: "File already exists." });
                continue;
            }
            fs.mkdirSync(path.dirname(entry.path), { recursive: true });
            fs.writeFileSync(entry.path, entry.content ?? "", "utf-8");
            results.push({ path: entry.path, op: entry.op, success: true, message: "File created." });
            continue;
        }
        if (entry.op === "mkdir") {
            if (fs.existsSync(entry.path)) {
                const stat = fs.statSync(entry.path);
                if (stat.isDirectory()) {
                    results.push({ path: entry.path, op: entry.op, success: true, message: "Directory already exists." });
                } else {
                    results.push({ path: entry.path, op: entry.op, success: false, message: "Path exists and is not a directory." });
                }
                continue;
            }
            fs.mkdirSync(entry.path, { recursive: true });
            results.push({ path: entry.path, op: entry.op, success: true, message: "Directory created." });
            continue;
        }
        if (entry.op === "update") {
            if (!fs.existsSync(entry.path)) {
                results.push({ path: entry.path, op: entry.op, success: false, message: "File not found." });
                continue;
            }
            const raw = fs.readFileSync(entry.path, "utf-8");
            if (entry.patch?.beforeHash && hashContent(raw) !== entry.patch.beforeHash) {
                results.push({ path: entry.path, op: entry.op, success: false, message: "File changed since plan." });
                continue;
            }
            if (backup) {
                const backupPath = `${entry.path}.bak.${Date.now()}`;
                fs.writeFileSync(backupPath, raw, "utf-8");
            }
            let parsed: any;
            try {
                parsed = JSON.parse(raw);
            } catch {
                results.push({ path: entry.path, op: entry.op, success: false, message: "JSON parse failed." });
                continue;
            }
            const merged = deepMerge(parsed, entry.patch?.jsonMerge ?? {});
            if (entry.patch?.removeKeys && entry.patch.removeKeys.length > 0) {
                for (const key of entry.patch.removeKeys) {
                    delete (merged as any)[key];
                }
            }
            fs.writeFileSync(entry.path, JSON.stringify(merged, null, 2), "utf-8");
            results.push({ path: entry.path, op: entry.op, success: true, message: "File updated." });
            continue;
        }
    }
    return results;
};
