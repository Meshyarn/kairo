import path from "path";
import ignore from "ignore";
import type { ContentSource } from "../types/content-source.js";
import { metrics } from "./MetricsCollector.js";
import type { ContentSourceResolveError, ContentSourceResolveOptions, ContentSourceResolveResult } from "./ContentSourceResolverTypes.js";
import {
  isInternalIgnoredPath,
  resolveAllowedRoots,
  resolveFileCandidate,
  resolveTempDirs
} from "./ContentSourceResolverUtils.js";

export type { ContentSourceResolveError, ContentSourceResolveOptions, ContentSourceResolveResult } from "./ContentSourceResolverTypes.js";

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
      `contentSource file is under an internal directory (${workspacePath}). Use <KAIRO_DIR>/tmp for raw content.`,
      "blocked",
      "content_source_internal_blocked",
      { path: workspacePath }
    );
  }

  if (!isTemp && ignoreMatcher?.ignores?.(workspacePath)) {
    return buildError(
      "CONTENT_SOURCE_BLOCKED",
      `contentSource file is ignored by project rules (${workspacePath}). Use <KAIRO_DIR>/tmp for raw content.`,
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


function buildError(
  errorCode: string,
  message: string,
  status: "blocked" | "failure",
  blockedReason?: string,
  details?: Record<string, unknown>
): ContentSourceResolveResult {
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
