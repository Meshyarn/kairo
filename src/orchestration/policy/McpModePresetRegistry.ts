import path from "path";
import { PathManager } from "../../utils/PathManager.js";
import { NodeFileSystem } from "../../platform/FileSystem.js";

export type McpMode = "mcp" | "dev" | "ci";
export type McpPresetId = "mcp-lean" | "mcp-balanced" | "mcp-deep";
export type McpPublicSurface = "compact" | "pillars";
export type PolicyProfile = "lean" | "fast" | "balanced" | "deep";
export type TaskBudget = "lean" | "balanced" | "deep";

export type TaskBudgetPolicy = {
  maxSteps: number;
  defaultLod: 0 | 1 | 2 | 3 | 4;
  maxEvidenceItems: number;
  maxExcerptChars: number;
  maxEvidenceFiles: number;
  minTargets: number;
  minEvidence: number;
};

export type ApplyHandshakePolicy = {
  required: boolean;
  tokenTtlMs: number;
  oneTime: boolean;
  invalidateOnDrift: boolean;
};

export type AutopilotPolicy = {
  autoModeNeverApplies: boolean;
  defaultOutputFormat: "summary" | "standard";
  maxAutoRepairAttempts: number;
  allowAutoReindex: boolean;
};

export type EnvelopeMaxTokens = {
  explore?: number;
  understand?: number;
  change?: number;
  write?: number;
  manage?: number;
};

export type McpConfigFile = {
  version?: number;
  mode?: McpMode;
  preset?: McpPresetId;
  publicSurface?: McpPublicSurface;
  applyHandshake?: {
    required?: boolean;
    tokenTtlMs?: number;
    oneTime?: boolean;
    invalidateOnDrift?: boolean;
  };
  autopilot?: {
    autoModeNeverApplies?: boolean;
    defaultOutputFormat?: "summary" | "standard";
    maxAutoRepairAttempts?: number;
    allowAutoReindex?: boolean;
  };
  budgets?: {
    profile?: PolicyProfile;
    envelopeMaxTokens?: EnvelopeMaxTokens;
  };
  timeboxMs?: {
    total?: number;
    perStep?: number;
  };
};

type McpPreset = {
  id: McpPresetId;
  profile: PolicyProfile;
  publicSurface: McpPublicSurface;
  budgets: {
    envelopeMaxTokens: Required<EnvelopeMaxTokens>;
  };
  timeboxMs?: {
    total: number;
    perStep: number;
  };
};

export type McpResolvedPolicy = {
  mode: McpMode;
  preset?: McpPresetId;
  publicSurface: McpPublicSurface;
  profile?: PolicyProfile;
  applyHandshake: ApplyHandshakePolicy;
  autopilot: AutopilotPolicy;
  budgets: {
    envelopeMaxTokens: EnvelopeMaxTokens;
  };
  timeboxMs?: {
    total?: number;
    perStep?: number;
  };
};

export type McpTimeboxPolicy = {
  total?: number;
  perStep?: number;
};

export type McpPolicyOverrides = {
  mode?: McpMode;
  preset?: McpPresetId;
  publicSurface?: McpPublicSurface;
  budgets?: {
    profile?: PolicyProfile;
    envelopeMaxTokens?: EnvelopeMaxTokens;
  };
  timeboxMs?: {
    total?: number;
    perStep?: number;
  };
};

const TASK_BUDGET_POLICIES: Record<TaskBudget, TaskBudgetPolicy> = {
  lean: {
    maxSteps: 1,
    defaultLod: 1,
    maxEvidenceItems: 2,
    maxExcerptChars: 240,
    maxEvidenceFiles: 2,
    minTargets: 2,
    minEvidence: 1
  },
  balanced: {
    maxSteps: 2,
    defaultLod: 2,
    maxEvidenceItems: 4,
    maxExcerptChars: 400,
    maxEvidenceFiles: 4,
    minTargets: 3,
    minEvidence: 2
  },
  deep: {
    maxSteps: 3,
    defaultLod: 3,
    maxEvidenceItems: 6,
    maxExcerptChars: 800,
    maxEvidenceFiles: 6,
    minTargets: 5,
    minEvidence: 3
  }
};

