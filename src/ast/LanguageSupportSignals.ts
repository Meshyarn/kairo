import { AstManager } from "./AstManager.js";
import { getSupportForLanguageId } from "../config/LanguageSupportLevels.js";

export type DegradationSignal = {
    degraded: boolean;
    reason?: string;
    missing?: string[];
};

export async function checkSkeletonSupport(filePath: string): Promise<DegradationSignal> {
    const astManager = AstManager.getInstance();
    const languageId = astManager.getLanguageId(filePath);
    const support = getSupportForLanguageId(languageId);

    try {
        const language = await astManager.getLanguageForFile(filePath);
        if (!language) {
            return { degraded: true, reason: "language_parser_unavailable" };
        }
        const query = await astManager.getQueryProvider().getQuery(language, languageId, "skeleton");
        if (!query) {
            return {
                degraded: Boolean(support?.editPolicy?.requireQueries?.includes("skeleton") ?? true),
                reason: "language_query_missing",
                missing: ["skeleton"]
            };
        }
        return { degraded: false };
    } catch {
        return { degraded: true, reason: "language_parser_unavailable" };
    }
}
