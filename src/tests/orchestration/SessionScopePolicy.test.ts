import { describe, it, expect } from "@jest/globals";
import type { RepoRegistry } from "../../config/RepoRegistry.js";
import {
  applySessionRepoScopeDefaults,
  buildSessionRepoScopePolicyPatch
} from "../../orchestration/pillars/shared/SessionScopePolicy.js";

const createRepoRegistry = (
  repos: Array<{ id: string; name: string; path: string }>
): RepoRegistry =>
  ({
    getRepo: (id: string) => repos.find((repo) => repo.id === id),
    getAllRepos: () => repos
  } as unknown as RepoRegistry);

describe("SessionScopePolicy", () => {
  it("applies repo defaults from session policy when constraints do not set repo scope", () => {
    const constraints: Record<string, any> = {};
    applySessionRepoScopeDefaults({
      constraints,
      sessionPolicy: { repoId: "alpha" } as any,
      tool: "explore",
      rootPath: "/workspace"
    });

    expect(constraints.repoId).toBe("alpha");
  });

  it("does not override explicit repo constraints", () => {
    const constraints: Record<string, any> = { repoId: "manual" };
    applySessionRepoScopeDefaults({
      constraints,
      sessionPolicy: { repoId: "from-policy" } as any,
      tool: "understand",
      rootPath: "/workspace"
    });

    expect(constraints.repoId).toBe("manual");
  });

  it("resolves root hint to repo scope when session policy sets root", () => {
    const repoRegistry = createRepoRegistry([
      { id: "alpha", name: "Alpha", path: "/workspace/apps/alpha" },
      { id: "beta", name: "Beta", path: "/workspace/apps/beta" }
    ]);
    const constraints: Record<string, any> = {};
    applySessionRepoScopeDefaults({
      constraints,
      sessionPolicy: { root: "/workspace/apps/beta/src" } as any,
      tool: "write",
      repoRegistry,
      rootPath: "/workspace"
    });

    expect(constraints.repoScope?.mode).toBe("repos");
    expect(constraints.repoScope?.repoIds).toEqual(["beta"]);
  });

  it("builds policy patch from explicit repo constraints", () => {
    const patch = buildSessionRepoScopePolicyPatch({
      constraints: {
        repoScope: { mode: "repos", repoIds: ["beta"] }
      },
      tool: "change"
    });

    expect(patch?.repoScope).toEqual({ mode: "repos", repoIds: ["beta"] });
    expect((patch as any)?.change?.repoScope).toEqual({ mode: "repos", repoIds: ["beta"] });
  });
});