const MCP_PRESETS: Record<McpPresetId, McpPreset> = {
  "mcp-lean": {
    id: "mcp-lean",
    profile: "lean",
    publicSurface: "compact",
    budgets: {
      envelopeMaxTokens: {
        explore: 4000,
        understand: 5000,
        change: 4000,
        write: 4000,
        manage: 6000
      }
    },
    timeboxMs: {
      total: 15000,
      perStep: 5000
    }
  },
  "mcp-balanced": {
    id: "mcp-balanced",
    profile: "balanced",
    publicSurface: "compact",
    budgets: {
      envelopeMaxTokens: {
        explore: 6000,
        understand: 8000,
        change: 6000,
        write: 6000,
        manage: 10000
      }
    },
    timeboxMs: {
      total: 20000,
      perStep: 5000
    }
  },
  "mcp-deep": {
    id: "mcp-deep",
    profile: "deep",
    publicSurface: "pillars",
    budgets: {
      envelopeMaxTokens: {
        explore: 10000,
        understand: 12000,
        change: 10000,
        write: 10000,
        manage: 20000
      }
    },
    timeboxMs: {
      total: 45000,
      perStep: 9000
    }
  }
};

let cachedConfig: { path: string; mtimeMs: number; config: McpConfigFile } | null = null;

const parseMode = (value: unknown): McpMode | undefined => {
  if (value === "mcp" || value === "dev" || value === "ci") return value;
  return undefined;
};

const parsePreset = (value: unknown): McpPresetId | undefined => {
  if (value === "mcp-lean" || value === "mcp-balanced" || value === "mcp-deep") return value;
  return undefined;
};

const parseSurface = (value: unknown): McpPublicSurface | undefined => {
  if (value === "compact" || value === "pillars") return value;
  return undefined;
};

const parseProfile = (value: unknown): PolicyProfile | undefined => {
  if (value === "lean" || value === "fast" || value === "balanced" || value === "deep") return value;
  return undefined;
};

const parseNumber = (value: unknown): number | undefined => {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
};

const readEnvNumber = (key: string): number | undefined => {
  const raw = process.env[key];
  if (!raw) return undefined;
  return parseNumber(raw);
};

const sanitizeConfig = (raw: any): McpConfigFile => {
  const config: McpConfigFile = {};
  config.version = parseNumber(raw?.version);
  config.mode = parseMode(raw?.mode);
  config.preset = parsePreset(raw?.preset);
  config.publicSurface = parseSurface(raw?.publicSurface);
  if (raw?.applyHandshake && typeof raw.applyHandshake === "object") {
    const applyHandshake = raw.applyHandshake;
    config.applyHandshake = {
      required: typeof applyHandshake.required === "boolean" ? applyHandshake.required : undefined,
      tokenTtlMs: parseNumber(applyHandshake.tokenTtlMs),
      oneTime: typeof applyHandshake.oneTime === "boolean" ? applyHandshake.oneTime : undefined,
      invalidateOnDrift: typeof applyHandshake.invalidateOnDrift === "boolean" ? applyHandshake.invalidateOnDrift : undefined
    };
  }
  if (raw?.autopilot && typeof raw.autopilot === "object") {
    const autopilot = raw.autopilot;
    config.autopilot = {
      autoModeNeverApplies: typeof autopilot.autoModeNeverApplies === "boolean" ? autopilot.autoModeNeverApplies : undefined,
      defaultOutputFormat: autopilot.defaultOutputFormat === "summary" || autopilot.defaultOutputFormat === "standard"
        ? autopilot.defaultOutputFormat
        : undefined,
      maxAutoRepairAttempts: parseNumber(autopilot.maxAutoRepairAttempts),
      allowAutoReindex: typeof autopilot.allowAutoReindex === "boolean" ? autopilot.allowAutoReindex : undefined
    };
  }
  if (raw?.budgets && typeof raw.budgets === "object") {
    const budgets = raw.budgets;
    config.budgets = {
      profile: parseProfile(budgets.profile),
      envelopeMaxTokens: {
        explore: parseNumber(budgets.envelopeMaxTokens?.explore),
        understand: parseNumber(budgets.envelopeMaxTokens?.understand),
        change: parseNumber(budgets.envelopeMaxTokens?.change),
        write: parseNumber(budgets.envelopeMaxTokens?.write),
        manage: parseNumber(budgets.envelopeMaxTokens?.manage)
      }
    };
  }
  if (raw?.timeboxMs && typeof raw.timeboxMs === "object") {
    const timebox = raw.timeboxMs;
    config.timeboxMs = {
      total: parseNumber(timebox.total),
      perStep: parseNumber(timebox.perStep)
    };
  }
  return config;
};

