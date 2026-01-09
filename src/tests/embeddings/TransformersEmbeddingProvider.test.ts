import { describe, it, expect, jest, afterEach } from "@jest/globals";

describe("TransformersEmbeddingProvider", () => {
    afterEach(() => {
        delete process.env.TRANSFORMERS_CACHE;
        delete process.env.HF_HOME;
        jest.resetModules();
    });

    it("embeds text and applies model env configuration", async () => {
        const pipeline = Object.assign(
            async (inputs: string[]) => ({
                data: Float32Array.from([1, 2, 3, 4]),
                dims: [inputs.length, 2]
            }),
            { dispose: jest.fn() }
        );
        const pipelineFactory = jest.fn(async () => pipeline);
        const env: any = {};

        await jest.unstable_mockModule("@xenova/transformers", () => ({
            pipeline: pipelineFactory,
            env
        }));

        const { TransformersEmbeddingProvider } = await import("../../embeddings/TransformersEmbeddingProvider.js");
        const provider = new TransformersEmbeddingProvider({
            model: "test-model",
            normalize: true,
            modelCacheDir: "/tmp/cache",
            modelDir: "/tmp/models"
        });

        const vectors = await provider.embed(["a", "b"]);
        expect(vectors).toHaveLength(2);
        expect(provider.dims).toBe(2);
        expect(env.allowRemoteModels).toBe(false);
        expect(env.allowLocalModels).toBe(true);
        expect(env.localModelPath).toBe("/tmp/models");

        await provider.dispose();
        expect(pipeline.dispose).toHaveBeenCalled();
    });

    it("disposes nested pipeline models when provided", async () => {
        const dispose = jest.fn();
        const pipeline = Object.assign(
            async () => ({
                data: [1, 2],
                dims: [1, 2]
            }),
            { model: { dispose } }
        );
        const pipelineFactory = jest.fn(async () => pipeline);

        await jest.unstable_mockModule("@xenova/transformers", () => ({
            pipeline: pipelineFactory,
            env: {}
        }));

        const { TransformersEmbeddingProvider } = await import("../../embeddings/TransformersEmbeddingProvider.js");
        const provider = new TransformersEmbeddingProvider({
            model: "test-model",
            normalize: false
        });

        await provider.embed(["x"]);
        await provider.dispose();
        expect(dispose).toHaveBeenCalled();
    });
});
