import type {
  DecisionTraceEvent,
  DecisionTraceV1,
  TraceSkipCode,
  TracePillar
} from "../../types/option-trace.js";

type TraceBuilderOptions = {
  maxEvents?: number;
  maxSizeBytes?: number;
  startedAtMs?: number;
};

const DEFAULT_EVENT_CAP = 50;
const DEFAULT_MAX_BYTES = 16 * 1024;

export class TraceBuilder {
  private readonly pillar: TracePillar;
  private readonly optionResolution: DecisionTraceV1["optionResolution"];
  private readonly maxEvents: number;
  private readonly maxSizeBytes: number;
  private readonly startedAtMs: number;
  private events: DecisionTraceEvent[] = [];
  private skips: Array<{ feature: string; code: TraceSkipCode; detail?: string }> = [];
  private budget?: DecisionTraceV1["budget"];
  private cache?: DecisionTraceV1["cache"];
  private truncated = false;

  constructor(
    pillar: TracePillar,
    optionResolution: DecisionTraceV1["optionResolution"],
    options: TraceBuilderOptions = {}
  ) {
    this.pillar = pillar;
    this.optionResolution = optionResolution;
    this.maxEvents = options.maxEvents ?? DEFAULT_EVENT_CAP;
    this.maxSizeBytes = options.maxSizeBytes ?? DEFAULT_MAX_BYTES;
    this.startedAtMs = options.startedAtMs ?? Date.now();
  }

  recordSkip(feature: string, code: TraceSkipCode, detail?: string): void {
    if (this.skips.length >= this.maxEvents) {
      this.truncated = true;
      return;
    }
    this.skips.push({ feature, code, detail });
  }

  recordEvent(event: DecisionTraceEvent): void {
    if (this.events.length >= this.maxEvents) {
      this.truncated = true;
      return;
    }
    this.events.push(event);
  }

  setBudget(budget: DecisionTraceV1["budget"]): void {
    this.budget = budget;
  }

  setCache(cache: DecisionTraceV1["cache"]): void {
    this.cache = cache;
  }

  finalize(finishedAtMs?: number): DecisionTraceV1 {
    const finished = Number.isFinite(finishedAtMs) ? finishedAtMs! : Date.now();
    const trace: DecisionTraceV1 = {
      version: 1,
      pillar: this.pillar,
      startedAt: new Date(this.startedAtMs).toISOString(),
      finishedAt: new Date(finished).toISOString(),
      durationMs: Math.max(0, finished - this.startedAtMs),
      optionResolution: this.optionResolution,
      ...(this.skips.length > 0 ? { skips: this.skips } : {}),
      ...(this.budget ? { budget: this.budget } : {}),
      ...(this.cache ? { cache: this.cache } : {}),
      ...(this.events.length > 0 ? { events: this.events } : {}),
      ...(this.truncated ? { truncated: true } : {})
    };
    return this.applySizeLimit(trace);
  }

  private applySizeLimit(trace: DecisionTraceV1): DecisionTraceV1 {
    const serialized = JSON.stringify(trace);
    if (serialized.length <= this.maxSizeBytes) return trace;
    const trimmed: DecisionTraceV1 = {
      ...trace,
      events: undefined,
      truncated: true
    };
    let next = JSON.stringify(trimmed);
    if (next.length <= this.maxSizeBytes) return trimmed;
    const withoutDetails: DecisionTraceV1 = {
      ...trimmed,
      skips: trimmed.skips?.map((entry) => ({ feature: entry.feature, code: entry.code }))
    };
    next = JSON.stringify(withoutDetails);
    if (next.length <= this.maxSizeBytes) return withoutDetails;
    return {
      ...withoutDetails,
      skips: undefined,
      cache: undefined,
      budget: undefined,
      truncated: true
    };
  }
}
