import { describe, it, expect } from "@jest/globals";
import { EditPlanner } from "../../engine/editor/EditPlanning.js";
import { AmbiguousMatchError, HashMismatchError } from "../../engine/editor/EditTypes.js";

describe("EditPlanner", () => {
    it("normalizes replacement strings with escaped quotes and structural escapes", () => {
        const planner = new EditPlanner();
        const content = "A=PLACEHOLDER_A\nB=PLACEHOLDER_B\n";

        const matches = planner.applyEditsInternal(content, [
            { targetString: "PLACEHOLDER_A", replacementString: "\\\"quoted\\\"" },
            { targetString: "PLACEHOLDER_B", replacementString: "line1\\nline2" }
        ]);

        const byOriginal = new Map(matches.map(match => [match.original, match.replacement]));
        expect(byOriginal.get("PLACEHOLDER_A")).toBe("\"quoted\"");
        expect(byOriginal.get("PLACEHOLDER_B")).toBe("line1\nline2");
    });

    it("matches escaped targets and supports levenshtein fuzzy edits", () => {
        const planner = new EditPlanner();
        const content = "line1\nline2\nvalue\tend\nalpha bravo\n";

        const matches = planner.applyEditsInternal(content, [
            { targetString: "line1\\nline2", replacementString: "line1\\nline2" },
            { targetString: "value\\tend", replacementString: "value\\tend", escapeMode: "interpreted" },
            { targetString: "bravp", replacementString: "bravo", fuzzyMode: "levenshtein" }
        ]);

        const newlineMatch = matches.find(match => match.original.includes("\n"));
        expect(newlineMatch?.original).toBe("line1\nline2");

        const tabMatch = matches.find(match => match.original.includes("\t"));
        expect(tabMatch?.original).toBe("value\tend");

        const fuzzy = matches.find(match => match.matchType === "levenshtein");
        expect(["brav", "bravo"]).toContain(fuzzy?.original);
    });

    it("plans insert operations and returns candidates for ambiguous matches", () => {
        const planner = new EditPlanner();
        const content = "first\nsecond\nthird\nsecond\n";

        const results = planner.planEditsFromContent(
            content,
            [
                { targetString: "", replacementString: "INSERT\n", insertMode: "at", insertLineRange: { start: 2 } },
                { targetString: "third", replacementString: "BEFORE\n", insertMode: "before" },
                { targetString: "second", replacementString: "SECOND" }
            ],
            { allowAmbiguousAutoPick: false }
        );

        expect(results[0].match.lineNumber).toBe(2);
        expect(results[1].match.lineNumber).toBe(3);
        expect(results[2].candidateCount).toBeGreaterThan(1);
        expect(results[2].allCandidates?.length).toBeGreaterThan(1);
    });

    it("reports ambiguous matches and diagnostics", () => {
        const planner = new EditPlanner();
        const content = "repeat\nrepeat\n";

        expect(() => {
            planner.applyEditsInternal(content, [
                { targetString: "repeat", replacementString: "x" }
            ]);
        }).toThrow(AmbiguousMatchError);

        const diagnostics = planner.getDiagnostics(content, { targetString: "repeat", replacementString: "x" });
        expect(diagnostics.attempts.length).toBeGreaterThan(0);
        expect(diagnostics.attempts[1].mode).toBe("whitespace");
    });

    it("supports index ranges and detects mismatches", () => {
        const planner = new EditPlanner();
        const content = "hello world";

        const matches = planner.applyEditsInternal(content, [
            { targetString: "hello", replacementString: "hi", indexRange: { start: 0, end: 5 } }
        ]);
        expect(matches[0].start).toBe(0);

        expect(() => {
            planner.applyEditsInternal(content, [
                { targetString: "oops", replacementString: "x", indexRange: { start: 0, end: 5 } }
            ]);
        }).toThrow("Content mismatch");
    });

    it("validates hash guards and insert ranges", () => {
        const planner = new EditPlanner();
        const content = "line1\nline2\n";

        expect(() => {
            planner.applyEditsInternal(content, [
                {
                    targetString: "line1",
                    replacementString: "x",
                    expectedHash: { algorithm: "sha256", value: "bad" }
                }
            ]);
        }).toThrow(HashMismatchError);

        expect(() => {
            planner.applyEditsInternal(content, [
                { targetString: "", replacementString: "x", insertMode: "at", insertLineRange: { start: 5 } }
            ]);
        }).toThrow();
    });

    it("matches encoded escape variants in auto mode", () => {
        const planner = new EditPlanner();
        const content = "line1\\nline2";

        const matches = planner.applyEditsInternal(content, [
            { targetString: "line1\nline2", replacementString: "ok" }
        ]);

        expect(matches[0].original).toBe("line1\\nline2");
    });

    it("matches with indentation normalization across tabs", () => {
        const planner = new EditPlanner();
        const content = "alpha\r\n\tbeta\r\n";

        const results = planner.planEditsFromContent(
            content,
            [
                {
                    targetString: "alpha\n  beta",
                    replacementString: "alpha\n  beta",
                    normalization: "indentation",
                    normalizationConfig: { tabWidth: 2 }
                }
            ],
            { allowAmbiguousAutoPick: true }
        );

        expect(results[0].match.normalizationLevel).toBe("indentation");
    });

    it("uses whitespace fuzzy matching for irregular spacing", () => {
        const planner = new EditPlanner();
        const content = "const    value = 1;";

        const matches = planner.applyEditsInternal(content, [
            { targetString: "const value = 1;", replacementString: "const value = 2;", fuzzyMode: "whitespace" }
        ]);

        expect(matches[0].matchType).toBe("whitespace-fuzzy");
    });

    it("rejects overly long levenshtein targets", () => {
        const planner = new EditPlanner();
        const longTarget = "a".repeat(300);

        expect(() => {
            planner.applyEditsInternal("short", [
                { targetString: longTarget, replacementString: "x", fuzzyMode: "levenshtein" }
            ]);
        }).toThrow(/Levenshtein fuzzy matching/);
    });

    it("includes structural diagnostics when matches are missing", () => {
        const planner = new EditPlanner();
        const content = "alpha beta";
        const diagnostics = planner.getDiagnostics(content, {
            targetString: "alpha.beta",
            replacementString: "x"
        });

        expect(diagnostics.attempts[2].mode).toBe("structural");
    });

    it("encodes and decodes escape sequences explicitly", () => {
        const planner = new EditPlanner() as any;
        const decoded = planner.decodeEscapeSequences("\\n\\r\\t\\0\\b\\f\\v\\\\\\\"\\'\\`\\u0041\\x42\\q");
        expect(decoded).toBe("\n\r\t\0\b\f\v\\\"'`AB\\q");

        const encoded = planner.encodeEscapeSequences("a\nb\tc\0");
        expect(encoded).toBe("a\\nb\\tc\\0");

        const unchanged = planner.encodeEscapeSequences("plain");
        expect(unchanged).toBe("plain");
    });

    it("decodes structural escapes only outside quotes", () => {
        const planner = new EditPlanner() as any;
        const value = "line1\\n\"line2\\n\"\\n`line3\\n`";
        const result = planner.decodeStructuralEscapeSequences(value);
        expect(result).toContain("line1\n");
        expect(result).toContain("\"line2\\n\"");
        expect(result).toContain("`line3\\n`");
    });

    it("escapes regex metacharacters and computes trigram overlap", () => {
        const planner = new EditPlanner() as any;
        const escaped = planner.escapeRegExp("a.b+c?");
        expect(escaped).toBe("a\\.b\\+c\\?");

        const a = planner.trigramKeys("alpha");
        const b = planner.trigramKeys("alpine");
        const score = planner.jaccardSimilarity(a, b);
        expect(score).toBeGreaterThan(0);
    });

    it("builds regex patterns for normalization modes", () => {
        const planner = new EditPlanner() as any;
        const lineEnding = planner.createExactRegex("alpha\nbeta", "line-endings");
        expect("alpha\r\nbeta".match(lineEnding)).not.toBeNull();

        const trailing = planner.createExactRegex("alpha\nbeta", "trailing");
        expect("alpha  \n  beta \n".match(trailing)).not.toBeNull();

        const indentation = planner.createExactRegex("alpha\n\tbeta", "indentation");
        expect("alpha\n  beta".match(indentation)).not.toBeNull();

        const whitespace = planner.createExactRegex("alpha beta", "whitespace");
        expect("alpha   beta".match(whitespace)).not.toBeNull();

        const structural = planner.createExactRegex("call(\"x\")", "structural");
        expect("call('x')".match(structural)).not.toBeNull();
    });

    it("handles normalization attempts and fuzzy regex fallbacks", () => {
        const planner = new EditPlanner() as any;
        expect(planner.getNormalizationAttempts()).toEqual([
            "exact",
            "line-endings",
            "trailing",
            "indentation",
            "whitespace",
            "structural"
        ]);
        expect(planner.getNormalizationAttempts("whitespace")).toEqual([
            "exact",
            "line-endings",
            "trailing",
            "indentation",
            "whitespace"
        ]);
        expect(planner.getNormalizationAttempts("unknown")).toEqual(["exact"]);
        expect(planner.normalizeString("keep", "unknown")).toBe("keep");

        const whitespaceRegex = planner.createFuzzyRegex("   ");
        expect("a  b".match(whitespaceRegex)).not.toBeNull();

        const fuzzyRegex = planner.createFuzzyRegex("alpha beta");
        expect("alpha   beta".match(fuzzyRegex)).not.toBeNull();
    });

    it("computes confidence scores and handles escape fallbacks", () => {
        const planner = new EditPlanner() as any;
        const edit = {
            targetString: "alpha",
            replacementString: "beta",
            beforeContext: "before",
            afterContext: "after",
            lineRange: { start: 1, end: 1 }
        };

        const exactScore = planner.computeMatchConfidence({
            start: 0,
            end: 5,
            replacement: "beta",
            original: "alpha",
            lineNumber: 1,
            matchType: "exact"
        }, edit, "exact");
        expect(exactScore.score).toBeGreaterThan(0.9);

        const normScore = planner.computeMatchConfidence({
            start: 0,
            end: 5,
            replacement: "beta",
            original: "alpha",
            lineNumber: 1,
            matchType: "normalization"
        }, edit, "whitespace");
        expect(normScore.score).toBeGreaterThan(0.7);

        const fuzzyScore = planner.computeMatchConfidence({
            start: 0,
            end: 5,
            replacement: "beta",
            original: "alpha",
            lineNumber: 1,
            matchType: "whitespace-fuzzy"
        }, edit, "whitespace");
        expect(fuzzyScore.score).toBeGreaterThan(0.7);

        const levScore = planner.computeMatchConfidence({
            start: 0,
            end: 5,
            replacement: "beta",
            original: "alpah",
            lineNumber: 1,
            matchType: "levenshtein"
        }, edit, "exact");
        expect(levScore.score).toBeGreaterThan(0.5);

        const decoded = planner.decodeEscapeSequences("\\u0G00\\xZZ");
        expect(decoded).toBe("\\u0G00\\xZZ");

        const structural = planner.decodeStructuralEscapeSequences("one\\rtwo\\tthree");
        expect(structural).toBe("one\rtwo\tthree");

        expect(planner.isBoundaryPosition("alpha", 0)).toBe(true);
        expect(planner.isBoundaryPosition("alpha", 5)).toBe(false);
    });
});
