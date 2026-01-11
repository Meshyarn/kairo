import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { NativeModuleLoader } from "../../orchestration/capabilities/NativeModuleLoader.js";

describe("NativeModuleLoader", () => {
    afterEach(() => {
        NativeModuleLoader.resetForTesting();
        jest.restoreAllMocks();
    });

    it("attempts to load core once and warns once on failure", () => {
        let calls = 0;
        NativeModuleLoader.setTestLoader(() => {
            calls += 1;
            throw new Error("boom");
        });
        const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
        const loader = NativeModuleLoader.getShared();

        const first = loader.getRustCore();
        const second = loader.getRustCore();

        expect(first).toBeNull();
        expect(second).toBeNull();
        expect(calls).toBe(1);
        expect(warnSpy).toHaveBeenCalledTimes(1);
    });
});
