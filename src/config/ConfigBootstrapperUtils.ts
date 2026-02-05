import path from "path";
import { PathManager } from "../utils/PathManager.js";
import { DEFAULT_MAX_FILES } from "./ConfigBootstrapperDefaults.js";
import type {
    BootstrapMode,
    BootstrapTarget,
    ConfigFinding,
    ConfigWriteOp,
    HostPreset,
    ManageDoctorArgs,
    ManageInitArgs
} from "./ConfigBootstrapperTypes.js";

export const resolveMode = (args: ManageInitArgs | ManageDoctorArgs): BootstrapMode => {
    if ((args as ManageInitArgs).mode === "apply") return "apply";
    if ((args as any).apply === true) return "apply";
    return "plan";
};

export const resolveTargets = (args: ManageInitArgs | ManageDoctorArgs): BootstrapTarget[] => {
    const targets = (args as ManageInitArgs).targets;
    if (!Array.isArray(targets) || targets.length === 0) {
        return ["kairo"];
    }
    return targets.filter((target) =>
        target === "kairo"
        || target === "vscode"
        || target === "host_snippets"
        || target === "host_codex"
        || target === "host_claude_cli"
        || target === "host_gemini_cli"
    );
};

export const resolvePreset = (args: ManageInitArgs | ManageDoctorArgs): HostPreset => {
    const preset = (args as ManageInitArgs).presets;
    return preset === "minimal" ? "minimal" : "recommended";
};

export const resolveScanOptions = (args: ManageInitArgs | ManageDoctorArgs): {
    maxFiles: number;
    includeDocs: boolean;
    sampleBytesPerFile: number;
} => {
    const scan = (args as ManageInitArgs).languageScan ?? {};
    return {
        maxFiles: typeof scan.maxFiles === "number" ? scan.maxFiles : DEFAULT_MAX_FILES,
        includeDocs: scan.includeDocs !== false,
        sampleBytesPerFile: typeof scan.sampleBytesPerFile === "number" ? scan.sampleBytesPerFile : 0
    };
};

export const resolveRootPath = (rootPath: string, input?: string): string => {
    const fromEnv = process.env.KAIRO_ROOT_PATH ?? process.env.KAIRO_ROOT;
    const base = input || fromEnv || rootPath;
    if (path.isAbsolute(base)) {
        return path.resolve(base);
    }
    return path.resolve(rootPath, base);
};

export const resolveStatus = (findings: ConfigFinding[]): "ok" | "degraded" | "needs_action" => {
    const hasError = findings.some((finding) => finding.severity === "error");
    if (hasError) return "needs_action";
    const hasWarn = findings.some((finding) => finding.severity === "warn");
    if (hasWarn) return "degraded";
    return "ok";
};

export const buildSummary = (
    operation: string,
    plan: ConfigWriteOp[],
    findings: ConfigFinding[],
    mode: BootstrapMode
): string => {
    const actionable = plan.filter((op) => op.op !== "noop").length;
    const errorCount = findings.filter((f) => f.severity === "error").length;
    if (mode === "apply") {
        return `${operation} applied ${actionable} changes with ${errorCount} errors detected.`;
    }
    return `${operation} produced ${actionable} planned changes with ${errorCount} blocking findings.`;
};

export const applyScope = (
    scope: ManageDoctorArgs["scope"] | undefined,
    input: { findings: ConfigFinding[]; plan: ConfigWriteOp[]; hints: string[] }
): { findings: ConfigFinding[]; plan: ConfigWriteOp[]; hints: string[] } => {
    if (!scope) return input;
    const findings = input.findings.filter((finding) => isFindingInScope(scope, finding));
    const plan = input.plan.filter((entry) => isPlanInScope(scope, entry.path));
    const hints = input.hints.filter((hint) => isHintInScope(scope, hint));
    return { findings, plan, hints };
};

