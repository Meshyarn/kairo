import { FeatureFlags } from "../../config/FeatureFlags.js";
import type { IntentConstraints } from "../IntentRouter.js";
import type { SessionPolicy } from "../../types/flow-artifacts.js";

export type ToolProfile = "fast" | "balanced" | "deep";
export type ToolSources = "code" | "docs" | "both";
export type ToolSafety = "plan" | "apply";

type ExploreEffective = {
  profile?: ToolProfile;
  sources?: ToolSources;
  include: { docs?: boolean; code?: boolean; comments?: boolean; logs?: boolean };
  limits: {
    maxResults?: number;
    maxChars?: number;
    maxItemChars?: number;
    maxBytes?: number;
    maxFiles?: number;
    timeoutMs?: number;
  };
  view: "auto" | "preview" | "section" | "full";
  traceEnabled: boolean;
};

type ExploreMeta = {
  includeExplicit: boolean;
  limitsExplicit: boolean;
  viewExplicit: boolean;
  profileExplicit: boolean;
  sourcesExplicit: boolean;
  sourcesWantsDocs: boolean;
  profileApplied: boolean;
  sourcesApplied: boolean;
  profileAffectsPack: boolean;
  sourcesAffectsPack: boolean;
};

type UnderstandEffective = {
  profile?: ToolProfile;
  sources?: ToolSources;
  depth?: "shallow" | "standard" | "deep";
  include: {
    callGraph?: boolean;
    hotSpots?: boolean;
    pageRank?: boolean;
    dependencies?: boolean;
  };
  traceEnabled: boolean;
};

