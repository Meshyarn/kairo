export type DiffResult = {
    diff: string;
    added: number;
    removed: number;
};

export interface IDiffingProvider {
    diffUnified(oldText: string, newText: string, contextLines: number): DiffResult;
}
