export type TextStats = {
    characters: number;
    words: number;
    lines: number;
};

export interface ITextStatsProvider {
    compute(text: string): TextStats;
}
