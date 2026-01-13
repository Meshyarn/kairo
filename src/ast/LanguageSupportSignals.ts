import { AstManager } from "./AstManager.js";
import { getSupportForLanguageId } from "../config/LanguageSupportLevels.js";
import { resolveParityRequirement } from "../config/LanguageParityGate.js";

export type DegradationSignal = {
    degraded: boolean;
    reason?: string;
    missing?: string[];
};

export async function checkQuerySupport(
    filePath: string,
    queryNames: string[],
    options?: { required?: boolean }
): Promise<DegradationSignal> {
    if (process.env.KAIRO_SKIP_PARITY_CHECK === "true") {
        return { degraded: false };
    }
    const astManager = AstManager.getInstance();
    const languageId = astManager.getLanguageId(filePath);
    const entry = resolveParityRequirement(languageId);
    if (!entry) {
        return { degraded: true, reason: "unsupported_language" };
    }
    const required = options?.required ?? true;
    try {
        const language = await astManager.getLanguageForFile(filePath);
        if (!language) {
            return { degraded: true, reason: "missing_wasm_grammar" };
        }
        const missing: string[] = [];
        for (const queryName of queryNames) {
            const query = await astManager.getQueryProvider().getQuery(language, entry.languageId, queryName);
            if (!query) {
                missing.push(queryName);
            }
        }
        if (missing.length > 0) {
            return {
                degraded: required,
                reason: "missing_query_pack",
                missing
            };
        }
        return { degraded: false };
    } catch {
        return { degraded: true, reason: "missing_wasm_grammar" };
    }
}

export async function checkSkeletonSupport(filePath: string): Promise<DegradationSignal> {
    if (process.env.KAIRO_SKIP_PARITY_CHECK === 'true') {
        return { degraded: false };
    }
    const astManager = AstManager.getInstance();
    const languageId = astManager.getLanguageId(filePath);
    const support = getSupportForLanguageId(languageId);
    if (!support) {
        return { degraded: true, reason: "unsupported_language" };
    }
    const required = Boolean(support?.editPolicy?.requireQueries?.includes("skeleton") ?? true);
    return checkQuerySupport(filePath, ["skeleton"], { required });
}
