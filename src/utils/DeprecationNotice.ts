type DeprecationEntry = {
    key: string;
    replacement?: string;
    message?: string;
};

const DEPRECATED_ENV: DeprecationEntry[] = [
    {
        key: "KAIRO_ROOT",
        replacement: "KAIRO_ROOT_PATH",
        message: "Use KAIRO_ROOT_PATH or --root for explicit project roots."
    },
    {
        key: "KAIRO_EXPOSE_LEGACY_TOOLS",
        replacement: "KAIRO_EXPOSE_INTERNAL_TOOLS",
        message: "Legacy tool exposure flag will be removed."
    },
    {
        key: "KAIRO_EXPOSE_COMPAT_TOOLS",
        replacement: "KAIRO_EXPOSE_FILE_TOOLS",
        message: "Compat tool exposure flag will be removed."
    },
    {
        key: "KAIRO_ALLOW_LEGACY_MCP_DIR",
        message: "Legacy .mcp paths are deprecated; prefer .kairo."
    }
];

const warned = new Set<string>();

const isTestEnv = (): boolean => {
    return process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID != null;
};

export const emitEnvDeprecationWarnings = (): void => {
    if (isTestEnv()) return;
    for (const entry of DEPRECATED_ENV) {
        const raw = process.env[entry.key];
        if (!raw) continue;
        if (warned.has(entry.key)) continue;
        warned.add(entry.key);
        const replacement = entry.replacement ? ` Use ${entry.replacement} instead.` : "";
        const extra = entry.message ? ` ${entry.message}` : "";
        console.warn(`[Deprecation] ${entry.key} is deprecated.${replacement}${extra}`.trim());
    }
};
