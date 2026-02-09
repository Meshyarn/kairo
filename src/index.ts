import "./utils/StdoutGuard.js";
import * as path from "path";
import * as os from "os";
import * as url from "url";
import { createRequire } from "module";
import { SmartContextServer } from "./server/SmartContextServer.js";
import { emitEnvDeprecationWarnings } from "./utils/DeprecationNotice.js";
import { isDangerouslyBroadRoot, resolveRootPath as resolveStartupRootPath } from "./server/StartupRootResolver.js";

export { SmartContextServer };
const require = createRequire(import.meta.url);
const isDirectRun = (() => {
    const entry = process.argv[1];
    if (!entry) {
        return false;
    }
    try {
        return import.meta.url === url.pathToFileURL(entry).href;
    } catch {
        return false;
    }
})();

function hasFlag(argv: string[], ...flags: string[]): boolean {
    return argv.some((token) =>
        flags.includes(token) || flags.some((flag) => token.startsWith(`${flag}=`))
    );
}

function printHelp(): string {
    return [
        "kairo [--root <path>]",
        "",
        "Options:",
        "  --root, --rootPath, --projectRoot  Root path for indexing",
        "  --help, -h                         Show help",
        "  --version, -v                      Show version",
        "",
        "Env:",
        "  KAIRO_ROOT_PATH, KAIRO_MODE, KAIRO_PRESET, KAIRO_PUBLIC_SURFACE",
        "",
        "Examples:",
        "  node dist/index.js --root /path/to/repo"
    ].join("\n");
}

const resolvePackageVersion = (): string => {
    try {
        const pkg = require("../package.json");
        const version = typeof pkg?.version === "string" ? pkg.version.trim() : "";
        if (version.length > 0) {
            return version;
        }
    } catch {
        // ignore
    }
    const envVersion = (process.env.npm_package_version ?? "").trim();
    if (envVersion.length > 0) {
        return envVersion;
    }
    return "unknown";
};

function resolveRootPath(): { root: string; source: string } {
    return resolveStartupRootPath({
        argv: process.argv.slice(2),
        env: process.env,
        cwd: process.cwd(),
        homeDir: (process.env.HOME ?? os.homedir() ?? "").trim(),
        scriptPath: process.argv[1]
    });
}

if (isDirectRun) {
    const argv = process.argv.slice(2);
    if (hasFlag(argv, "--help", "-h")) {
        console.log(printHelp());
        process.exit(0);
    }
    if (hasFlag(argv, "--version", "-v")) {
        console.log(resolvePackageVersion());
        process.exit(0);
    }
    emitEnvDeprecationWarnings();
    const resolved = resolveRootPath();
    try {
        const cwd = process.cwd();
        console.warn(`[SmartContextServer] startup cwd=${cwd}`);
        console.warn(`[SmartContextServer] startup root=${resolved.root} (source=${resolved.source})`);
        if (process.env.KAIRO_DEBUG === 'true') {
            const keys = [
                "KAIRO_ROOT_PATH",
                "KAIRO_ROOT",
                "MCP_WORKSPACE_ROOT",
                "VSCODE_CWD",
                "VSCODE_WORKSPACE_FOLDER",
                "WORKSPACE_FOLDER",
                "WORKSPACE_ROOT",
                "INIT_CWD"
            ];
            for (const key of keys) {
                const value = (process.env[key] ?? "").trim();
                if (value) {
                    console.warn(`[SmartContextServer] env ${key}=${value}`);
                }
            }
        }
        if (resolved.root === cwd) {
            console.warn('[SmartContextServer] root was derived from cwd. If Copilot launches from an unexpected directory, set KAIRO_ROOT_PATH (or pass --root).');
        }
    } catch {
        // ignore
    }

    // Safety: when VS Code/Copilot launches from a broad cwd (like home), indexing can explode.
    // Require a safe root in that scenario unless overridden.
    const allowCwdRoot = process.env.KAIRO_ALLOW_CWD_ROOT === "true";
    if (!allowCwdRoot && isDangerouslyBroadRoot(resolved.root)) {
        console.error(
            "[SmartContextServer] Refusing to start with a broad root (home or filesystem root). " +
            "Open a folder/workspace in VS Code and pass --root, or set KAIRO_ROOT_PATH. " +
            "Override with KAIRO_ALLOW_CWD_ROOT=true if you really want this. " +
            "Run with --help for usage."
        );
        process.exit(1);
    }
    const server = new SmartContextServer(resolved.root);
    server.run().catch(console.error);
}
