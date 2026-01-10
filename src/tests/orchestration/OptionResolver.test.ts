import { describe, it, expect } from "@jest/globals";
import { OptionResolver } from "../../orchestration/options/OptionResolver.js";

describe("OptionResolver", () => {
  it("applies sources to include when include is not explicit", () => {
    const result = OptionResolver.resolveExploreOptions({
      sources: "docs"
    } as any);

    expect(result.effective.include.docs).toBe(true);
    expect(result.effective.include.code).toBe(false);
  });

  it("does not override explicit include values", () => {
    const result = OptionResolver.resolveExploreOptions({
      sources: "docs",
      include: { code: true }
    } as any);

    expect(result.effective.include.code).toBe(true);
  });

  it("applies profile fast limits when unset", () => {
    const result = OptionResolver.resolveExploreOptions({
      profile: "fast"
    } as any);

    expect(result.effective.limits.maxResults).toBe(5);
    expect(result.effective.limits.maxFiles).toBe(80);
  });

  it("respects safety for dryRun unless explicit dryRun is set", () => {
    const planned = OptionResolver.resolveWriteOptions({
      safety: "plan"
    } as any);
    const explicit = OptionResolver.resolveWriteOptions({
      safety: "plan",
      dryRun: false
    } as any);

    expect(planned.effective.dryRun).toBe(true);
    expect(explicit.effective.dryRun).toBe(false);
  });

  it("maps profiles to chunking token limits", () => {
    expect(OptionResolver.resolveChunkingOptions("fast")).toEqual({ maxTokens: 384, overlapTokens: 32 });
    expect(OptionResolver.resolveChunkingOptions("balanced")).toEqual({ maxTokens: 512, overlapTokens: 64 });
    expect(OptionResolver.resolveChunkingOptions("deep")).toEqual({ maxTokens: 768, overlapTokens: 128 });
  });

  it("maps profiles to diff modes for change/write", () => {
    expect(OptionResolver.resolveChangeOptions({ profile: "fast" } as any).effective.diffMode).toBe("myers");
    expect(OptionResolver.resolveChangeOptions({ profile: "balanced" } as any).effective.diffMode).toBe("semantic");
    expect(OptionResolver.resolveChangeOptions({ profile: "deep" } as any).effective.diffMode).toBe("semantic");
    expect(OptionResolver.resolveChangeOptions({} as any).effective.diffMode).toBeUndefined();
  });

  it("applies session policy when no explicit overrides", () => {
    const result = OptionResolver.resolveExploreOptions({} as any, {
      sources: "docs",
      profile: "deep"
    });

    expect(result.effective.sources).toBe("docs");
    expect(result.effective.profile).toBe("deep");
  });
});