const resolveConfigPath = (): string => {
  return path.join(PathManager.getConfigDir(), "mcp.json");
};

const loadConfig = (): McpConfigFile | undefined => {
  const configPath = resolveConfigPath();
  const fileSystem = new NodeFileSystem(PathManager.getRootPath());
  if (!fileSystem.existsSync?.(configPath)) {
    cachedConfig = null;
    return undefined;
  }
  let stats: { mtime: number };
  try {
    stats = fileSystem.statSync?.(configPath) ?? { mtime: 0 };
  } catch {
    return undefined;
  }
  if (cachedConfig && cachedConfig.path === configPath && cachedConfig.mtimeMs === stats.mtime) {
    return cachedConfig.config;
  }
  try {
    const raw = fileSystem.readFileSync?.(configPath) ?? "";
    const parsed = JSON.parse(raw);
    const config = sanitizeConfig(parsed);
    cachedConfig = { path: configPath, mtimeMs: stats.mtime, config };
    return config;
  } catch (error) {
    console.warn(`[McpModePresetRegistry] Failed to read ${path.basename(configPath)}:`, error);
    return undefined;
  }
};

const resolvePresetId = (mode: McpMode, overrides?: McpPolicyOverrides, config?: McpConfigFile): McpPresetId | undefined => {
  const explicit = overrides?.preset;
  if (explicit) return explicit;
  const configPreset = mode === "mcp" ? config?.preset : undefined;
  if (configPreset) return configPreset;
  const envPreset = parsePreset(process.env.KAIRO_PRESET);
  if (envPreset) return envPreset;
  if (mode === "mcp") return "mcp-balanced";
  return undefined;
};

const resolveEnvelopeBudget = (
  mode: McpMode,
  pillar: keyof EnvelopeMaxTokens,
  preset: McpPreset | undefined,
  overrides?: McpPolicyOverrides,
  config?: McpConfigFile
): number | undefined => {
  const explicit = parseNumber(overrides?.budgets?.envelopeMaxTokens?.[pillar]);
  if (explicit !== undefined) return explicit;
  const configValue = mode === "mcp" ? parseNumber(config?.budgets?.envelopeMaxTokens?.[pillar]) : undefined;
  if (configValue !== undefined) return configValue;
  const envValue = readEnvNumber(`KAIRO_${pillar.toUpperCase()}_MAX_TOKENS`) ?? readEnvNumber("KAIRO_DEFAULT_MAX_TOKENS");
  if (envValue !== undefined) return envValue;
  const presetValue = mode === "mcp" ? preset?.budgets.envelopeMaxTokens[pillar] : undefined;
  return presetValue;
};

