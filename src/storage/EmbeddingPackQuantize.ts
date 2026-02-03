export const quantizeQ8 = (vector: Float32Array): { q: Int8Array; scale: number } => {
    let maxAbs = 0;
    for (let i = 0; i < vector.length; i++) {
        const v = Math.abs(vector[i]);
        if (v > maxAbs) maxAbs = v;
    }
    const scale = maxAbs > 0 ? maxAbs / 127 : 1;
    const q = new Int8Array(vector.length);
    for (let i = 0; i < vector.length; i++) {
        const scaled = vector[i] / scale;
        const rounded = Math.round(scaled);
        const clamped = Math.max(-127, Math.min(127, rounded));
        q[i] = clamped;
    }
    return { q, scale };
};

export const dequantizeQ8 = (q: Int8Array, scale: number): Float32Array => {
    const out = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) {
        out[i] = q[i] * scale;
    }
    return out;
};
