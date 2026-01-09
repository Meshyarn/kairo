export function validateRequiredArgs(args: any, required: string[]): string[] {
    const missing: string[] = [];
    for (const key of required) {
        if (args?.[key] === undefined || args?.[key] === null) {
            missing.push(key);
        }
    }
    return missing;
}
