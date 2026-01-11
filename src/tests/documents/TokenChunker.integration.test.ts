import * as fs from "fs";
import * as path from "path";
import { describe, it, expect } from "@jest/globals";
import { NativeModuleLoader } from "../../orchestration/capabilities/NativeModuleLoader.js";

const tokenizerPath = path.resolve("node_modules/@xenova/transformers/.cache/Xenova/bge-m3/tokenizer.json");
const core = NativeModuleLoader.getShared().getRustCore();
const SmartChunker: any = core?.SmartChunker ?? null;

const hasTokenizer = fs.existsSync(tokenizerPath);
const run = hasTokenizer && SmartChunker ? it : it.skip;

describe("TokenChunker integration", () => {
    run("produces chunks with expected token counts", () => {
        const chunker = new SmartChunker(tokenizerPath);
        const text = "Hello world ".repeat(300);
        const maxTokens = 64;
        const overlap = 8;
        const chunks = chunker.chunk(text, maxTokens, overlap);

        expect(chunks.length).toBeGreaterThan(1);
        const first = chunks[0];
        expect(first.endToken - first.startToken).toBe(maxTokens);
        expect(first.text.length).toBeGreaterThan(0);
    });
});
