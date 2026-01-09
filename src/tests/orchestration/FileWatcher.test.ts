import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { FileWatcher } from "../../orchestration/context/FileWatcher.js";
import { FeatureFlags } from "../../config/FeatureFlags.js";
import chokidar from "chokidar";

const makeUcg = () => {
  return {
    getNode: jest.fn(),
    invalidate: jest.fn(),
    removeNode: jest.fn()
  };
};

describe("FileWatcher", () => {
  let mockWatcherInstance: any;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    
    mockWatcherInstance = {
      on: jest.fn().mockReturnThis(),
      close: jest.fn().mockImplementation(() => Promise.resolve())
    };
    
    jest.spyOn(chokidar, "watch").mockReturnValue(mockWatcherInstance);
  });

  afterEach(async () => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("debounces file change events", () => {
    const ucg = makeUcg();
    const watcher = new FileWatcher(ucg as any, "/tmp");
    const processChange = jest.fn();
    (watcher as any).processChange = processChange;

    (watcher as any).handleFileChange("/tmp/a.ts", "change");
    (watcher as any).handleFileChange("/tmp/a.ts", "change");

    jest.advanceTimersByTime(110);

    expect(processChange).toHaveBeenCalledTimes(1);
    expect(processChange).toHaveBeenCalledWith("/tmp/a.ts", "change");
  });

  it("invalidates nodes on change", () => {
    const ucg = makeUcg();
    ucg.getNode.mockReturnValue({});
    const watcher = new FileWatcher(ucg as any, "/tmp");

    (watcher as any).processChange("/tmp/a.ts", "change");

    expect(ucg.invalidate).toHaveBeenCalledWith("/tmp/a.ts", true);
  });

  it("removes nodes on delete", () => {
    const ucg = makeUcg();
    ucg.getNode.mockReturnValue({});
    const watcher = new FileWatcher(ucg as any, "/tmp");

    (watcher as any).processChange("/tmp/a.ts", "delete");

    expect(ucg.removeNode).toHaveBeenCalledWith("/tmp/a.ts");
  });

  it("ignores add events without existing nodes", () => {
    const ucg = makeUcg();
    ucg.getNode.mockReturnValue(undefined);
    const watcher = new FileWatcher(ucg as any, "/tmp");

    (watcher as any).processChange("/tmp/new.ts", "add");

    expect(ucg.invalidate).not.toHaveBeenCalled();
    expect(ucg.removeNode).not.toHaveBeenCalled();
  });

  it("starts the watcher when feature is enabled", () => {
    jest.spyOn(FeatureFlags, "isEnabled").mockReturnValue(true);

    const ucg = makeUcg();
    const watcher = new FileWatcher(ucg as any, "/tmp");
    watcher.start();

    expect(chokidar.watch).toHaveBeenCalled();
    expect(mockWatcherInstance.on).toHaveBeenCalledWith("change", expect.any(Function));
    expect(mockWatcherInstance.on).toHaveBeenCalledWith("unlink", expect.any(Function));
    expect(mockWatcherInstance.on).toHaveBeenCalledWith("add", expect.any(Function));
  });

  it("does not start if feature is disabled", () => {
    jest.spyOn(FeatureFlags, "isEnabled").mockReturnValue(false);
    
    const ucg = makeUcg();
    const watcher = new FileWatcher(ucg as any, "/tmp");
    watcher.start();

    expect(chokidar.watch).not.toHaveBeenCalled();
  });

  it("stops the watcher and clears timers", async () => {
    jest.spyOn(FeatureFlags, "isEnabled").mockReturnValue(true);

    const ucg = makeUcg();
    const watcher = new FileWatcher(ucg as any, "/tmp");
    watcher.start();
    
    (watcher as any).handleFileChange("/tmp/a.ts", "change");
    expect((watcher as any).debounceTimers.size).toBe(1);

    await watcher.stop();

    expect(mockWatcherInstance.close).toHaveBeenCalled();
    expect((watcher as any).debounceTimers.size).toBe(0);
  });
});
