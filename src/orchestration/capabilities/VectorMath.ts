export interface IVectorMathProvider {
    cosineScores(query: Float32Array, vectors: Float32Array[]): number[];
}
