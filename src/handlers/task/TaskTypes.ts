export type TaskMode = "auto" | "ask" | "analyze" | "plan_change" | "apply_change" | "write" | "verify";
export type TaskProfile = "lean" | "fast" | "balanced" | "deep";

export type AutoRepairAttempt = {
    tool: string;
    args: Record<string, unknown>;
    status: "success" | "failure";
    summary: string;
    packId?: string;
    message?: string;
};

export type AutoRepairReport = {
    attempts: AutoRepairAttempt[];
};

export type VerificationResult = {
    targetPath?: string;
    relPath?: string;
    exists: boolean;
    draftId?: string;
    draftFound?: boolean;
    contentMatch?: boolean;
    fileVersionMatch?: boolean;
};
