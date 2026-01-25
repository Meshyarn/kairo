import path from "path";
import ignore from "ignore";
import type { ContentSource } from "../types/content-source.js";
import type { RepoRegistry } from "../config/RepoRegistry.js";
import type { NormalizedRepoScope } from "./RepoScope.js";
import type { PathNormalizer } from "./PathNormalizer.js";
import type { IFileSystem } from "../platform/FileSystem.js";
import type { FlowArtifactManager } from "../orchestration/flow-artifact-manager.js";
import { metrics } from "./MetricsCollector.js";

export type ContentSourceResolveError = {
  errorCode: string;
  message: string;
  status: "blocked" | "failure";
  blockedReason?: string;
  details?: Record<string, unknown>;
};

export type ContentSourceResolveResult =
  | { ok: true; content: string; meta: { kind: string; resolvedPath?: string; bytes?: number } }
  | { ok: false; error: ContentSourceResolveError };

export type ContentSourceResolveOptions = {
  rootPath: string;
  fileSystem: IFileSystem;
  repoRegistry?: RepoRegistry;
  repoScope?: NormalizedRepoScope;
  pathNormalizer?: PathNormalizer;
  artifactManager?: FlowArtifactManager;
  ignoreGlobs?: string[];
  ignoreMatcher?: { ignores: (filePath: string) => boolean };
  maxBytes?: number;
};

type RepoRoot = { id: string; rootPath: string; kind: "repo" | "workspace" };