type WriteLikeEffective = {
  profile?: ToolProfile;
  safety?: ToolSafety;
  dryRun: boolean;
  reviewOptions: any;
  traceEnabled: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isToolProfile = (value: unknown): value is ToolProfile =>
  value === "fast" || value === "balanced" || value === "deep";

const isToolSources = (value: unknown): value is ToolSources =>
  value === "code" || value === "docs" || value === "both";

const isToolSafety = (value: unknown): value is ToolSafety =>
  value === "plan" || value === "apply";

const setIfUnset = <T extends Record<string, any>>(target: T, key: keyof T, value: any): boolean => {
  if (target[key] !== undefined) return false;
  target[key] = value;
  return true;
};

export class OptionResolver {
  static resolveExploreOptions(
    args: IntentConstraints,
    sessionPolicy?: SessionPolicy
  ): { effective: ExploreEffective; meta: ExploreMeta } {
    const enableProfiles = true;
    const enableSessionPolicy = true;
    const include = (isRecord(args.include)
      ? { ...(args.include as Record<string, unknown>) }
      : {}) as ExploreEffective["include"];
    const limits = isRecord(args.limits) ? { ...args.limits } : {};
    const view = typeof args.view === "string" ? args.view : "auto";
    const traceEnabled = args.trace === true;
    const includeExplicit = Object.keys(include).length > 0;
    const limitsExplicit = Object.keys(limits).length > 0;
    const viewExplicit = typeof args.view === "string";

    const profileExplicit = isToolProfile(args.profile);
    const sourcesExplicit = isToolSources(args.sources);
    const profileFromArgs = profileExplicit ? args.profile : undefined;
    const sourcesFromArgs = sourcesExplicit ? args.sources : undefined;
    const sessionProfile = enableSessionPolicy
      ? (sessionPolicy?.explore?.profile ?? sessionPolicy?.profile)
      : undefined;
    const sessionSources = enableSessionPolicy
      ? (sessionPolicy?.explore?.sources ?? sessionPolicy?.sources)
      : undefined;
    const profile = isToolProfile(profileFromArgs ?? sessionProfile) ? (profileFromArgs ?? sessionProfile) : undefined;
    const sources = isToolSources(sourcesFromArgs ?? sessionSources) ? (sourcesFromArgs ?? sessionSources) : undefined;

    const profileAppliedFromSession = !profileExplicit && Boolean(sessionProfile);
    const sourcesAppliedFromSession = !sourcesExplicit && Boolean(sessionSources);
    const profileAllowed = profileExplicit || profileAppliedFromSession || enableProfiles;
    const sourcesAllowed = sourcesExplicit || sourcesAppliedFromSession || enableProfiles;
    let profileApplied = false;
    let sourcesApplied = false;
    let profileAffectsPack = false;
    let sourcesAffectsPack = false;

    if (sourcesAllowed && sources && !includeExplicit) {
      include.docs = sources !== "code";
      include.code = sources !== "docs";
      if (include.docs && profile === "deep") {
        setIfUnset(include, "comments", true);
      }
      setIfUnset(include, "logs", false);
      sourcesApplied = true;
      sourcesAffectsPack = true;
    }

    if (profileAllowed && profile === "fast") {
      if (setIfUnset(limits, "maxResults", 5)) profileAffectsPack = true;
      if (setIfUnset(limits, "maxFiles", 80)) profileAffectsPack = true;
      setIfUnset(limits, "maxChars", 6000);
      profileApplied = true;
    }

    if (profileAllowed && profile === "deep") {
      if (setIfUnset(limits, "maxResults", 12)) profileAffectsPack = true;
      if (setIfUnset(limits, "maxFiles", 300)) profileAffectsPack = true;
      setIfUnset(limits, "maxChars", 12000);
      profileApplied = true;
    }

    const effectiveView = viewExplicit ? view : (profile === "fast" ? "preview" : "auto");

    const sourcesWantsDocs = sources === "docs" || sources === "both";

    return {
      effective: {
        profile,
        sources,
        include,
        limits,
        view: effectiveView as ExploreEffective["view"],
        traceEnabled
      },
      meta: {
        includeExplicit,
        limitsExplicit,
        viewExplicit,
        profileExplicit: Boolean(profileExplicit),
        sourcesExplicit: Boolean(sourcesExplicit),
        sourcesWantsDocs,
        profileApplied: profileApplied || profileAppliedFromSession,
        sourcesApplied: sourcesApplied || sourcesAppliedFromSession,
        profileAffectsPack,
        sourcesAffectsPack
      }
    };
  }

  static resolveUnderstandOptions(
    args: IntentConstraints,
    sessionPolicy?: SessionPolicy
  ): { effective: UnderstandEffective } {
    const enableProfiles = true;
    const enableSessionPolicy = true;
    const include = (isRecord(args.include)
      ? { ...(args.include as Record<string, unknown>) }
      : {}) as UnderstandEffective["include"];
    const traceEnabled = args.trace === true;
    const profileExplicit = isToolProfile(args.profile);
    const sourcesExplicit = isToolSources(args.sources);
    const profileFromArgs = profileExplicit ? args.profile : undefined;
    const sourcesFromArgs = sourcesExplicit ? args.sources : undefined;
    const sessionProfile = enableSessionPolicy
      ? (sessionPolicy?.understand?.profile ?? sessionPolicy?.profile)
      : undefined;
    const sessionSources = enableSessionPolicy
      ? (sessionPolicy?.understand?.sources ?? sessionPolicy?.sources)
      : undefined;
    const profile = isToolProfile(profileFromArgs ?? sessionProfile) ? (profileFromArgs ?? sessionProfile) : undefined;
    const sources = isToolSources(sourcesFromArgs ?? sessionSources) ? (sourcesFromArgs ?? sessionSources) : undefined;
    const depthExplicit = typeof args.depth === "string";
    const profileAppliedFromSession = !profileExplicit && Boolean(sessionProfile);
    const profileAllowed = Boolean(profileExplicit) || profileAppliedFromSession || enableProfiles;

    let depth = args.depth;
    if (!depthExplicit && profileAllowed && profile === "fast") {
      depth = "shallow";
    }
    if (!depthExplicit && profileAllowed && profile === "deep") {
      depth = "deep";
      setIfUnset(include, "dependencies", true);
      setIfUnset(include, "pageRank", true);
      setIfUnset(include, "hotSpots", true);
    }

    return {
      effective: {
        profile,
        sources,
        depth,
        include,
        traceEnabled
      }
    };
  }

  static resolveWriteOptions(
    args: IntentConstraints,
    sessionId?: string,
    sessionPolicy?: SessionPolicy
  ): { effective: WriteLikeEffective } {
    const enableSessionPolicy = true;
    const profileExplicit = isToolProfile(args.profile);
    const safetyExplicit = isToolSafety(args.safety);
    const profileFromArgs = profileExplicit ? args.profile : undefined;
    const safetyFromArgs = safetyExplicit ? args.safety : undefined;
    const sessionProfile = enableSessionPolicy
      ? (sessionPolicy?.write?.profile ?? sessionPolicy?.profile)
      : undefined;
    const sessionSafety = enableSessionPolicy
      ? (sessionPolicy?.write?.safety ?? sessionPolicy?.safety)
      : undefined;
    const profile = isToolProfile(profileFromArgs ?? sessionProfile) ? (profileFromArgs ?? sessionProfile) : undefined;
    const safety = isToolSafety(safetyFromArgs ?? sessionSafety) ? (safetyFromArgs ?? sessionSafety) : undefined;
    const traceEnabled = args.trace === true;
    const dryRun = this.resolveDryRun(args, sessionId, safety);
    const reviewOptions = this.resolveReviewOptions(args.reviewOptions, Boolean(sessionId), profile, dryRun);

    return {
      effective: {
        profile,
        safety,
        dryRun,
        reviewOptions,
        traceEnabled
      }
    };
  }

  static resolveChangeOptions(
    args: IntentConstraints,
    sessionId?: string,
    sessionPolicy?: SessionPolicy
  ): { effective: WriteLikeEffective } {
    return this.resolveWriteOptions(args, sessionId, sessionPolicy);
  }

  static resolveChunkingOptions(profile?: ToolProfile): { maxTokens: number; overlapTokens: number } {
    if (profile === "fast") {
      return { maxTokens: 384, overlapTokens: 32 };
    }
    if (profile === "deep") {
      return { maxTokens: 768, overlapTokens: 128 };
    }
    return { maxTokens: 512, overlapTokens: 64 };
  }

  private static resolveDryRun(args: IntentConstraints, sessionId: string | undefined, safety?: ToolSafety): boolean {
    if (typeof args.dryRun === "boolean") return args.dryRun;
    if (safety === "plan") return true;
    if (safety === "apply") return false;
    if (sessionId && FeatureFlags.isEnabled(FeatureFlags.WRITERS_FLOW_DEFAULT_DRYRUN)) {
      return true;
    }
    return false;
  }

  private static resolveReviewOptions(
    raw: any,
    hasSession: boolean,
    profile: ToolProfile | undefined,
    dryRun: boolean
  ): any {
    const reviewOptions = raw ?? {};
    const defaults = this.resolveReviewDefaults(hasSession);
    const profileDefaults = this.resolveReviewProfileDefaults(profile, dryRun);
    const hasBlockOn = Array.isArray(reviewOptions?.blockOn);
    return {
      ...defaults,
      ...profileDefaults,
      ...reviewOptions,
      blockOn: hasBlockOn
        ? reviewOptions.blockOn
        : (profileDefaults?.blockOn ?? defaults.blockOn)
    };
  }

  private static resolveReviewDefaults(hasSession: boolean): any {
    if (!FeatureFlags.isEnabled(FeatureFlags.WRITERS_FLOW_REVIEW_DEFAULTS)) {
      return {};
    }
    return hasSession
      ? { preApply: true, postApply: false, strictness: "balanced", blockOn: ["syntax", "guardrails", "vibe"] }
      : { preApply: true, postApply: false, strictness: "permissive", blockOn: ["syntax"] };
  }

  private static resolveReviewProfileDefaults(profile: ToolProfile | undefined, dryRun: boolean): any {
    if (!profile || profile === "balanced") return undefined;
    if (profile === "fast") {
      return { strictness: "permissive", blockOn: ["syntax"], postApply: false };
    }
    return {
      strictness: "strict",
      blockOn: ["syntax", "semantic", "guardrails", "vibe"],
      postApply: dryRun ? false : true
    };
  }
}
