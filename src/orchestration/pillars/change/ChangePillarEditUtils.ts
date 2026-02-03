import type { IFileSystem } from "../../../platform/FileSystem.js";
import type { RepoRegistry } from "../../../config/RepoRegistry.js";
import type { NormalizedRepoScope } from "../../../utils/RepoScope.js";
import type { PathNormalizer } from "../../../utils/PathNormalizer.js";
import type { FlowArtifactManager } from "../../flow-artifact-manager.js";
import { resolveContentSource } from "../../../utils/ContentSourceResolver.js";
import type { ContentSource } from "../../../types/content-source.js";
import { isLikelyFilePath } from "./EditExecution.js";

export const collectEditPaths = (edits: any[]): string[] => {
  const paths = new Set<string>();
  for (const edit of edits) {
    const p = edit?.filePath ?? edit?.path;
    if (p) paths.add(p);
  }
  return Array.from(paths);
};

export const normalizeLegacyContentSources = (edits: any[]): any[] => {
  if (!Array.isArray(edits) || edits.length === 0) return edits;
  let mutated = false;
  const normalized = edits.map((edit) => {
    if (!edit || typeof edit !== "object" || Array.isArray(edit)) return edit;
    let next = { ...edit };
    let changed = false;
    const targetStringBase64 = typeof next.targetStringBase64 === "string" ? next.targetStringBase64 : undefined;
    const targetBase64 = typeof next.targetBase64 === "string" ? next.targetBase64 : undefined;
    const replacementStringBase64 = typeof next.replacementStringBase64 === "string" ? next.replacementStringBase64 : undefined;
    const replacementBase64 = typeof next.replacementBase64 === "string" ? next.replacementBase64 : undefined;

    if (next.targetSource === undefined) {
      const targetBase64Value =
        (typeof targetStringBase64 === "string" && targetStringBase64.length > 0)
          ? targetStringBase64
          : (typeof targetBase64 === "string" && targetBase64.length > 0 ? targetBase64 : undefined);
      if (targetBase64Value) {
        next.targetSource = { kind: "base64", base64: targetBase64Value, charset: "utf8" };
        changed = true;
      }
    }
    if (next.replacementSource === undefined) {
      const replacementBase64Value =
        (typeof replacementStringBase64 === "string" && replacementStringBase64.length > 0)
          ? replacementStringBase64
          : (typeof replacementBase64 === "string" && replacementBase64.length > 0 ? replacementBase64 : undefined);
      if (replacementBase64Value) {
        next.replacementSource = { kind: "base64", base64: replacementBase64Value, charset: "utf8" };
        changed = true;
      }
    }

    if (changed || next.targetSource !== undefined || next.replacementSource !== undefined) {
      if (typeof targetStringBase64 === "string") {
        delete next.targetStringBase64;
        changed = true;
      }
      if (typeof targetBase64 === "string") {
        delete next.targetBase64;
        changed = true;
      }
      if (typeof replacementStringBase64 === "string") {
        delete next.replacementStringBase64;
        changed = true;
      }
      if (typeof replacementBase64 === "string") {
        delete next.replacementBase64;
        changed = true;
      }
    }

    if (changed) {
      mutated = true;
      return next;
    }
    return edit;
  });

  return mutated ? normalized : edits;
};

export const resolveContentSourcesForEdits = async (args: {
  edits: any[];
  rootPath: string;
  fileSystem: IFileSystem;
  repoRegistry?: RepoRegistry;
  repoScope?: NormalizedRepoScope;
  pathNormalizer?: PathNormalizer;
  artifactManager?: FlowArtifactManager;
  ignoreMatcher?: { ignores: (filePath: string) => boolean };
}): Promise<
  | { ok: true; edits: any[]; usage?: { targetSource?: Record<string, { count: number; bytes: number }>; replacementSource?: Record<string, { count: number; bytes: number }> } }
  | { ok: false; error: any; editIndex: number; field: "targetSource" | "replacementSource" }
> => {
  const resolved: any[] = [];
  const usage: { targetSource?: Record<string, { count: number; bytes: number }>; replacementSource?: Record<string, { count: number; bytes: number }> } = {};
  const recordUsage = (field: "targetSource" | "replacementSource", kind: string, bytes: number) => {
    const bucket = field === "targetSource"
      ? (usage.targetSource ??= {})
      : (usage.replacementSource ??= {});
    const entry = bucket[kind] ?? { count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += bytes;
    bucket[kind] = entry;
  };

  for (let index = 0; index < args.edits.length; index += 1) {
    const edit = args.edits[index];
    let next = { ...edit };

    if (edit?.targetSource) {
      const result = await resolveContentSource(edit.targetSource as ContentSource, {
        rootPath: args.rootPath,
        fileSystem: args.fileSystem,
        repoRegistry: args.repoRegistry,
        repoScope: args.repoScope,
        pathNormalizer: args.pathNormalizer,
        artifactManager: args.artifactManager,
        ignoreMatcher: args.ignoreMatcher
      });
      if (!result.ok) {
        return { ok: false, error: result.error, editIndex: index, field: "targetSource" };
      }
      recordUsage(
        "targetSource",
        result.meta.kind,
        typeof result.meta.bytes === "number" ? result.meta.bytes : Buffer.byteLength(result.content, "utf8")
      );
      next = {
        ...next,
        targetString: result.content
      };
      delete (next as any).targetSource;
      delete (next as any).targetStringBase64;
      delete (next as any).targetBase64;
    }

    if (edit?.replacementSource) {
      const result = await resolveContentSource(edit.replacementSource as ContentSource, {
        rootPath: args.rootPath,
        fileSystem: args.fileSystem,
        repoRegistry: args.repoRegistry,
        repoScope: args.repoScope,
        pathNormalizer: args.pathNormalizer,
        artifactManager: args.artifactManager,
        ignoreMatcher: args.ignoreMatcher
      });
      if (!result.ok) {
        return { ok: false, error: result.error, editIndex: index, field: "replacementSource" };
      }
      recordUsage(
        "replacementSource",
        result.meta.kind,
        typeof result.meta.bytes === "number" ? result.meta.bytes : Buffer.byteLength(result.content, "utf8")
      );
      next = {
        ...next,
        replacementString: result.content
      };
      delete (next as any).replacementSource;
      delete (next as any).replacementStringBase64;
      delete (next as any).replacementBase64;
    }

    resolved.push(next);
  }

  return { ok: true, edits: resolved, usage };
};

export const extractTargetFromEdits = (edits: any[]): string | undefined => {
  for (const edit of edits) {
    const p = edit?.filePath ?? edit?.path;
    if (p) return p;
  }
  return undefined;
};

export const extractEditFilePath = (edit: any): string | undefined => {
  const candidate = edit?.filePath ?? edit?.path;
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate.trim();
  }
  const targetCandidate = edit?.target;
  if (isLikelyFilePath(targetCandidate)) {
    return targetCandidate.trim();
  }
  return undefined;
};