export const resolveMcpPolicy = (overrides?: McpPolicyOverrides): McpResolvedPolicy => {
  const config = loadConfig();
  const envMode = parseMode(process.env.KAIRO_MODE);
  const mode = overrides?.mode ?? envMode ?? config?.mode ?? "mcp";
  const presetId = resolvePresetId(mode, overrides, config);
  const preset = presetId ? MCP_PRESETS[presetId] : undefined;
  const applyHandshakeDefaults: ApplyHandshakePolicy = {
    required: mode === "mcp",
    tokenTtlMs: 30 * 60 * 1000,
    oneTime: true,
    invalidateOnDrift: true
  };
  const applyHandshakeConfig = mode === "mcp" ? config?.applyHandshake : undefined;
  const applyHandshake: ApplyHandshakePolicy = {
    required: typeof applyHandshakeConfig?.required === "boolean"
      ? applyHandshakeConfig.required
      : applyHandshakeDefaults.required,
    tokenTtlMs: parseNumber(applyHandshakeConfig?.tokenTtlMs) ?? applyHandshakeDefaults.tokenTtlMs,
    oneTime: typeof applyHandshakeConfig?.oneTime === "boolean"
      ? applyHandshakeConfig.oneTime
      : applyHandshakeDefaults.oneTime,
    invalidateOnDrift: typeof applyHandshakeConfig?.invalidateOnDrift === "boolean"
      ? applyHandshakeConfig.invalidateOnDrift
      : applyHandshakeDefaults.invalidateOnDrift
  };
  const publicSurface = overrides?.publicSurface
    ?? parseSurface(process.env.KAIRO_PUBLIC_SURFACE)
    ?? (mode === "mcp" ? config?.publicSurface : undefined)
    ?? preset?.publicSurface
    ?? (mode === "mcp" ? "compact" : "pillars");
  const profile = overrides?.budgets?.profile
    ?? (mode === "mcp" ? config?.budgets?.profile : undefined)
    ?? preset?.profile;
  const autopilotDefaults: AutopilotPolicy = {
    autoModeNeverApplies: true,
    defaultOutputFormat: mode === "mcp" ? "summary" : "standard",
    maxAutoRepairAttempts: 0,
    allowAutoReindex: false
  };
  const autopilotConfig = mode === "mcp" ? config?.autopilot : undefined;
  const autopilot: AutopilotPolicy = {
    autoModeNeverApplies: typeof autopilotConfig?.autoModeNeverApplies === "boolean"
      ? autopilotConfig.autoModeNeverApplies
      : autopilotDefaults.autoModeNeverApplies,
    defaultOutputFormat: autopilotConfig?.defaultOutputFormat ?? autopilotDefaults.defaultOutputFormat,
    maxAutoRepairAttempts: parseNumber(autopilotConfig?.maxAutoRepairAttempts) ?? autopilotDefaults.maxAutoRepairAttempts,
    allowAutoReindex: typeof autopilotConfig?.allowAutoReindex === "boolean"
      ? autopilotConfig.allowAutoReindex
      : autopilotDefaults.allowAutoReindex
  };

  return {
    mode,
    preset: presetId,
    publicSurface,
    profile,
    applyHandshake,
    autopilot,
    budgets: {
      envelopeMaxTokens: {
        explore: resolveEnvelopeBudget(mode, "explore", preset, overrides, config),
        understand: resolveEnvelopeBudget(mode, "understand", preset, overrides, config),
        change: resolveEnvelopeBudget(mode, "change", preset, overrides, config),
        write: resolveEnvelopeBudget(mode, "write", preset, overrides, config),
        manage: resolveEnvelopeBudget(mode, "manage", preset, overrides, config)
      }
    },
    timeboxMs: {
      total: parseNumber(overrides?.timeboxMs?.total)
        ?? (mode === "mcp" ? parseNumber(config?.timeboxMs?.total) : undefined)
        ?? preset?.timeboxMs?.total,
      perStep: parseNumber(overrides?.timeboxMs?.perStep)
        ?? (mode === "mcp" ? parseNumber(config?.timeboxMs?.perStep) : undefined)
        ?? preset?.timeboxMs?.perStep
    }
  };
};

export const resolveEnvelopeMaxTokens = (pillar: keyof EnvelopeMaxTokens): number | undefined => {
  const policy = resolveMcpPolicy();
  return policy.budgets.envelopeMaxTokens[pillar];
};

export const resolveMcpMode = (): McpMode => {
  return resolveMcpPolicy().mode;
};

export const resolveApplyHandshakePolicy = (): ApplyHandshakePolicy => {
  return resolveMcpPolicy().applyHandshake;
};

export const resolveAutopilotPolicy = (): AutopilotPolicy => {
  return resolveMcpPolicy().autopilot;
};

export const resolvePublicSurface = (): McpPublicSurface => {
  return resolveMcpPolicy().publicSurface;
};

export const resolveTimeboxPolicy = (): McpTimeboxPolicy => {
  return resolveMcpPolicy().timeboxMs ?? {};
};

export const resolveTaskBudgetPolicy = (budget?: string): TaskBudgetPolicy => {
  if (budget === "balanced" || budget === "deep" || budget === "lean") {
    return TASK_BUDGET_POLICIES[budget];
  }
  return TASK_BUDGET_POLICIES.balanced;
};

export const resolveDefaultProfile = (_tool?: string): PolicyProfile | undefined => {
  const policy = resolveMcpPolicy();
  return policy.mode === "mcp" ? policy.profile : undefined;
};

export const resolveLogToFileEnabled = (): boolean => {
  const raw = process.env.KAIRO_LOG_TO_FILE;
  if (raw !== undefined) {
    return raw === "true";
  }
  const policy = resolveMcpPolicy();
  return policy.mode === "mcp";
};
