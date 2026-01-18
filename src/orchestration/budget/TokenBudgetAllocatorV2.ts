import { metrics } from "../../utils/MetricsCollector.js";

export type BudgetPillar = "explore" | "understand";

export type BudgetSection =
  | "core_header"
  | "skeleton"
  | "file_profile"
  | "related_code"
  | "dependencies"
  | "call_graph"
  | "hot_spots"
  | "analysis_pack"
  | "style_pack"
  | "integrity_report"
  | "explore_items"
  | "doc_sections"
  | "research_pack";

export type DegradeStrategy = "raw" | "preview" | "summary" | "distill" | "truncate" | "omit";

export type SectionPlan = {
  section: BudgetSection;
  priority: "required" | "important" | "optional";
  tokens?: number;
  chars?: number;
  strategy: DegradeStrategy;
};

export type BudgetPlan = {
  pillar: BudgetPillar;
  maxTokens?: number;
  maxChars?: number;
  timeoutMs?: number;
  sections: SectionPlan[];
};

type BudgetPlanInput = {
  pillar: BudgetPillar;
  profile?: "lean" | "fast" | "balanced" | "deep";
  sources?: "code" | "docs" | "both";
  maxTokens?: number;
  maxChars?: number;
  timeoutMs?: number;
  tokenEstimator?: "chars" | "whitespace";
  include?: Record<string, boolean | undefined>;
  view?: "auto" | "preview" | "section" | "full";
};

const PROFILE_DEFAULT: Required<BudgetPlanInput>["profile"] = "balanced";

const ALL_SECTIONS: BudgetSection[] = [
  "core_header",
  "skeleton",
  "file_profile",
  "related_code",
  "dependencies",
  "call_graph",
  "hot_spots",
  "analysis_pack",
  "style_pack",
  "integrity_report",
  "explore_items",
  "doc_sections",
  "research_pack"
];

const ZERO_WEIGHT_RECORD: Record<BudgetSection, number> = ALL_SECTIONS.reduce((acc, section) => {
  acc[section] = 0;
  return acc;
}, {} as Record<BudgetSection, number>);

const EXPLORE_WEIGHTS: Record<Required<BudgetPlanInput>["profile"], Record<BudgetSection, number>> = {
  lean: {
    ...ZERO_WEIGHT_RECORD,
    explore_items: 0.8,
    doc_sections: 0.1,
    research_pack: 0.0,
    integrity_report: 0.05,
    core_header: 0.05
  },
  fast: {
    ...ZERO_WEIGHT_RECORD,
    explore_items: 0.8,
    doc_sections: 0.1,
    research_pack: 0.0,
    integrity_report: 0.05,
    core_header: 0.05
  },
  balanced: {
    ...ZERO_WEIGHT_RECORD,
    explore_items: 0.65,
    doc_sections: 0.18,
    research_pack: 0.05,
    integrity_report: 0.07,
    core_header: 0.05
  },
  deep: {
    ...ZERO_WEIGHT_RECORD,
    explore_items: 0.55,
    doc_sections: 0.25,
    research_pack: 0.08,
    integrity_report: 0.07,
    core_header: 0.05
  }
};

const UNDERSTAND_WEIGHTS: Record<Required<BudgetPlanInput>["profile"], Record<BudgetSection, number>> = {
  lean: {
    ...ZERO_WEIGHT_RECORD,
    skeleton: 0.6,
    file_profile: 0.1,
    related_code: 0.1,
    dependencies: 0.05,
    call_graph: 0.05,
    hot_spots: 0.02,
    analysis_pack: 0.04,
    style_pack: 0.03,
    integrity_report: 0.01
  },
  fast: {
    ...ZERO_WEIGHT_RECORD,
    skeleton: 0.6,
    file_profile: 0.1,
    related_code: 0.1,
    dependencies: 0.05,
    call_graph: 0.05,
    hot_spots: 0.02,
    analysis_pack: 0.04,
    style_pack: 0.03,
    integrity_report: 0.01
  },
  balanced: {
    ...ZERO_WEIGHT_RECORD,
    skeleton: 0.45,
    file_profile: 0.1,
    related_code: 0.15,
    dependencies: 0.1,
    call_graph: 0.1,
    hot_spots: 0.03,
    analysis_pack: 0.04,
    style_pack: 0.02,
    integrity_report: 0.01
  },
  deep: {
    ...ZERO_WEIGHT_RECORD,
    skeleton: 0.3,
    file_profile: 0.1,
    related_code: 0.2,
    dependencies: 0.15,
    call_graph: 0.15,
    hot_spots: 0.05,
    analysis_pack: 0.03,
    style_pack: 0.01,
    integrity_report: 0.01
  }
};

const REQUIRED_SECTIONS: Record<BudgetPillar, BudgetSection[]> = {
  explore: ["explore_items"],
  understand: ["skeleton"]
};

