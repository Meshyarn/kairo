import type { TransactionLogEntry } from "./IndexTypes.js";

type TransactionStoreState = {
    transactions: Map<string, TransactionLogEntry>;
};

const cloneTransaction = (entry: TransactionLogEntry): TransactionLogEntry => {
    return {
        ...entry,
        diffSummary: entry.diffSummary ? { ...entry.diffSummary } : undefined,
        filesTouched: entry.filesTouched ? entry.filesTouched.map(item => ({ ...item })) : undefined,
        snapshots: entry.snapshots.map(snapshot => ({ ...snapshot }))
    };
};

export const upsertPendingTransaction = (store: TransactionStoreState, entry: TransactionLogEntry): void => {
    store.transactions.set(entry.id, { ...entry });
};

export const listPendingTransactions = (store: TransactionStoreState): TransactionLogEntry[] => {
    const entries: TransactionLogEntry[] = [];
    for (const entry of store.transactions.values()) {
        if (entry.status === "pending") {
            entries.push(cloneTransaction(entry));
        }
    }
    return entries.sort((a, b) => a.timestamp - b.timestamp);
};

export const markTransactionCommitted = (store: TransactionStoreState, id: string, entry: TransactionLogEntry): void => {
    store.transactions.set(id, { ...entry, status: "committed" });
};

export const markTransactionRolledBack = (store: TransactionStoreState, id: string): void => {
    const entry = store.transactions.get(id);
    if (!entry) return;
    store.transactions.set(id, { ...entry, status: "rolled_back" });
};

export const listTransactions = (
    store: TransactionStoreState,
    options?: { status?: "pending" | "committed" | "rolled_back"; limit?: number }
): TransactionLogEntry[] => {
    const status = options?.status;
    const entries: TransactionLogEntry[] = [];
    for (const entry of store.transactions.values()) {
        if (status && entry.status !== status) continue;
        entries.push(cloneTransaction(entry));
    }
    entries.sort((a, b) => b.timestamp - a.timestamp);
    if (typeof options?.limit === "number") {
        return entries.slice(0, Math.max(0, options.limit));
    }
    return entries;
};
