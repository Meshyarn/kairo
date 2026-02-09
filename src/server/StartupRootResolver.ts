import * as path from "path";
import * as os from "os";
import * as fs from "fs";

export type RootResolutionResult = { root: string; source: string };

type ResolveRootPathOptions = {
  argv: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  homeDir?: string;
  scriptPath?: string;
};

function parseRootFromArgv(argv: string[]): string | undefined {
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

export function isDangerouslyBroadRoot(rootPath: string, homeDir?: string): boolean {
  const resolved = path.resolve(rootPath);
  const home = (homeDir ?? process.env.HOME ?? os.homedir() ?? "").trim();
  const resolvedHome = home ? path.resolve(home) : "";
  if (resolved === path.parse(resolved).root) return true;
  if (resolvedHome && resolved === resolvedHome) return true;
  return false;
}

export function resolveRootPath(options: ResolveRootPathOptions): RootResolutionResult {
  const { argv, env, cwd, homeDir, scriptPath } = options;

  const argRoot = parseRootFromArgv(argv);
  const argCandidate = (argRoot ?? "").trim();
  if (argCandidate.length > 0) {
    return { root: argCandidate, source: "argv" };
  }

  const envKeys = [
    "KAIRO_ROOT_PATH",
    "KAIRO_ROOT",
    "MCP_WORKSPACE_ROOT",
    "VSCODE_CWD",
    "VSCODE_WORKSPACE_FOLDER",
    "WORKSPACE_FOLDER",
    "WORKSPACE_ROOT",
    "CODEX_WORKSPACE_ROOT",
    "CODEX_CWD",
    "PWD",
    "INIT_CWD"
  ];

  for (const key of envKeys) {
    const value = (env[key] ?? "").trim();
    if (value.length === 0) continue;
    if (isDangerouslyBroadRoot(value, homeDir)) continue;
    return { root: value, source: `env:${key}` };
  }

  if (isDangerouslyBroadRoot(cwd, homeDir)) {
    const scriptCandidate = deriveScriptRootCandidate(scriptPath);
    if (scriptCandidate && !isDangerouslyBroadRoot(scriptCandidate, homeDir)) {
      return { root: scriptCandidate, source: "argv:script" };
    }
  }

  return { root: cwd, source: "cwd" };
}

function deriveScriptRootCandidate(scriptPath?: string): string | undefined {
  const entry = (scriptPath ?? "").trim();
  if (entry.length === 0) return undefined;
  const absoluteEntry = path.resolve(entry);
  const scriptDir = path.dirname(absoluteEntry);
  const distParent = path.basename(scriptDir) === "dist" ? path.dirname(scriptDir) : scriptDir;
  const packageJsonPath = path.join(distParent, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    return distParent;
  }
  return scriptDir;
}