const IMPORTANT_SECTIONS: Record<BudgetPillar, BudgetSection[]> = {
  explore: ["doc_sections", "integrity_report"],
  understand: ["file_profile", "related_code"]
};

const OPTIONAL_SECTIONS: Record<BudgetPillar, BudgetSection[]> = {
  explore: ["research_pack"],
  understand: ["dependencies", "call_graph", "hot_spots", "analysis_pack", "style_pack", "integrity_report"]
};

export function buildBudgetPlan(args: BudgetPlanInput): BudgetPlan {
  const profile = args.profile ?? PROFILE_DEFAULT;
  const maxTokens = normalizeBudget(args.maxTokens);
  const maxChars = normalizeBudget(args.maxChars);
  const weights = args.pillar === "explore" ? EXPLORE_WEIGHTS[profile] : UNDERSTAND_WEIGHTS[profile];

  const sections = new Map<BudgetSection, SectionPlan>();
  const addSection = (section: BudgetSection, priority: SectionPlan["priority"], strategy: DegradeStrategy) => {
    sections.set(section, { section, priority, strategy });
  };

  for (const section of REQUIRED_SECTIONS[args.pillar]) {
    addSection(section, "required", "raw");
  }
  for (const section of IMPORTANT_SECTIONS[args.pillar]) {
    addSection(section, "important", "raw");
  }
  for (const section of OPTIONAL_SECTIONS[args.pillar]) {
    addSection(section, "optional", "raw");
  }

  if (args.pillar === "explore") {
    const includeDocs = args.include?.docs !== false || args.include?.comments === true;
    if (!includeDocs) {
      updateStrategy(sections, "doc_sections", "omit");
    } else if (profile === "lean" || profile === "fast") {
      updateStrategy(sections, "doc_sections", "summary");
    } else if (profile === "balanced") {
      updateStrategy(sections, "doc_sections", maxTokens && maxTokens < 900 ? "summary" : "preview");
    } else {
      updateStrategy(sections, "doc_sections", maxTokens && maxTokens < 1800 ? "preview" : "raw");
    }

    if (maxTokens && maxTokens < 1200) {
      updateStrategy(sections, "research_pack", "omit");
    } else if (profile !== "deep") {
      updateStrategy(sections, "research_pack", "summary");
    }
  }

  if (args.pillar === "understand") {
    if (maxTokens && maxTokens < 900) {
      updateStrategy(sections, "skeleton", "distill");
    }
    if (profile === "lean" || profile === "fast" || (maxTokens && maxTokens < 1400)) {
      updateStrategy(sections, "dependencies", "omit");
      updateStrategy(sections, "call_graph", "omit");
      updateStrategy(sections, "hot_spots", "omit");
    }
    if (maxTokens && maxTokens < 1600) {
      updateStrategy(sections, "analysis_pack", "omit");
      updateStrategy(sections, "style_pack", "omit");
    } else {
      updateStrategy(sections, "analysis_pack", "summary");
      updateStrategy(sections, "style_pack", "summary");
    }
  }

  allocateBudgets(sections, weights, maxTokens, maxChars);
  metrics.inc("budget.allocator.plan_total", 1, "basic");

  return {
    pillar: args.pillar,
    maxTokens,
    maxChars,
    timeoutMs: normalizeBudget(args.timeoutMs),
    sections: Array.from(sections.values())
  };
}

export function getSectionPlan(plan: BudgetPlan, section: BudgetSection): SectionPlan | undefined {
  return plan.sections.find((entry) => entry.section === section);
}

function allocateBudgets(
  sections: Map<BudgetSection, SectionPlan>,
  weights: Record<BudgetSection, number>,
  maxTokens?: number,
  maxChars?: number
): void {
  const active = Array.from(sections.values()).filter((section) => section.strategy !== "omit");
  if (active.length === 0) return;

  const totalWeight = active.reduce((sum, section) => sum + (weights[section.section] ?? 0), 0) || 1;
  for (const section of active) {
    const weight = (weights[section.section] ?? 0) / totalWeight;
    if (maxTokens) {
      const minTokens = section.priority === "required" ? 128 : section.priority === "important" ? 64 : 32;
      section.tokens = Math.max(minTokens, Math.floor(maxTokens * weight));
    }
    if (maxChars) {
      const minChars = section.priority === "required" ? 800 : section.priority === "important" ? 400 : 200;
      section.chars = Math.max(minChars, Math.floor(maxChars * weight));
    }
  }
}

function updateStrategy(
  sections: Map<BudgetSection, SectionPlan>,
  section: BudgetSection,
  strategy: DegradeStrategy
): void {
  const entry = sections.get(section);
  if (!entry) return;
  if (entry.strategy === strategy) return;
  entry.strategy = strategy;
  metrics.inc(`budget.allocator.degrade_total.${section}.${strategy}`, 1, "basic");
}

function normalizeBudget(value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  if ((value as number) <= 0) return undefined;
  return value;
}
