import type { RepoRegistry } from "../config/RepoRegistry.js";
import type { NormalizedRepoScope } from "./RepoScope.js";
import type { PathNormalizer } from "./PathNormalizer.js";
import type { IFileSystem } from "../platform/FileSystem.js";

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
  ignoreGlobs?: string[];
  ignoreMatcher?: { ignores: (filePath: string) => boolean };
  maxBytes?: number;
  /** Optional artifact manager for resolving artifact-based content sources. */
  artifactManager?: { get(id: string): unknown };
};

export type RepoRoot = { id: string; rootPath: string; kind: "repo" | "workspace" };
