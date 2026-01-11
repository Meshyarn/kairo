import { AstManager } from "./AstManager.js";
import { getSupportForFilePath, getSupportForLanguageId } from "../config/LanguageSupportLevels.js";

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
    const astManager = AstManager.getInstance();
    const languageId = astManager.getLanguageId(filePath);
    const support = getSupportForFilePath(filePath);
    if (!support) {
        return { degraded: true, reason: "unsupported_language" };
    }
    const required = options?.required ?? true;
    try {
        const language = await astManager.getLanguageForFile(filePath);
        if (!language) {
            return { degraded: true, reason: "language_parser_unavailable" };
        }
        const missing: string[] = [];
        for (const queryName of queryNames) {
            const query = await astManager.getQueryProvider().getQuery(language, languageId, queryName);
            if (!query) {
                missing.push(queryName);
            }
        }
        if (missing.length > 0) {
            return {
                degraded: required,
                reason: "language_query_missing",
                missing
            };
        }
        return { degraded: false };
    } catch {
        return { degraded: true, reason: "language_parser_unavailable" };
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
