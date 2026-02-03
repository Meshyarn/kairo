import type { IFileSystem } from "../platform/FileSystem.js";
import type { ArtifactType, FlowSession, FlowSessionStatus } from "../types/flow-artifacts.js";

export interface FlowArtifactManagerOptions {
  maxCacheSize?: number;
  defaultTTL?: number;
  persistPath?: string;
  autoPersist?: boolean;
  fileSystem?: IFileSystem;
}

export interface FlowArtifactIndexEntry {
  type: ArtifactType;
  path?: string;
  sessionId?: string;
  createdAt?: number;
}

export interface FlowSessionIndexEntry {
  path?: string;
  status?: FlowSessionStatus;
  updatedAt?: number;
}

export interface FlowArtifactIndex {
  version: number;
  updatedAt: number;
  artifacts: Record<string, FlowArtifactIndexEntry>;
  sessions: Record<string, FlowSessionIndexEntry>;
}

export type ApplyTokenValidationResult = {
  valid: boolean;
  reason?: "missing" | "expired" | "used" | "invalid";
  issuedAt?: number;
  expiresAt?: number;
};

export type FlowArtifactManagerState = {
  options: FlowArtifactManagerOptions;
  fileSystem: IFileSystem;
  persistPath: string;
  indexPath: string;
  index: FlowArtifactIndex;
  sessions: Map<string, FlowSession>;
};
