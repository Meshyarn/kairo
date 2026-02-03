import type { StrategySearchCandidate, StrategySearchRequest } from "../../IntentRouter.js";
import type { TraceBuilder } from "../../trace/TraceBuilder.js";
import { STRATEGY_SEARCH_DEFAULTS, createSeededRng } from "./ChangePillarStrategyUtils.js";

type MctsArgs = {
  config: StrategySearchRequest;
  normalizedCandidates: Array<{ candidate: StrategySearchCandidate; id: string }>;
  candidateLookup: Map<string, StrategySearchCandidate>;
  evaluateCandidate: (entry: { candidate: StrategySearchCandidate; id: string }) => Promise<any>;
  deadline: number;
  evaluated: Array<any>;
  traceBuilder?: TraceBuilder;
  recordDegraded: (reason: string, data?: Record<string, unknown>) => void;
  recordTimeboxExceeded: () => void;
};

export const runStrategySearchMcts = async (args: MctsArgs): Promise<{ search?: Record<string, unknown> }> => {
  const { config, normalizedCandidates, candidateLookup } = args;
  const mctsConfig = config.mcts ?? STRATEGY_SEARCH_DEFAULTS.mcts;
  if (normalizedCandidates.length === 0) {
    args.recordDegraded("reasoning_candidates_missing");
    return {};
  }
  if (mctsConfig.maxRollouts < 1 || mctsConfig.maxDepth < 1) {
    args.recordDegraded("reasoning_mcts_disabled");
    return {};
  }

  type MctsNode = {
    id: string;
    candidate?: StrategySearchCandidate;
    parent?: MctsNode;
    children: MctsNode[];
    unexpanded: StrategySearchCandidate[];
    visits: number;
    value: number;
    depth: number;
  };

  const rng = createSeededRng(mctsConfig.seed);
  const usedIds = new Set<string>();
  const makeNode = (candidate: StrategySearchCandidate, parent: MctsNode, index: number): MctsNode => {
    const rawId = typeof candidate.id === "string" && candidate.id.length > 0
      ? candidate.id
      : `${parent.id}_${index + 1}`;
    let id = rawId;
    if (usedIds.has(id)) {
      id = `${rawId}_${usedIds.size + 1}`;
    }
    usedIds.add(id);
    const candidateWithId = candidate.id === id ? candidate : { ...candidate, id };
    candidateLookup.set(id, candidateWithId);
    return {
      id,
      candidate: candidateWithId,
      parent,
      children: [],
      unexpanded: Array.isArray(candidateWithId.children) ? candidateWithId.children : [],
      visits: 0,
      value: 0,
      depth: parent.depth + 1
    };
  };

  const root: MctsNode = {
    id: "root",
    children: [],
    unexpanded: normalizedCandidates.map((entry) => entry.candidate),
    visits: 0,
    value: 0,
    depth: 0
  };

  const selectChild = (node: MctsNode): MctsNode => {
    let best = node.children[0];
    let bestScore = -Infinity;
    const logVisits = Math.log(Math.max(1, node.visits));
    for (const child of node.children) {
      if (child.visits === 0) {
        return child;
      }
      const exploitation = child.value / child.visits;
      const exploration = mctsConfig.exploration * Math.sqrt(logVisits / child.visits);
      const score = exploitation + exploration;
      if (score > bestScore) {
        bestScore = score;
        best = child;
      }
    }
    return best;
  };

  const pickUnexpanded = (node: MctsNode): MctsNode => {
    const index = Math.floor(rng() * node.unexpanded.length);
    const candidate = node.unexpanded.splice(index, 1)[0];
    const childNode = makeNode(candidate, node, index);
    node.children.push(childNode);
    return childNode;
  };

  const failedReward = -1000;
  let rollouts = 0;
  while (rollouts < mctsConfig.maxRollouts) {
    if (Date.now() > args.deadline) {
      args.recordTimeboxExceeded();
      args.recordDegraded("reasoning_budget_exceeded", { evaluatedCount: args.evaluated.length });
      if (args.traceBuilder) {
        args.traceBuilder.recordEvent({
          area: "budget",
          code: "strategy_search_budget_exceeded",
          data: {
            timeboxMs: config.timeboxMs,
            evaluatedCount: args.evaluated.length
          }
        });
      }
      break;
    }
    let node = root;
    while (node.depth < mctsConfig.maxDepth && node.unexpanded.length === 0 && node.children.length > 0) {
      node = selectChild(node);
    }
    if (node.depth < mctsConfig.maxDepth && node.unexpanded.length > 0) {
      node = pickUnexpanded(node);
    }
    if (!node.candidate) {
      break;
    }
    const entry = { candidate: node.candidate, id: node.id };
    const candidateSummary = await args.evaluateCandidate(entry);
    const reward = typeof candidateSummary.reward === "number" ? candidateSummary.reward : failedReward;
    let cursor: MctsNode | undefined = node;
    while (cursor) {
      cursor.visits += 1;
      cursor.value += reward;
      cursor = cursor.parent;
    }
    rollouts += 1;
  }

  const search = {
    algorithm: "uct",
    rollouts,
    maxDepth: mctsConfig.maxDepth,
    exploration: mctsConfig.exploration,
    ...(Number.isFinite(mctsConfig.seed) ? { seed: mctsConfig.seed } : {}),
    evaluatedCount: args.evaluated.length
  };
  if (args.traceBuilder) {
    args.traceBuilder.recordEvent({
      area: "policy",
      code: "strategy_search_mcts",
      data: search
    });
  }
  return { search };
};
