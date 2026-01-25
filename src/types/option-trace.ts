export type TracePillar = "explore" | "understand" | "change" | "write" | "manage";

export type OptionSource = "explicit" | "session" | "default" | "computed";

export type TraceOptionResolution<T> = {
  source: OptionSource;
  explicit: boolean;
  resolved: T;
  requested?: unknown;
  note?: string;
};

export type TraceSkipCode =
  | "cache_hit"
  | "policy_disabled"
  | "sources_filtered"
  | "unsupported"
  | "budget_exceeded"
  | "timeout"
  | "guardrail_blocked"
  | "not_applicable";

export type DecisionTraceEvent = {
  area: "cache" | "budget" | "guardrails" | "policy" | "index" | "capabilities" | "io" | "other";
  code: string;
  message?: string;
  data?: Record<string, unknown>;
};

export type DecisionTraceV1 = {
  version: 1;
  pillar: TracePillar;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  optionResolution: {
    profile?: TraceOptionResolution<string | null>;
    sources?: TraceOptionResolution<string | null>;
    safety?: TraceOptionResolution<string | null>;
    dryRun?: TraceOptionResolution<boolean>;
    trace?: TraceOptionResolution<boolean>;
  };
  skips?: Array<{ feature: string; code: TraceSkipCode; detail?: string }>;
  budget?: {
    maxTokens?: number;
    maxChars?: number;
    timeoutMs?: number;
    compressionApplied?: boolean;
    compressionMode?: "truncate" | "distill";
  };
  cache?: {
    used?: boolean;
    hit?: boolean;
    keyHint?: string;
  };
  events?: DecisionTraceEvent[];
  truncated?: boolean;
};

export type EffectiveOptionsV1 =
  | {
      version: 1;
      pillar: "explore";
      profile?: string;
      sources?: string;
      view?: string;
      include?: Record<string, boolean>;
      limits?: Record<string, number | undefined>;
    }
  | {
      version: 1;
      pillar: "understand";
      profile?: string;
      sources?: string;
      depth?: string;
      include?: Record<string, boolean>;
      limits?: Record<string, number | undefined>;
    }
  | {
      version: 1;
      pillar: "change";
      profile?: string;
      safety?: string;
      dryRun: boolean;
      reviewOptions?: unknown;
      diffMode?: string;
    }
  | {
      version: 1;
      pillar: "write";
      profile?: string;
      safety?: string;
      dryRun: boolean;
      reviewOptions?: unknown;
      diffMode?: string;
    }
  | {
      version: 1;
      pillar: "manage";
      command?: string;
      scope?: string;
      detail?: string;
    };
