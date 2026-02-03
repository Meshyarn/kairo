import path from "path";
import type { ArtifactId, ArtifactType, FlowArtifact, FlowSession } from "../types/flow-artifacts.js";
import type { FlowArtifactIndex, FlowArtifactManagerState } from "./flow-artifact-manager.types.js";
import { readIndex, persistIndex, updateIndexForArtifact, updateIndexForSession, touchIndex } from "./flow-artifact-manager.index.js";
import { resolvePersistPath, safeReadDirEntries, toAbsolutePersistPath } from "./flow-artifact-manager.paths.js";

export async function persistArtifact(state: FlowArtifactManagerState, id: ArtifactId, artifact: FlowArtifact): Promise<string> {
  const target = await resolvePersistPath(state, id, artifact.type, true);
  await state.fileSystem.writeFile(target, JSON.stringify(artifact, null, 2));
  updateIndexForArtifact(state, artifact, target);
  await persistIndex(state);
  return target;
}

export async function restoreArtifact(
  state: FlowArtifactManagerState,
  id: ArtifactId,
  onStore: (artifact: FlowArtifact) => void
): Promise<FlowArtifact | undefined> {
  try {
    const filePath = await resolvePersistPath(state, id);
    const raw = await state.fileSystem.readFile(filePath);
    const artifact = JSON.parse(raw) as FlowArtifact;
    onStore(artifact);
    updateIndexForArtifact(state, artifact, filePath);
    return artifact;
  } catch {
    return undefined;
  }
}

export async function importFromPath(
  state: FlowArtifactManagerState,
  filePath: string,
  onStore: (artifact: FlowArtifact) => void
): Promise<FlowArtifact | undefined> {
  try {
    const raw = await state.fileSystem.readFile(filePath);
    const artifact = JSON.parse(raw) as FlowArtifact;
    onStore(artifact);
    updateIndexForArtifact(state, artifact, filePath);
    return artifact;
  } catch {
    return undefined;
  }
}

export async function persistSession(state: FlowArtifactManagerState, session: FlowSession): Promise<string> {
  const sessionDir = path.join(state.persistPath, "sessions");
  await state.fileSystem.createDir(sessionDir);
  const target = path.join(sessionDir, `${session.id}.json`);
  await state.fileSystem.writeFile(target, JSON.stringify(session, null, 2));
  updateIndexForSession(state, session, target);
  await persistIndex(state);
  return target;
}

export async function restoreSession(state: FlowArtifactManagerState, sessionId: string): Promise<FlowSession | undefined> {
  try {
    const sessionDir = path.join(state.persistPath, "sessions");
    const filePath = path.join(sessionDir, `${sessionId}.json`);
    const raw = await state.fileSystem.readFile(filePath);
    const session = JSON.parse(raw) as FlowSession;
    state.sessions.set(session.id, session);
    updateIndexForSession(state, session, filePath);
    return session;
  } catch {
    return undefined;
  }
}

export async function restoreSessionFromPath(
  state: FlowArtifactManagerState,
  sessionId: string,
  filePath: string
): Promise<FlowSession | undefined> {
  try {
    const raw = await state.fileSystem.readFile(filePath);
    const session = JSON.parse(raw) as FlowSession;
    if (session.id !== sessionId) {
      session.id = sessionId;
    }
    state.sessions.set(session.id, session);
    updateIndexForSession(state, session, filePath);
    return session;
  } catch {
    return undefined;
  }
}

export async function removePersisted(state: FlowArtifactManagerState, id: ArtifactId): Promise<void> {
  try {
    const filePath = await resolvePersistPath(state, id);
    if (await state.fileSystem.exists(filePath)) {
      await state.fileSystem.deleteFile(filePath);
    }
  } catch {
    // ignore
  }
}

