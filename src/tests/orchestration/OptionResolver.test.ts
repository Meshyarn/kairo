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
});