const DEFAULT_MAX_BYTES = (() => {
  const parsed = Number.parseInt(process.env.KAIRO_CONTENT_SOURCE_MAX_BYTES ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1024 * 1024;
})();

export function createIgnoreMatcher(patterns: string[] = []): { ignores: (filePath: string) => boolean } {
  const ig = (ignore as unknown as () => any)();
  if (patterns.length > 0) {
    ig.add(patterns);
  }
  return ig;
}

export async function resolveContentSource(
  source: ContentSource | undefined | null,
  options: ContentSourceResolveOptions
): Promise<ContentSourceResolveResult> {
  if (!source || typeof source !== "object") {
    return buildError("CONTENT_SOURCE_INVALID", "contentSource is missing or invalid.", "failure");
  }

  switch (source.kind) {
    case "inline":
      if (typeof (source as any).text !== "string") {
        return buildError("CONTENT_SOURCE_INVALID", "contentSource.inline.text must be a string.", "failure");
      }
      recordMetrics("inline", Buffer.byteLength((source as any).text, "utf8"));
      return { ok: true, content: (source as any).text, meta: { kind: "inline" } };
    case "base64":
      return resolveBase64Source(source as any);
    case "file":
      return resolveFileSource(source as any, options);
    case "artifact":
      return resolveArtifactSource(source as any, options);
    default:
      return buildError("CONTENT_SOURCE_UNSUPPORTED", `Unsupported contentSource kind: ${(source as any).kind}`, "failure");
  }
}

async function resolveFileSource(
  source: { path?: unknown },
  options: ContentSourceResolveOptions
): Promise<ContentSourceResolveResult> {
  const rawPath = typeof source.path === "string" ? source.path.trim() : "";
  if (!rawPath) {
    return buildError("CONTENT_SOURCE_INVALID", "contentSource.file.path must be a non-empty string.", "failure");
  }

  const rootPath = path.resolve(options.rootPath);
  const maxBytes = Number.isFinite(options.maxBytes) && (options.maxBytes as number) > 0
    ? (options.maxBytes as number)
    : DEFAULT_MAX_BYTES;
  const ignoreMatcher = options.ignoreMatcher ?? createIgnoreMatcher(options.ignoreGlobs ?? []);
  const tempDirs = resolveTempDirs(rootPath);

  const allowedRootsResult = resolveAllowedRoots(options, rootPath);
  if ("error" in allowedRootsResult) {
    return { ok: false, error: allowedRootsResult.error };
  }

  const allowedRoots = allowedRootsResult.roots;
  const resolution = await resolveFileCandidate(rawPath, {
    rootPath,
    allowedRoots,
    tempDirs,
    fileSystem: options.fileSystem
  });
  if (!resolution.ok) {
    return { ok: false, error: resolution.error };
  }

  const { absolutePath, workspacePath, isTemp } = resolution;

  if (!isTemp && isInternalIgnoredPath(workspacePath, rootPath)) {
    return buildError(
      "CONTENT_SOURCE_BLOCKED",
      `contentSource file is under an internal directory (${workspacePath}). Use .kairo/tmp for raw content.`,
      "blocked",
      "content_source_internal_blocked",
      { path: workspacePath }
    );
  }

  if (!isTemp && ignoreMatcher?.ignores?.(workspacePath)) {
    return buildError(
      "CONTENT_SOURCE_BLOCKED",
      `contentSource file is ignored by project rules (${workspacePath}). Use .kairo/tmp for raw content.`,
      "blocked",
      "content_source_ignored",
      { path: workspacePath }
    );
  }

  let stats: { size: number; isDirectory(): boolean } | undefined;
  try {
    stats = await options.fileSystem.stat(absolutePath);
  } catch {
    return buildError(
      "CONTENT_SOURCE_NOT_FOUND",
      `contentSource file not found: ${workspacePath}`,
      "failure",
      undefined,
      { path: workspacePath }
    );
  }

  if (stats.isDirectory()) {
    return buildError(
      "CONTENT_SOURCE_INVALID",
      `contentSource file path points to a directory: ${workspacePath}`,
      "failure",
      undefined,
      { path: workspacePath }
    );
  }

  if (stats.size > maxBytes) {
    return buildError(
      "CONTENT_SOURCE_TOO_LARGE",
      `contentSource file exceeds size limit (${stats.size} bytes > ${maxBytes} bytes).`,
      "failure",
      undefined,
      { path: workspacePath, size: stats.size, maxBytes }
    );
  }

  let content: string;
  try {
    content = await options.fileSystem.readFile(absolutePath);
  } catch (error: any) {
    return buildError(
      "CONTENT_SOURCE_READ_FAILED",
      `Failed to read contentSource file: ${workspacePath}`,
      "failure",
      undefined,
      { path: workspacePath, error: error?.message ?? String(error) }
    );
  }
  recordMetrics("file", stats.size);
  return { ok: true, content, meta: { kind: "file", resolvedPath: workspacePath, bytes: stats.size } };
}

function resolveBase64Source(source: { base64?: unknown; charset?: unknown }): ContentSourceResolveResult {
  const raw = typeof source.base64 === "string" ? source.base64 : "";
  if (!raw) {
    return buildError("CONTENT_SOURCE_INVALID", "contentSource.base64 must be a non-empty string.", "failure");
  }
  const charset = source.charset ?? "utf8";
  if (charset !== "utf8") {
    return buildError("CONTENT_SOURCE_INVALID", "contentSource.base64 only supports utf8 charset.", "failure");
  }

  const normalized = raw.trim().replace(/\s+/g, "");
  if (!normalized || normalized.length % 4 === 1 || /[^A-Za-z0-9+/=]/.test(normalized)) {
    return buildError("CONTENT_SOURCE_DECODE_FAILED", "contentSource.base64 is not valid base64.", "failure");
  }

  const buffer = Buffer.from(normalized, "base64");
  const reencoded = buffer.toString("base64").replace(/=+$/, "");
  const trimmed = normalized.replace(/=+$/, "");
  if (reencoded !== trimmed) {
    return buildError("CONTENT_SOURCE_DECODE_FAILED", "contentSource.base64 is not valid base64.", "failure");
  }

  recordMetrics("base64", buffer.length);
  return { ok: true, content: buffer.toString("utf8"), meta: { kind: "base64" } };
}

function resolveArtifactSource(
  source: { id?: unknown },
  options: ContentSourceResolveOptions
): ContentSourceResolveResult {
  const id = typeof source.id === "string" ? source.id.trim() : "";
  if (!id) {
    return buildError("CONTENT_SOURCE_INVALID", "contentSource.artifact.id must be a non-empty string.", "failure");
  }
  const manager = options.artifactManager;
  if (!manager) {
    return buildError("CONTENT_SOURCE_UNSUPPORTED", "Artifact source requires an active artifact manager.", "failure");
  }
  const artifact = manager.get(id as any) as any;
  if (!artifact) {
    return buildError("CONTENT_SOURCE_ARTIFACT_NOT_FOUND", `Artifact not found: ${id}`, "failure");
  }

  if (artifact?.type === "draft" && Array.isArray(artifact.pack?.phantomFiles)) {
    const phantomFiles = artifact.pack.phantomFiles as Array<any>;
    if (phantomFiles.length > 1) {
      return buildError(
        "CONTENT_SOURCE_AMBIGUOUS",
        "Draft artifact contains multiple phantom files; specify a file source instead.",
        "failure",
        undefined,
        { artifactId: id }
      );
    }
    const phantomContent = phantomFiles[0]?.content;
    if (typeof phantomContent === "string") {
      recordMetrics("artifact", Buffer.byteLength(phantomContent, "utf8"));
      return { ok: true, content: phantomContent, meta: { kind: "artifact" } };
    }
  }

  const candidate =
    pickString(artifact?.content) ??
    pickString(artifact?.text) ??
    pickString(artifact?.payload) ??
    pickString(artifact?.metadata?.content) ??
    pickString(artifact?.metadata?.text) ??
    pickString(artifact?.metadata?.payload) ??
    pickString(artifact?.pack?.content) ??
    pickString(artifact?.pack?.text);

  if (typeof candidate === "string") {
    recordMetrics("artifact", Buffer.byteLength(candidate, "utf8"));
    return { ok: true, content: candidate, meta: { kind: "artifact" } };
  }

  return buildError(
    "CONTENT_SOURCE_UNSUPPORTED",
    "Artifact does not contain a string payload to use as content.",
    "failure",
    undefined,
    { artifactId: id, artifactType: artifact?.type }
  );
}

function pickString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function resolveAllowedRoots(
  options: ContentSourceResolveOptions,
  rootPath: string
): { roots: RepoRoot[] } | { error: ContentSourceResolveError } {
  const repoRegistry = options.repoRegistry;
  const repoScope = options.repoScope;

  if (!repoRegistry || !repoScope) {
    return {
      roots: [{ id: "workspace", rootPath, kind: "workspace" }]
    };
  }

  const roots: RepoRoot[] = [];
  if (repoScope.scope.mode === "default") {
    const repo = repoRegistry.getDefaultRepo();
    if (!repo) {
      return { error: buildErrorValue("CONTENT_SOURCE_INVALID", "Default repository is not configured.", "failure") };
    }
    roots.push({ id: repo.id, rootPath: repo.path, kind: "repo" });
  } else if (repoScope.scope.mode === "repos") {
    for (const repoId of repoScope.repoIds ?? []) {
      const repo = repoRegistry.getRepo(repoId);
      if (!repo) {
        return { error: buildErrorValue("CONTENT_SOURCE_INVALID", `Unknown repoId: ${repoId}`, "failure") };
      }
      roots.push({ id: repo.id, rootPath: repo.path, kind: "repo" });
    }
  } else {
    for (const repo of repoRegistry.getAllRepos()) {
      roots.push({ id: repo.id, rootPath: repo.path, kind: "repo" });
    }
  }

  if (repoScope.includeUnscoped) {
    roots.push({ id: "unscoped", rootPath, kind: "workspace" });
  }

  const deduped = new Map<string, RepoRoot>();
  for (const root of roots) {
    const normalized = path.resolve(root.rootPath);
    if (!deduped.has(normalized)) {
      deduped.set(normalized, { ...root, rootPath: normalized });
    }
  }

  return { roots: Array.from(deduped.values()) };
}

async function resolveFileCandidate(argsPath: string, options: {
  rootPath: string;
  allowedRoots: RepoRoot[];
  tempDirs: string[];
  fileSystem: IFileSystem;
}): Promise<
  | { ok: true; absolutePath: string; workspacePath: string; isTemp: boolean }
  | { ok: false; error: ContentSourceResolveError }
> {
  const isAbs = path.isAbsolute(argsPath);
  const candidatePaths = new Set<string>();
  const normalizedPath = argsPath.replace(/\\/g, "/");

  if (isAbs) {
    candidatePaths.add(path.normalize(argsPath));
  } else {
    candidatePaths.add(path.resolve(options.rootPath, normalizedPath));
    for (const root of options.allowedRoots) {
      candidatePaths.add(path.resolve(root.rootPath, normalizedPath));
    }
  }

  const candidates = Array.from(candidatePaths.values());
  const evaluated: Array<{ absolutePath: string; workspacePath: string; isTemp: boolean }> = [];

  for (const candidate of candidates) {
    const absolutePath = path.resolve(candidate);
    const isTemp = options.tempDirs.some((dir) => isWithinPath(dir, absolutePath));

    if (!isTemp) {
      const matchingRoots = selectMatchingRoots(options.allowedRoots, absolutePath);
      if (matchingRoots === "none") {
        continue;
      }
      if (matchingRoots === "ambiguous") {
        return buildCandidateError("CONTENT_SOURCE_AMBIGUOUS", "contentSource file path is ambiguous across repos.", "failure");
      }
    }

    const workspacePath = toWorkspacePath(options.rootPath, absolutePath);
    if (workspacePath === null && !isTemp) {
      return buildCandidateError(
        "CONTENT_SOURCE_BLOCKED",
        "contentSource file is outside the workspace root.",
        "blocked",
        "content_source_out_of_scope"
      );
    }

    evaluated.push({
      absolutePath,
      workspacePath: workspacePath ?? absolutePath.replace(/\\/g, "/"),
      isTemp
    });
  }

  if (evaluated.length === 0) {
    return buildCandidateError(
      "CONTENT_SOURCE_BLOCKED",
      "contentSource file is outside the allowed repository scope.",
      "blocked",
      "content_source_out_of_scope"
    );
  }

  const existing: Array<{ absolutePath: string; workspacePath: string; isTemp: boolean }> = [];
  for (const candidate of evaluated) {
    if (await options.fileSystem.exists(candidate.absolutePath)) {
      existing.push(candidate);
    }
  }

  if (existing.length === 0) {
    return buildCandidateError(
      "CONTENT_SOURCE_NOT_FOUND",
      `contentSource file not found: ${evaluated[0].workspacePath}`,
      "failure",
      undefined,
      { tried: evaluated.map((item) => item.workspacePath) }
    );
  }

  if (existing.length > 1) {
    return buildCandidateError(
      "CONTENT_SOURCE_AMBIGUOUS",
      "contentSource file path matches multiple repositories. Specify repoScope/repoId or use workspace-relative path.",
      "failure",
      undefined,
      { matches: existing.map((item) => item.workspacePath) }
    );
  }

  return { ok: true, ...existing[0] };
}

function selectMatchingRoots(roots: RepoRoot[], absolutePath: string): "none" | "ambiguous" | RepoRoot {
  if (roots.length === 0) return "none";
  const matches = roots.filter((root) => isWithinPath(root.rootPath, absolutePath));
  if (matches.length === 0) return "none";
  matches.sort((a, b) => b.rootPath.length - a.rootPath.length);
  if (matches.length > 1 && matches[0].rootPath.length === matches[1].rootPath.length) {
    return "ambiguous";
  }
  return matches[0];
}

function toWorkspacePath(rootPath: string, absolutePath: string): string | null {
  const relative = path.relative(rootPath, absolutePath);
  if (!relative || relative === "") return ".";
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative.replace(/\\/g, "/");
}

function isWithinPath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  if (!relative || relative === "") return true;
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function resolveTempDirs(rootPath: string): string[] {
  const baseDir = resolveKairoBaseDir();
  const baseAbs = path.isAbsolute(baseDir) ? path.normalize(baseDir) : path.resolve(rootPath, baseDir);
  return [path.join(baseAbs, "tmp"), path.join(baseAbs, "temp")];
}

function resolveKairoBaseDir(): string {
  const raw = (process.env.KAIRO_DIR || "").trim();
  if (!raw) return ".kairo";
  const normalized = raw.replace(/\\/g, "/").replace(/\/+$/, "");
  const allowLegacy = process.env.KAIRO_ALLOW_LEGACY_MCP_DIR === "true";
  if (!allowLegacy) {
    if (normalized === ".mcp" || normalized === ".mcp/kairo" || normalized.includes("/.mcp/")) {
      return ".kairo";
    }
  }
  return raw;
}

function isInternalIgnoredPath(workspacePath: string, rootPath: string): boolean {
  const normalized = workspacePath.replace(/\\/g, "/");
  const baseDir = resolveKairoBaseDir();
  const baseAbs = path.isAbsolute(baseDir) ? path.normalize(baseDir) : path.resolve(rootPath, baseDir);
  const baseRel = toWorkspacePath(rootPath, baseAbs)?.replace(/\\/g, "/");
  const internalRoots = new Set([".mcp", ".kairo", ".kairo-index"]);
  if (baseRel) internalRoots.add(baseRel);

  for (const root of internalRoots) {
    if (normalized === root || normalized.startsWith(`${root}/`)) {
      if (root === baseRel || root === ".kairo" || root === ".mcp") {
        if (
          normalized === `${root}/tmp` ||
          normalized.startsWith(`${root}/tmp/`) ||
          normalized === `${root}/temp` ||
          normalized.startsWith(`${root}/temp/`)
        ) {
          return false;
        }
      }
      return true;
    }
  }
  return false;
}

function buildError(
  errorCode: string,
  message: string,
  status: "blocked" | "failure",
  blockedReason?: string,
  details?: Record<string, unknown>
): ContentSourceResolveResult {
  return { ok: false, error: buildErrorValue(errorCode, message, status, blockedReason, details) };
}

function buildCandidateError(
  errorCode: string,
  message: string,
  status: "blocked" | "failure",
  blockedReason?: string,
  details?: Record<string, unknown>
): { ok: false; error: ContentSourceResolveError } {
  return { ok: false, error: buildErrorValue(errorCode, message, status, blockedReason, details) };
}

function buildErrorValue(
  errorCode: string,
  message: string,
  status: "blocked" | "failure",
  blockedReason?: string,
  details?: Record<string, unknown>
): ContentSourceResolveError {
  return {
    errorCode,
    message,
    status,
    ...(blockedReason ? { blockedReason } : {}),
    ...(details ? { details } : {})
  };
}

function recordMetrics(kind: string, bytes?: number): void {
  metrics.inc("content_source.resolve.count", 1, "basic");
  metrics.inc(`content_source.kind.${kind}.count`, 1, "basic");
  if (typeof bytes === "number" && Number.isFinite(bytes)) {
    metrics.observe("content_source.bytes", bytes, "detailed");
  }
}