export async function restoreFromIndex(
  state: FlowArtifactManagerState,
  onStore: (artifact: FlowArtifact) => void
): Promise<number> {
  const index = await readIndex(state);
  if (!index) return -1;
  state.index = index;
  let restored = 0;
  const sessionEntries = Object.entries(index.sessions ?? {});
  for (const [sessionId, entry] of sessionEntries) {
    if (entry?.path) {
      const sessionPath = toAbsolutePersistPath(state, entry.path);
      await restoreSessionFromPath(state, sessionId, sessionPath);
    } else {
      await restoreSession(state, sessionId);
    }
  }
  const artifactEntries = Object.entries(index.artifacts ?? {});
  for (const [artifactId, entry] of artifactEntries) {
    const type = entry?.type as ArtifactType | undefined;
    const pathOverride = entry?.path ? toAbsolutePersistPath(state, entry.path) : undefined;
    const filePath = pathOverride ?? await resolvePersistPath(state, artifactId as ArtifactId, type);
    const artifact = await importFromPath(state, filePath, onStore);
    if (artifact) restored += 1;
  }
  return restored;
}

export async function restoreAll(
  state: FlowArtifactManagerState,
  onStore: (artifact: FlowArtifact) => void
): Promise<number> {
  const restoredFromIndex = await restoreFromIndex(state, onStore);
  if (restoredFromIndex >= 0) {
    return restoredFromIndex;
  }
  try {
    const entries = await safeReadDirEntries(state, state.persistPath);
    let restored = 0;
    for (const entry of entries) {
      if (entry.isFile) {
        if (!entry.name.endsWith(".json")) continue;
        const full = path.join(state.persistPath, entry.name);
        const artifact = await importFromPath(state, full, onStore);
        if (artifact) restored += 1;
        continue;
      }
      if (!entry.isDirectory) continue;
      const fullDir = path.join(state.persistPath, entry.name);
      if (entry.name === "sessions") {
        await restoreSessionsFromDir(state, fullDir);
        continue;
      }
      restored += await restoreArtifactsFromDir(state, fullDir, onStore);
    }
    return restored;
  } catch {
    return 0;
  }
}

export async function prunePersisted(
  state: FlowArtifactManagerState,
  options: { removeOrphans?: boolean } = {}
): Promise<{ deletedFiles: number; fixedIndexEntries: number; removedSessions: number }> {
  const removeOrphans = options.removeOrphans !== false;
  const index = await readIndex(state);
  if (!index) {
    return { deletedFiles: 0, fixedIndexEntries: 0, removedSessions: 0 };
  }
  state.index = index;
  let fixedIndexEntries = 0;
  let deletedFiles = 0;
  let removedSessions = 0;
  let updated = false;

  const artifactEntries = Object.entries(state.index.artifacts ?? {});
  for (const [id, entry] of artifactEntries) {
    const absPath = entry.path
      ? toAbsolutePersistPath(state, entry.path)
      : await resolvePersistPath(state, id as ArtifactId, entry.type);
    if (!await state.fileSystem.exists(absPath)) {
      delete state.index.artifacts[id];
      fixedIndexEntries += 1;
      updated = true;
    }
  }

  const sessionEntries = Object.entries(state.index.sessions ?? {});
  for (const [sessionId, entry] of sessionEntries) {
    if (!entry?.path) continue;
    const absPath = toAbsolutePersistPath(state, entry.path);
    if (!await state.fileSystem.exists(absPath)) {
      delete state.index.sessions[sessionId];
      removedSessions += 1;
      updated = true;
    }
  }

  if (removeOrphans) {
    deletedFiles += await removeOrphanedArtifacts(state);
    deletedFiles += await removeOrphanedSessions(state);
  }

  if (updated || deletedFiles > 0) {
    touchIndex(state);
    await persistIndex(state);
  }

  return { deletedFiles, fixedIndexEntries, removedSessions };
}

export async function planPrunePersisted(
  state: FlowArtifactManagerState,
  options: { removeOrphans?: boolean } = {}
): Promise<{ deletedFiles: number; fixedIndexEntries: number; removedSessions: number }> {
  const removeOrphans = options.removeOrphans !== false;
  const index = await readIndex(state);
  if (!index) {
    return { deletedFiles: 0, fixedIndexEntries: 0, removedSessions: 0 };
  }

  let fixedIndexEntries = 0;
  let deletedFiles = 0;
  let removedSessions = 0;

  const artifactEntries = Object.entries(index.artifacts ?? {});
  for (const [id, entry] of artifactEntries) {
    const absPath = entry.path
      ? toAbsolutePersistPath(state, entry.path)
      : await resolvePersistPath(state, id as ArtifactId, entry.type);
    if (!await state.fileSystem.exists(absPath)) {
      fixedIndexEntries += 1;
    }
  }

  const sessionEntries = Object.entries(index.sessions ?? {});
  for (const [sessionId, entry] of sessionEntries) {
    if (!entry?.path) continue;
    const absPath = toAbsolutePersistPath(state, entry.path);
    if (!await state.fileSystem.exists(absPath)) {
      removedSessions += 1;
    }
  }

  if (removeOrphans) {
    deletedFiles += await countOrphanedArtifacts(state, index);
    deletedFiles += await countOrphanedSessions(state, index);
  }

  return { deletedFiles, fixedIndexEntries, removedSessions };
}

