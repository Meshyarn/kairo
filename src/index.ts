import "./utils/StdoutGuard.js";
import * as path from "path";
import * as os from "os";
import * as url from "url";
import { SmartContextServer } from "./server/SmartContextServer.js";

export { SmartContextServer };
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


function parseRootFromArgv(argv: string[]): string | undefined {
    // Supports:
    //   --root /path
    //   --root=/path
    //   --rootPath /path
    //   --projectRoot /path
    const keys = new Set(["--root", "--rootPath", "--projectRoot"]);
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i] ?? "";
        for (const key of keys) {
            if (token === key) {
                const next = argv[i + 1];
                if (next && !next.startsWith("--")) {
                    return next;
                }
            }
            if (token.startsWith(`${key}=`)) {
                const value = token.slice(key.length + 1);
                if (value) return value;
            }
        }
    }
    return undefined;
}

function resolveRootPath(): { root: string; source: string } {
    const envKeys = [
        "KAIRO_ROOT_PATH",
        "KAIRO_ROOT",
        // VS Code / MCP implementations may use other env names
        "MCP_WORKSPACE_ROOT",
        "VSCODE_CWD",
        "VSCODE_WORKSPACE_FOLDER",
        "WORKSPACE_FOLDER",
        "WORKSPACE_ROOT",
        // npm/Node sometimes preserves the original working directory
        "INIT_CWD"
    ];

    const argRoot = parseRootFromArgv(process.argv.slice(2));
    const argCandidate = (argRoot ?? "").trim();
    if (argCandidate.length > 0) {
        return { root: argCandidate, source: "argv" };
    }

    for (const key of envKeys) {
        const value = (process.env[key] ?? "").trim();
        if (value.length === 0) continue;
        // Some hosts set misleading values (e.g. VSCODE_CWD="/").
        // Never accept a dangerously-broad root from env; fall back to cwd instead.
        if (isDangerouslyBroadRoot(value)) {
            continue;
        }
        return { root: value, source: `env:${key}` };
    }

    return { root: process.cwd(), source: "cwd" };
}

function isDangerouslyBroadRoot(rootPath: string): boolean {
    const resolved = path.resolve(rootPath);
    const home = (process.env.HOME ?? os.homedir() ?? "").trim();
    const resolvedHome = home ? path.resolve(home) : "";
    if (resolved === path.parse(resolved).root) return true; // "/" on *nix
    if (resolvedHome && resolved === resolvedHome) return true; // "~" / home dir
    return false;
}

if (isDirectRun) {
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
            "Override with KAIRO_ALLOW_CWD_ROOT=true if you really want this."
        );
        process.exit(1);
    }
    const server = new SmartContextServer(resolved.root);
    server.run().catch(console.error);
}