export const isFindingInScope = (scope: ManageDoctorArgs["scope"], finding: ConfigFinding): boolean => {
    if (!scope) return true;
    const code = finding.code;
    switch (scope) {
        case "capabilities":
            return false;
        case "languages":
            return code === "LANGUAGE_GAP" || code === "SCAN_TRUNCATED";
        case "wasm":
            return code === "WASM_MISSING";
        case "parity":
            return code === "MISSING_QUERY_PACK"
                || code === "MISSING_WASM_GRAMMAR"
                || code === "MISSING_VALIDATOR"
                || code === "LANGUAGE_SUPPORT_GAP";
        case "host":
            return code === "HOST_CONFIG_MISSING" || code === "HOST_CONFIG_PATCH";
        case "config":
            return code === "CONFIG_PARSE_ERROR" || code === "MIGRATION_NEEDED" || code === "CONFIG_CONFLICT";
        case "contracts":
            return code.startsWith("CONTRACT");
        case "project":
            return true;
        default:
            return true;
    }
};

export const isPlanInScope = (scope: ManageDoctorArgs["scope"], filePath: string): boolean => {
    if (!scope) return true;
    const baseDir = PathManager.getBaseDir()
        .replace(/\\/g, "/")
        .replace(/\/+$/, "")
        .replace(/^\.\//, "");
    const configPrefix = path.posix.join(baseDir, "config");
    const contractsPrefix = path.posix.join(baseDir, "contracts");
    if (scope === "host") {
        const normalized = filePath.replace(/\\\\/g, "/");
        return normalized.endsWith("/.vscode/mcp.json")
            || normalized.includes(path.posix.join(configPrefix, "hosts/"));
    }
    if (scope === "capabilities") {
        return false;
    }
    if (scope === "wasm") {
        return false;
    }
    if (scope === "languages") {
        return filePath.replace(/\\\\/g, "/").endsWith(path.posix.join(configPrefix, "languages.json"));
    }
    if (scope === "config") {
        const normalized = filePath.replace(/\\\\/g, "/");
        return normalized.endsWith("/.mcp-config.json")
            || normalized.endsWith(path.posix.join(configPrefix, "mcp-config.json"))
            || normalized.endsWith(path.posix.join(configPrefix, "mcp.json"))
            || normalized.endsWith(path.posix.join(configPrefix, "languages.json"))
            || normalized.endsWith(path.posix.join(configPrefix, "graphrag.json"));
    }
    if (scope === "contracts") {
        return filePath.replace(/\\\\/g, "/").includes(contractsPrefix);
    }
    if (scope === "parity") {
        const normalized = filePath.replace(/\\\\/g, "/");
        return normalized.endsWith(path.posix.join(configPrefix, "languages.json"))
            || normalized.includes("/wasm/");
    }
    return true;
};

export const isHintInScope = (scope: ManageDoctorArgs["scope"], hint: string): boolean => {
    if (!scope) return true;
    const baseDir = PathManager.getBaseDir()
        .replace(/\\/g, "/")
        .replace(/\/+$/, "")
        .replace(/^\.\//, "");
    const configPrefix = path.posix.join(baseDir, "config");
    const contractsPrefix = path.posix.join(baseDir, "contracts");
    if (scope === "wasm") {
        return hint.includes("KAIRO_WASM_DIR");
    }
    if (scope === "capabilities") {
        return false;
    }
    if (scope === "languages") {
        return hint.includes("extensions") || hint.includes("mappings");
    }
    if (scope === "host") {
        return hint.includes(".vscode") || hint.includes("hosts");
    }
    if (scope === "config") {
        return hint.includes(".mcp-config") || hint.includes(configPrefix) || hint.includes("<KAIRO_DIR>/config");
    }
    if (scope === "contracts") {
        return hint.includes(contractsPrefix) || hint.includes("<KAIRO_DIR>/contracts") || hint.includes("contracts");
    }
    if (scope === "parity") {
        const normalized = hint.toLowerCase();
        return normalized.includes("query") || normalized.includes("wasm") || normalized.includes("validator");
    }
    return true;
};

export const slugify = (input: string): string => {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "repo";
};

export const titleCase = (input: string): string => {
    return input
        .split(/\s+/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
};
