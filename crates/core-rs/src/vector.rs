use napi::bindgen_prelude::Float32Array;
use napi_derive::napi;

#[napi]
pub fn cosine_scores(query: Float32Array, vectors: Vec<Float32Array>) -> Vec<f64> {
    let query_slice = query.as_ref();
    let mut scores = Vec::with_capacity(vectors.len());

    let mut norm_q = 0.0f64;
    for &v in query_slice {
        let vf = v as f64;
        norm_q += vf * vf;
    }
    if norm_q == 0.0 {
        return vec![0.0; vectors.len()];
    }

    for vector in vectors {
        let slice = vector.as_ref();
        let len = std::cmp::min(query_slice.len(), slice.len());
        let mut dot = 0.0f64;
        let mut norm_v = 0.0f64;
        for i in 0..len {
            let a = query_slice[i] as f64;
            let b = slice[i] as f64;
            dot += a * b;
            norm_v += b * b;
        }
        if norm_v == 0.0 {
            scores.push(0.0);
        } else {
            scores.push(dot / (norm_q.sqrt() * norm_v.sqrt()));
        }
    }

    scores
}
