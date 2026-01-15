import { describe, it, expect } from "@jest/globals";
import { TraceBuilder } from "../../../orchestration/trace/TraceBuilder.js";

describe("TraceBuilder", () => {
  it("caps events and marks truncated", () => {
    const builder = new TraceBuilder(
      "explore",
      { trace: { source: "explicit", explicit: true, resolved: true } },
      { maxEvents: 2, maxSizeBytes: 2048, startedAtMs: 0 }
    );
    builder.recordEvent({ area: "other", code: "first" });
    builder.recordEvent({ area: "other", code: "second" });
    builder.recordEvent({ area: "other", code: "third" });

    const trace = builder.finalize(10);
    expect(trace.events?.length).toBe(2);
    expect(trace.truncated).toBe(true);
  });

  it("truncates when size exceeds limit", () => {
    const builder = new TraceBuilder(
      "manage",
      { trace: { source: "explicit", explicit: true, resolved: true } },
      { maxEvents: 5, maxSizeBytes: 200, startedAtMs: 0 }
    );
    builder.recordEvent({
      area: "other",
      code: "oversize",
      data: { payload: "x".repeat(500) }
    });

    const trace = builder.finalize(10);
    expect(trace.truncated).toBe(true);
    expect(trace.events).toBeUndefined();
  });
});
