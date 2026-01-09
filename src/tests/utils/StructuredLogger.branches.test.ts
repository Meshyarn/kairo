import { describe, it, expect, jest, beforeEach } from "@jest/globals";

describe("StructuredLogger Branches", () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    const getLogger = async () => {
        const { createLogger } = await import("../../utils/StructuredLogger.js?" + Math.random());
        return createLogger;
    };

    it("covers configuredLevel resolution branches", async () => {
        // Case 1: Valid ENV_LOG_LEVEL
        process.env.KAIRO_LOG_LEVEL = "warn";
        const createLogger1 = await getLogger();
        const logger1 = createLogger1("test1");
        const spyWarn = jest.spyOn(console, "warn").mockImplementation(() => {});
        const spyInfo = jest.spyOn(console, "info").mockImplementation(() => {});
        
        logger1.warn("log me");
        logger1.info("hide me");
        
        expect(spyWarn).toHaveBeenCalled();
        expect(spyInfo).not.toHaveBeenCalled();
        spyWarn.mockRestore();
        spyInfo.mockRestore();
    });

    it("covers sink selection branches", async () => {
        process.env.KAIRO_LOG_LEVEL = "debug";
        const createLogger = await getLogger();
        const logger = createLogger("sink-test");
        
        const spyErr = jest.spyOn(console, "error").mockImplementation(() => {});
        const spyWarn = jest.spyOn(console, "warn").mockImplementation(() => {});
        const spyDebug = jest.spyOn(console, "debug").mockImplementation(() => {});
        const spyInfo = jest.spyOn(console, "info").mockImplementation(() => {});

        logger.error("e");
        expect(spyErr).toHaveBeenCalled();
        
        logger.warn("w");
        expect(spyWarn).toHaveBeenCalled();
        
        logger.debug("d");
        expect(spyDebug).toHaveBeenCalled();
        
        logger.info("i");
        expect(spyInfo).toHaveBeenCalled();

        [spyErr, spyWarn, spyDebug, spyInfo].forEach(s => s.mockRestore());
    });
});
