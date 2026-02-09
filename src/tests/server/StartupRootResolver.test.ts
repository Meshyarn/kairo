import { describe, expect, it } from "@jest/globals";
import { isDangerouslyBroadRoot, resolveRootPath } from "../../server/StartupRootResolver.js";

describe("StartupRootResolver", () => {
  it("prefers argv root over environment values", () => {
    const resolved = resolveRootPath({
      argv: ["--root", "/tmp/project-from-argv"],
      env: {
        PWD: "/tmp/project-from-pwd"
      },
      cwd: "/tmp/current",
      homeDir: "/Users/tester"
    });

    expect(resolved).toEqual({
      root: "/tmp/project-from-argv",
      source: "argv"
    });
  });

  it("uses PWD when cwd is broad and PWD is specific", () => {
    const resolved = resolveRootPath({
      argv: [],
      env: {
        PWD: "/tmp/project-from-pwd"
      },
      cwd: "/Users/tester",
      homeDir: "/Users/tester"
    });

    expect(resolved).toEqual({
      root: "/tmp/project-from-pwd",
      source: "env:PWD"
    });
  });

  it("ignores broad env roots and falls back to cwd", () => {
    const resolved = resolveRootPath({
      argv: [],
      env: {
        CODEX_CWD: "/Users/tester"
      },
      cwd: "/tmp/project-from-cwd",
      homeDir: "/Users/tester"
    });

    expect(resolved).toEqual({
      root: "/tmp/project-from-cwd",
      source: "cwd"
    });
  });

  it("uses script-path fallback when cwd is broad and env is empty", () => {
    const resolved = resolveRootPath({
      argv: [],
      env: {},
      cwd: "/Users/tester",
      homeDir: "/Users/tester",
      scriptPath: "/Users/devkwan/Documents/Development/meshyarn.io/kairo/dist/index.js"
    });

    expect(resolved).toEqual({
      root: "/Users/devkwan/Documents/Development/meshyarn.io/kairo",
      source: "argv:script"
    });
  });

  it("flags filesystem root and home as dangerous", () => {
    expect(isDangerouslyBroadRoot("/", "/Users/tester")).toBe(true);
    expect(isDangerouslyBroadRoot("/Users/tester", "/Users/tester")).toBe(true);
    expect(isDangerouslyBroadRoot("/Users/tester/work/project", "/Users/tester")).toBe(false);
  });
});
