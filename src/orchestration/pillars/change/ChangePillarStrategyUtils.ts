import type { StrategySearchCandidate, StrategySearchRequest } from "../../IntentRouter.js";
import { collectEditPaths } from "./ChangePillarEditUtils.js";

export const STRATEGY_SEARCH_DEFAULTS = {
  mode: "auto" as const,
  stage: "r1" as const,
  maxCandidates: 2,
  timeboxMs: 700,
  maxSimulationMs: 350,
  maxImpactMs: 250,
  maxTouchedFiles: 20,
  maxTokensEstimated: 2400,
  weights: {
    files: 1,
    diff: 1,
    tokens: 1,
    risk: 2,
    breaking: 3,
    contract: 3,
    guardsHigh: 2
  },
  mcts: {
    maxDepth: 2,
    maxRollouts: 5,
    exploration: 1.4,
    seed: undefined as number | undefined
  }
};

export const resolveStrategySearchConfig = (raw: any): StrategySearchRequest | null => {
  if (!raw || typeof raw !== "object") return null;
  const mode = raw.mode === "off" || raw.mode === "auto" || raw.mode === "force"
    ? raw.mode
    : STRATEGY_SEARCH_DEFAULTS.mode;
  const stage = raw.stage === "r0" || raw.stage === "r1" || raw.stage === "r2" || raw.stage === "r3"
    ? raw.stage
    : STRATEGY_SEARCH_DEFAULTS.stage;
  const candidates = Array.isArray(raw.candidates)
    ? raw.candidates.filter((entry: any) => entry && typeof entry === "object")
    : [];
  const normalizeInt = (value: any, fallback: number, min: number, max: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(parsed)));
  };
  const normalizeNumber = (value: any, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const weightsRaw = raw?.scoring?.weights ?? {};
  const weights = {
    files: normalizeNumber(weightsRaw.files, STRATEGY_SEARCH_DEFAULTS.weights.files),
    diff: normalizeNumber(weightsRaw.diff, STRATEGY_SEARCH_DEFAULTS.weights.diff),
    tokens: normalizeNumber(weightsRaw.tokens, STRATEGY_SEARCH_DEFAULTS.weights.tokens),
    risk: normalizeNumber(weightsRaw.risk, STRATEGY_SEARCH_DEFAULTS.weights.risk),
    breaking: normalizeNumber(weightsRaw.breaking, STRATEGY_SEARCH_DEFAULTS.weights.breaking),
    contract: normalizeNumber(weightsRaw.contract, STRATEGY_SEARCH_DEFAULTS.weights.contract),
    guardsHigh: normalizeNumber(weightsRaw.guardsHigh, STRATEGY_SEARCH_DEFAULTS.weights.guardsHigh)
  };
  const mctsRaw = raw?.mcts ?? {};
  const seedValue = Number(mctsRaw.seed);
  const mcts = {
    maxDepth: normalizeInt(mctsRaw.maxDepth, STRATEGY_SEARCH_DEFAULTS.mcts.maxDepth, 1, 6),
    maxRollouts: normalizeInt(mctsRaw.maxRollouts, STRATEGY_SEARCH_DEFAULTS.mcts.maxRollouts, 1, 64),
    exploration: normalizeNumber(mctsRaw.exploration, STRATEGY_SEARCH_DEFAULTS.mcts.exploration),
    ...(Number.isFinite(seedValue) ? { seed: seedValue } : {})
  };
  return {
    mode,
    stage,
    candidates,
    maxCandidates: normalizeInt(raw.maxCandidates, STRATEGY_SEARCH_DEFAULTS.maxCandidates, 1, 8),
    timeboxMs: normalizeInt(raw.timeboxMs, STRATEGY_SEARCH_DEFAULTS.timeboxMs, 100, 10_000),
    maxSimulationMs: normalizeInt(raw.maxSimulationMs, STRATEGY_SEARCH_DEFAULTS.maxSimulationMs, 50, 10_000),
    maxImpactMs: normalizeInt(raw.maxImpactMs, STRATEGY_SEARCH_DEFAULTS.maxImpactMs, 0, 10_000),
    maxTouchedFiles: normalizeInt(raw.maxTouchedFiles, STRATEGY_SEARCH_DEFAULTS.maxTouchedFiles, 1, 200),
    maxTokensEstimated: normalizeInt(raw.maxTokensEstimated, STRATEGY_SEARCH_DEFAULTS.maxTokensEstimated, 100, 50_000),
    scoring: { weights },
    mcts
  };
};

export const createSeededRng = (seed?: number): () => number => {
  if (!Number.isFinite(seed)) {
    return () => Math.random();
  }
  let state = Math.floor(seed as number) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

export const mapRiskLevelToScore = (value?: string): number => {
  if (!value) return 0;
  if (value === "low") return 1;
  if (value === "medium") return 2;
  if (value === "high") return 3;
  return 0;
};

export const resolveCandidateTargets = (args: {
  candidate: StrategySearchCandidate;
  baseTargets: string[];
  baseTargetFiles: string[];
}): { targetFiles: string[]; targetPath?: string } => {
  const { candidate, baseTargets, baseTargetFiles } = args;
  const targetFiles: string[] = Array.isArray(candidate.targetFiles)
    ? candidate.targetFiles.filter((entry) => typeof entry === "string" && entry.length > 0)
    : [];
  if (targetFiles.length === 0 && typeof candidate.target === "string" && candidate.target.length > 0) {
    targetFiles.push(candidate.target);
  }
  if (targetFiles.length === 0) {
    targetFiles.push(...collectEditPaths(candidate.edits));
  }
  if (targetFiles.length === 0) {
    targetFiles.push(...baseTargetFiles);
  }
  if (targetFiles.length === 0) {
    targetFiles.push(...baseTargets);
  }
  const targetPath = targetFiles.length === 1 ? targetFiles[0] : undefined;
  return { targetFiles, targetPath };
};