export async function removeOrphanedArtifacts(state: FlowArtifactManagerState): Promise<number> {
  let deleted = 0;
  const entries = await safeReadDirEntries(state, state.persistPath);
  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    if (entry.name === "sessions") continue;
    const dirPath = path.join(state.persistPath, entry.name);
    const files = await safeReadDirEntries(state, dirPath);
    for (const file of files) {
      if (!file.isFile || !file.name.endsWith(".json")) continue;
      const artifactId = file.name.replace(/\.json$/, "");
      if (!state.index.artifacts[artifactId]) {
        const orphanPath = path.join(dirPath, file.name);
        if (await state.fileSystem.exists(orphanPath)) {
          await state.fileSystem.deleteFile(orphanPath);
        }
        deleted += 1;
      }
    }
  }
  return deleted;
}

export async function countOrphanedArtifacts(state: FlowArtifactManagerState, index: FlowArtifactIndex): Promise<number> {
  let count = 0;
  const entries = await safeReadDirEntries(state, state.persistPath);
  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    if (entry.name === "sessions") continue;
    const dirPath = path.join(state.persistPath, entry.name);
    const files = await safeReadDirEntries(state, dirPath);
    for (const file of files) {
      if (!file.isFile || !file.name.endsWith(".json")) continue;
      const artifactId = file.name.replace(/\.json$/, "");
      if (!index.artifacts[artifactId]) {
        count += 1;
      }
    }
  }
  return count;
}

export async function removeOrphanedSessions(state: FlowArtifactManagerState): Promise<number> {
  let deleted = 0;
  const sessionDir = path.join(state.persistPath, "sessions");
  const entries = await safeReadDirEntries(state, sessionDir);
  for (const entry of entries) {
    if (!entry.isFile || !entry.name.endsWith(".json")) continue;
    const sessionId = entry.name.replace(/\.json$/, "");
    if (!state.index.sessions[sessionId]) {
      const orphanPath = path.join(sessionDir, entry.name);
      if (await state.fileSystem.exists(orphanPath)) {
        await state.fileSystem.deleteFile(orphanPath);
      }
      deleted += 1;
    }
  }
  return deleted;
}

export async function countOrphanedSessions(state: FlowArtifactManagerState, index: FlowArtifactIndex): Promise<number> {
  let count = 0;
  const sessionDir = path.join(state.persistPath, "sessions");
  const entries = await safeReadDirEntries(state, sessionDir);
  for (const entry of entries) {
    if (!entry.isFile || !entry.name.endsWith(".json")) continue;
    const sessionId = entry.name.replace(/\.json$/, "");
    if (!index.sessions[sessionId]) {
      count += 1;
    }
  }
  return count;
}

async function restoreArtifactsFromDir(
  state: FlowArtifactManagerState,
  dir: string,
  onStore: (artifact: FlowArtifact) => void
): Promise<number> {
  try {
    const entries = await state.fileSystem.readDir(dir);
    let restored = 0;
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const full = path.join(dir, entry);
      const artifact = await importFromPath(state, full, onStore);
      if (artifact) restored += 1;
    }
    return restored;
  } catch {
    return 0;
  }
}

async function restoreSessionsFromDir(state: FlowArtifactManagerState, dir: string): Promise<void> {
  try {
    const entries = await state.fileSystem.readDir(dir);
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const sessionId = entry.replace(/\.json$/, "");
      await restoreSession(state, sessionId);
    }
  } catch {
    // ignore
  }
}
