import * as fs from "fs";
import * as path from "path";
import { isDangerouslyBroadRoot, resolveRootPath as resolveStartupRootPath } from "../../server/StartupRootResolver.js";
import type { ManageHandlerDeps } from "./ManageHandlerUtils.js";

function resolveTargetRoot(
  args: any,
  options?: { defaultCwd?: string }
): { root: string; source: string; cwd: string } {
  const hasCwdArg = typeof args?.cwd === "string" && args.cwd.trim().length > 0;
  const fallbackCwd = typeof options?.defaultCwd === "string" && options.defaultCwd.trim().length > 0
    ? options.defaultCwd.trim()
    : process.cwd();
  const cwdRaw = hasCwdArg ? args.cwd.trim() : fallbackCwd;
  const cwd = path.resolve(cwdRaw);
  const explicitRoot = typeof args?.root === "string" && args.root.trim().length > 0
    ? args.root.trim()
    : undefined;
  if (explicitRoot) {
    return {
      root: path.resolve(explicitRoot),
      source: "args:root",
      cwd
    };
  }
  const detected = resolveStartupRootPath({
    argv: [],
    env: process.env,
    cwd
  });
  return {
    root: path.resolve(detected.root),
    source: detected.source,
    cwd
  };
}

export const handleSwitchRoot = async (deps: ManageHandlerDeps, args: any) => {
  const runtimeControl = deps.context.runtimeControl;
  if (!runtimeControl?.switchWorkspaceRoot) {
    return {
      success: false,
      output: "Runtime root switching is unavailable in this host."
    };
  }

  const { root, source, cwd } = resolveTargetRoot(args);
  if (!fs.existsSync(root)) {
    return {
      success: false,
      output: `Requested root does not exist: ${root}`,
      detected: { root, source, cwd }
    };
  }
  const stats = fs.statSync(root);
  if (!stats.isDirectory()) {
    return {
      success: false,
      output: `Requested root is not a directory: ${root}`,
      detected: { root, source, cwd }
    };
  }

  const allowBroadRoot = args?.allowBroadRoot === true;
  if (!allowBroadRoot && isDangerouslyBroadRoot(root)) {
    return {
      success: false,
      output: "Refusing to switch to a broad root (home or filesystem root). Pass allowBroadRoot=true to override.",
      detected: { root, source, cwd }
    };
  }

  const switched = await runtimeControl.switchWorkspaceRoot(root, {
    triggerReindex: args?.reindex === true || args?.triggerReindex === true,
    allowBroadRoot
  });
  return {
    ...switched,
    detected: { root, source, cwd }
  };
};

export const handleDetectRoot = async (deps: ManageHandlerDeps, args: any) => {
  const runtimeControl = deps.context.runtimeControl;
  const hasRootArg = typeof args?.root === "string" && args.root.trim().length > 0;
  const hasCwdArg = typeof args?.cwd === "string" && args.cwd.trim().length > 0;
  const { root, source, cwd } = resolveTargetRoot(args, {
    defaultCwd: !hasRootArg && !hasCwdArg ? deps.context.rootPath : undefined
  });
  if (args?.apply === true) {
    if (!runtimeControl?.switchWorkspaceRoot) {
      return {
        success: false,
        output: "Root detection succeeded, but runtime root switching is unavailable in this host.",
        detected: {
          root,
          source,
          cwd
        },
        activeRoot: deps.context.rootPath
      };
    }
    const switched = await runtimeControl.switchWorkspaceRoot(root, {
      triggerReindex: args?.reindex === true || args?.triggerReindex === true,
      allowBroadRoot: args?.allowBroadRoot === true
    });
    return {
      ...switched,
      output: switched.changed ? "Detected and switched workspace root." : "Detected workspace root matches current runtime root.",
      detected: {
        root,
        source,
        cwd
      }
    };
  }
  return {
    success: true,
    output: "Workspace root detected.",
    detected: {
      root,
      source,
      cwd
    },
    activeRoot: deps.context.rootPath,
    wouldChange: path.resolve(deps.context.rootPath) !== root
  };
};
