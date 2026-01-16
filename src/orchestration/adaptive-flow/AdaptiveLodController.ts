import type { ToolProfile } from "../options/OptionResolver.js";

export type AdaptiveLodDecision = {
  profile: ToolProfile;
  downshifted: boolean;
  forced: boolean;
  reasonCodes: string[];
  stableScore: number;
  violationStreak: number;
  cooldownRemaining?: number;
};

type AdaptiveLodEvent = {
  timestamp: number;
  violation: boolean;
  stable: boolean;
  reasonCodes: string[];
};

type AdaptiveLodState = {
  events: AdaptiveLodEvent[];
  violationStreak: number;
  callCount: number;
  lastDownshiftCall?: number;
  lastAppliedProfile?: ToolProfile;
  lastViolationReasons: string[];
};

const PROFILE_ORDER: ToolProfile[] = ["lean", "fast", "balanced", "deep"];

const COST_VIOLATION_REASONS = new Set([
  "budget_exceeded",
  "response_budget_exceeded"
]);

const DEFAULT_WINDOW = parseInt(process.env.KAIRO_ADAPTIVE_LOD_WINDOW ?? "", 10) || 12;
const DEFAULT_COOLDOWN = parseInt(process.env.KAIRO_ADAPTIVE_LOD_COOLDOWN_CALLS ?? "", 10) || 20;

export class AdaptiveLodController {
  private readonly states = new Map<string, AdaptiveLodState>();
  private readonly windowSize: number;
  private readonly cooldownCalls: number;
  private readonly enabled: boolean;

  constructor(options?: { windowSize?: number; cooldownCalls?: number; enabled?: boolean }) {
    this.windowSize = Math.max(1, options?.windowSize ?? DEFAULT_WINDOW);
    this.cooldownCalls = Math.max(1, options?.cooldownCalls ?? DEFAULT_COOLDOWN);
    this.enabled = options?.enabled ?? resolveEnabled();
  }

  public resolveProfile(args: {
    sessionId?: string;
    tool: string;
    requestedProfile?: ToolProfile;
    explicit: boolean;
  }): AdaptiveLodDecision | undefined {
    if (!this.enabled) return undefined;
    const state = this.getState(this.buildKey(args.sessionId, args.tool));
    state.callCount += 1;

    const baseProfile = normalizeProfile(args.requestedProfile);
    const baseLevel = toProfileLevel(baseProfile);

    let targetLevel = baseLevel;
    let forced = false;
    let downshifted = false;
    const reasonCodes = [...state.lastViolationReasons];

    if (!args.explicit) {
      if (state.violationStreak >= 2) {
        targetLevel = 0;
        forced = true;
      } else if (state.violationStreak >= 1) {
        targetLevel = Math.max(0, baseLevel - 1);
      }
      const cooldownRemaining = this.resolveCooldownRemaining(state);
      if (cooldownRemaining !== undefined && state.lastAppliedProfile) {
        const previousLevel = toProfileLevel(state.lastAppliedProfile);
        targetLevel = Math.min(targetLevel, previousLevel);
      }
      downshifted = targetLevel < baseLevel;
      if (downshifted) {
        state.lastDownshiftCall = state.callCount;
        state.lastAppliedProfile = fromProfileLevel(targetLevel);
      }
    }

    const stableScore = computeStableScore(state.events);
    const cooldownRemaining = this.resolveCooldownRemaining(state);

    return {
      profile: fromProfileLevel(targetLevel),
      downshifted,
      forced,
      reasonCodes,
      stableScore,
      violationStreak: state.violationStreak,
      cooldownRemaining
    };
  }

  public recordOutcome(args: {
    sessionId?: string;
    tool: string;
    success: boolean;
    degradedReasons?: Array<{ type: string }>;
  }): void {
    if (!this.enabled) return;
    const state = this.getState(this.buildKey(args.sessionId, args.tool));
    const reasonCodes = Array.isArray(args.degradedReasons)
      ? args.degradedReasons.map(reason => reason.type).filter(Boolean)
      : [];
    const costViolation = reasonCodes.some((code) => COST_VIOLATION_REASONS.has(code));
    const violation = !args.success || costViolation;
    const stable = args.success && !violation;

    if (violation) {
      state.violationStreak += 1;
      state.lastViolationReasons = reasonCodes.length > 0 ? reasonCodes : ["unstable_result"];
    } else {
      state.violationStreak = 0;
      state.lastViolationReasons = [];
    }

    state.events.push({
      timestamp: Date.now(),
      violation,
      stable,
      reasonCodes: violation ? state.lastViolationReasons : []
    });
    trimEvents(state.events, this.windowSize);
  }

  public recordUndoRedo(args: { sessionId?: string; tool: string }): void {
    if (!this.enabled) return;
    const state = this.getState(this.buildKey(args.sessionId, args.tool));
    state.violationStreak += 1;
    state.lastViolationReasons = ["undo_or_redo"];
    state.events.push({
      timestamp: Date.now(),
      violation: true,
      stable: false,
      reasonCodes: ["undo_or_redo"]
    });
    trimEvents(state.events, this.windowSize);
  }

  private resolveCooldownRemaining(state: AdaptiveLodState): number | undefined {
    if (!state.lastDownshiftCall) return undefined;
    const elapsed = state.callCount - state.lastDownshiftCall;
    if (elapsed >= this.cooldownCalls) return undefined;
    return this.cooldownCalls - elapsed;
  }

  private buildKey(sessionId: string | undefined, tool: string): string {
    const sessionKey = sessionId ?? "global";
    return `${sessionKey}:${tool}`;
  }

  private getState(key: string): AdaptiveLodState {
    const existing = this.states.get(key);
    if (existing) return existing;
    const next: AdaptiveLodState = {
      events: [],
      violationStreak: 0,
      callCount: 0,
      lastViolationReasons: []
    };
    this.states.set(key, next);
    return next;
  }
}

function trimEvents(events: AdaptiveLodEvent[], windowSize: number): void {
  if (events.length <= windowSize) return;
  events.splice(0, events.length - windowSize);
}

function normalizeProfile(profile?: ToolProfile): ToolProfile {
  return profile ?? "balanced";
}

function toProfileLevel(profile: ToolProfile): number {
  return PROFILE_ORDER.indexOf(profile);
}

function fromProfileLevel(level: number): ToolProfile {
  return PROFILE_ORDER[Math.max(0, Math.min(PROFILE_ORDER.length - 1, level))] ?? "balanced";
}

function computeStableScore(events: AdaptiveLodEvent[]): number {
  if (events.length === 0) return 1;
  const stableCount = events.reduce((sum, event) => sum + (event.stable ? 1 : 0), 0);
  return stableCount / events.length;
}

function resolveEnabled(): boolean {
  const raw = process.env.KAIRO_ADAPTIVE_LOD_ENABLED;
  if (!raw) return true;
  const normalized = raw.trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  return true;
}
