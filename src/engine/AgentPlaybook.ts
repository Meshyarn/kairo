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
                tools: ["project_search"],
                hint: "Use inferred type switching (auto/file/symbol/directory) to jump directly to the needed targets."
            },
            {
                name: "Profile & Understand",
                description: "Load Smart File Profile metadata and skeletons without fetching the entire file.",
                tools: ["code_read"],
                tool_args: { view: "skeleton" },
                hint: "Capture newline style, indent, and dependency counts before planning edits."
            },
            {
                name: "Fragment & Detail",
                description: "Zoom in on precise sections for planning the change.",
                tools: ["code_read"],
                tool_args: { view: "fragment" },
                hint: "Combine skeleton line numbers with explicit `lineRange` to keep payloads small and targeted."
            },
            {
                name: "Plan Edits",
                description: "Design the exact multi-line change including anchors, hashes, and normalization level.",
                hint: "Prefer `lineRange` + `expectedHash`; set `normalization` to `whitespace`/`structural` when formatting is inconsistent."
            },
            {
                name: "Impact Analysis",
                description: "Preview how far the planned change propagates before mutating files.",
                tools: ["relationship_analyze"],
                hint: 'Use `mode="impact"` for files and `mode="calls"`/`"data_flow"` for symbols before `edit_apply` to avoid surprises.',
                best_practice: "Pause when relationship graphs fan out unexpectedly; split work or add guardrails before editing."
            },
            {
                name: "Edit & Modify",
                description: "Apply atomic edits and ensure they can be undone.",
                tools: ["edit_apply"],
                best_practice: "Batch related operations into one transaction, leverage `dryRun` for validation, and capture transaction IDs for audits."
            },
            {
                name: "Validate & Verify",
                description: "Re-profile or fragment the touched files and run relevant tests before finishing.",
                tools: ["code_read", "project_manage"],
                hint: 'Re-run `code_read(view="skeleton")` on edited files and call `project_manage` (`status`, `undo`, or `redo`) as needed before handoff.'
            }
        ]
    },
    recovery: [
        {
            code: "NO_MATCH",
            meaning: "The editor could not find the target text block.",
            action: {
                toolName: "code_read",
                exampleArgs: { view: "fragment", lineRange: "120-140" },
                rationale: "Inspect the exact lines you plan to replace, then refine `lineRange`, anchors, or `ignoreMistakes` before resubmitting `edit_apply`."
            }
        },
        {
            code: "AMBIGUOUS_MATCH",
            meaning: "Multiple blocks matched the same target.",
            action: {
                toolName: "code_read",
                exampleArgs: { view: "skeleton" },
                rationale: "Compare the skeleton to disambiguate symbols and narrow `edit_apply` targets with tighter context."
            }
        },
        {
            code: "HASH_MISMATCH",
            meaning: "File drift detected between planning and editing.",
            action: {
                toolName: "code_read",
                exampleArgs: { view: "full" },
                rationale: "Refresh Smart File Profile metadata to capture the latest hash before constructing a new edit request."
            }
        },
        {
            code: "PARSE_ERROR",
            meaning: "AST parsing failed for the requested language or file.",
            action: {
                toolName: "code_read",
                exampleArgs: { view: "full" },
                rationale: "Inspect the raw file (or fix syntax) before re-running `relationship_analyze` in symbol/flow modes."
            }
        },
        {
            code: "INDEX_STALE",
            meaning: "Dependency/index information is outdated.",
            action: {
                toolName: "project_manage",
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
                tool: "project_search",
                params: { query: "config.json", type: "filename" },
                reason: "Primary method for filename searches"
            },
            {
                step: 2,
                tool: "project_search",
                params: { query: "config", type: "file" },
                reason: "Fallback: search file contents",
                when: "No results from step 1"
            }
        ],
        commonMistakes: [
            "Using project_search with type='file' (searches content, not names)",
            "Using Glob without trying project_search first"
        ]
    },

    "finding-symbols": {
        name: "Finding Symbols (Functions, Classes, etc.)",
        scenario: "User wants to find where a symbol is defined",
        bestApproach: [
            {
                step: 1,
                tool: "relationship_analyze",
                params: { target: "MyClass", mode: "dependencies" },
                reason: "Fastest if symbol is indexed"
            },
            {
                step: 2,
                tool: "project_search",
                params: { query: "class MyClass", type: "symbol" },
                reason: "Fallback: content search",
                when: "relationship_analyze fails"
            }
        ]
    },

    "recovering-from-failures": {
        name: "Recovering from Tool Failures",
        scenario: "A tool call failed - what to do next?",
        bestApproach: [
            {
                condition: "relationship_analyze failed with 'Symbol not found'",
                nextAction: "Check error.details.similarSymbols for typos, or use project_search"
            },
            {
                condition: "project_search returned 0 results with type='file'",
                nextAction: "Try type='filename' if searching for a filename"
            },
            {
                condition: "edit_apply failed with 'Target not found'",
                nextAction: "Use code_read to verify exact content, then retry"
            }
        ]
    }
};
