import type { ArtifactId, FlowArtifact, FlowSession } from "../types/flow-artifacts.js";
import type { FlowArtifactIndex, FlowArtifactIndexEntry, FlowArtifactManagerState, FlowSessionIndexEntry } from "./flow-artifact-manager.types.js";
import { toRelativePersistPath } from "./flow-artifact-manager.paths.js";

function schedulePersistIndex(state: FlowArtifactManagerState): void {
  void persistIndex(state).catch(() => {
    // Auto-persist is best-effort; callers may tear down temp workspaces.
  });
}

export function updateIndexForArtifact(state: FlowArtifactManagerState, artifact: FlowArtifact, filePath?: string): void {
  const entry: FlowArtifactIndexEntry = {
    type: artifact.type,
    sessionId: artifact.sessionId,
    createdAt: artifact.createdAt
  };
  if (filePath) {
    entry.path = toRelativePersistPath(state, filePath);
  }
  state.index.artifacts[artifact.id] = {
    ...state.index.artifacts[artifact.id],
    ...entry
  };
  touchIndex(state);
  if (state.options.autoPersist) {
    schedulePersistIndex(state);
  }
}

export function updateIndexForSession(state: FlowArtifactManagerState, session: FlowSession, filePath?: string): void {
  const entry: FlowSessionIndexEntry = {
    status: session.status,
    updatedAt: session.updatedAt ?? session.startedAt
  };
  if (filePath) {
    entry.path = toRelativePersistPath(state, filePath);
  }
  state.index.sessions[session.id] = {
    ...state.index.sessions[session.id],
    ...entry
  };
  touchIndex(state);
  if (state.options.autoPersist) {
    schedulePersistIndex(state);
  }
}

export function removeIndexEntry(state: FlowArtifactManagerState, id: ArtifactId): void {
  if (state.index.artifacts[id]) {
    delete state.index.artifacts[id];
    touchIndex(state);
    if (state.options.autoPersist) {
      schedulePersistIndex(state);
    }
  }
}

export function touchIndex(state: FlowArtifactManagerState): void {
  state.index.updatedAt = Date.now();
}

export async function persistIndex(state: FlowArtifactManagerState): Promise<void> {
  await state.fileSystem.createDir(state.persistPath);
  await state.fileSystem.writeFile(state.indexPath, JSON.stringify(state.index, null, 2));
}

export async function readIndex(state: FlowArtifactManagerState): Promise<FlowArtifactIndex | null> {
  try {
    const raw = await state.fileSystem.readFile(state.indexPath);
    const parsed = JSON.parse(raw) as FlowArtifactIndex;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      version: parsed.version ?? 1,
      updatedAt: parsed.updatedAt ?? 0,
      artifacts: parsed.artifacts ?? {},
      sessions: parsed.sessions ?? {}
    };
  } catch {
    return null;
  }
}
