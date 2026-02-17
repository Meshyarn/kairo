export interface WorkflowStep {
    name: string;
    description: string;
    tools?: string[];
    hint?: string;
    best_practice?: string;
    tool_args?: Record<string, unknown>;
}

export interface RecoveryStrategy {
    code: string;
    meaning: string;
    action: {
        toolName: string;
        exampleArgs?: Record<string, unknown>;
        rationale: string;
    };
}

export const AgentWorkflowGuidance: {
    workflow: {
        title: string;
        description: string;
        steps: WorkflowStep[];
    };
    recovery: RecoveryStrategy[];
    metadata: { version: string };
} = {
    workflow: {
        title: "Standard Agent Workflow for Code Modification",
        description: "Follow these stages to scout, understand, edit, and validate changes safely in kairo.",
        steps: [
            {
                name: "Scout & Discover",
                description: "Identify relevant files, directories, and symbols before reading large blobs.",
                tools: ["task"],
                hint: "Use task({mode:'ask'}) to search for files, symbols, or directories. Set profile='balanced' for meaningful evidence."
            },
            {
                name: "Profile & Understand",
                description: "Load Smart File Profile metadata and skeletons without fetching the entire file.",
                tools: ["explore"],
                tool_args: { view: "preview" },
                hint: "Use explore({query, view:'preview'}) to capture file profiles and structure before planning edits."
            },
            {
                name: "Fragment & Detail",
                description: "Zoom in on precise sections for planning the change.",
                tools: ["explore"],
                tool_args: { view: "section" },
                hint: "Use explore({query, view:'section'}) to zoom into specific code sections for targeted reading."
            },
            {
                name: "Plan Edits",
                description: "Design the exact multi-line change including anchors, hashes, and normalization level.",
                hint: "Prefer `lineRange` + `expectedHash`; set `normalization` to `whitespace`/`structural` when formatting is inconsistent."
            },
            {
                name: "Impact Analysis",
                description: "Preview how far the planned change propagates before mutating files.",
                tools: ["understand"],
                hint: "Use understand({goal, include:{callGraph:true, dependencies:true}}) to preview impact before editing.",
                best_practice: "Pause when relationship graphs fan out unexpectedly; split work or add guardrails before editing."
            },
            {
                name: "Edit & Modify",
                description: "Apply atomic edits and ensure they can be undone.",
                tools: ["change"],
                best_practice: "Use change({intent, safety:'plan'}) first to review, then change({safety:'apply', applyToken}) to execute."
            },
            {
                name: "Validate & Verify",
                description: "Re-profile or fragment the touched files and run relevant tests before finishing.",
                tools: ["explore", "manage"],
                hint: "Re-run explore on edited files and call manage({command:'status'}) or manage({command:'undo'}) as needed before handoff."
            }
        ]
    },
    recovery: [
        {
            code: "NO_MATCH",
            meaning: "The editor could not find the target text block.",
            action: {
                toolName: "explore",
                exampleArgs: { query: "target block", view: "section" },
                rationale: "Inspect the exact section you plan to replace, then refine your change intent before resubmitting."
            }
        },
        {
            code: "AMBIGUOUS_MATCH",
            meaning: "Multiple blocks matched the same target.",
            action: {
                toolName: "explore",
                exampleArgs: { query: "ambiguous symbol", view: "preview" },
                rationale: "Compare file previews to disambiguate symbols and narrow change targets with tighter context."
            }
        },
        {
            code: "HASH_MISMATCH",
            meaning: "File drift detected between planning and editing.",
            action: {
                toolName: "explore",
                exampleArgs: { query: "drifted file", view: "full" },
                rationale: "Refresh file metadata to capture the latest content before constructing a new change request."
            }
        },
        {
            code: "PARSE_ERROR",
            meaning: "AST parsing failed for the requested language or file.",
            action: {
                toolName: "explore",
                exampleArgs: { query: "parse error file", view: "full" },
                rationale: "Inspect the raw file (or fix syntax) before re-running understand with structural analysis."
            }
        },
        {
            code: "INDEX_STALE",
            meaning: "Dependency/index information is outdated.",
            action: {
                toolName: "manage",
                exampleArgs: { command: "status" },
                rationale: "Check index health, wait for background rebuilds, and only then trust `relationship_analyze` outputs."
            }
        }
    ],
    metadata: {
        version: "2025-12-10"
    }
};

export const AGENT_WORKFLOW_PATTERNS = {
    "finding-files": {
        name: "Finding Files by Name",
        scenario: "User wants to find a specific file by name (e.g., 'find config.json')",
        bestApproach: [
            {
                step: 1,
                tool: "task",
                params: { request: "find config.json", mode: "ask" },
                reason: "Primary method for file searches via task ask mode"
            },
            {
                step: 2,
                tool: "explore",
                params: { query: "config" },
                reason: "Fallback: broad code search",
                when: "No results from step 1"
            }
        ],
        commonMistakes: [
            "Not specifying mode='ask' when searching for files",
            "Using external tools without trying task/explore first"
        ]
    },

    "finding-symbols": {
        name: "Finding Symbols (Functions, Classes, etc.)",
        scenario: "User wants to find where a symbol is defined",
        bestApproach: [
            {
                step: 1,
                tool: "understand",
                params: { goal: "Find MyClass definition", include: { dependencies: true } },
                reason: "Fastest if symbol is indexed — structural analysis"
            },
            {
                step: 2,
                tool: "task",
                params: { request: "class MyClass", mode: "ask" },
                reason: "Fallback: search via task ask mode",
                when: "understand returns no results"
            }
        ]
    },

    "recovering-from-failures": {
        name: "Recovering from Tool Failures",
        scenario: "A tool call failed - what to do next?",
        bestApproach: [
            {
                condition: "understand failed with 'Symbol not found'",
                nextAction: "Check error.details.similarSymbols for typos, or use task({mode:'ask'})"
            },
            {
                condition: "task returned 0 results",
                nextAction: "Try explore with broader query or different view"
            },
            {
                condition: "change failed with 'Target not found'",
                nextAction: "Use explore to verify exact content, then retry change"
            }
        ]
    }
};
