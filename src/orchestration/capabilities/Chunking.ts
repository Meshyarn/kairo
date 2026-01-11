export type TokenChunkResult = {
    text: string;
    startByte: number;
    endByte: number;
    startToken: number;
    endToken: number;
};

export interface ITokenChunkingProvider {
    chunk(text: string, maxTokens: number, overlapTokens: number): TokenChunkResult[];
}
