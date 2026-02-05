export const parseNumberEnv = (raw: string | undefined, fallback: number): number => {
    if (!raw) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
};

export const resolveAlertSeverity = (): 'info' | 'warning' | 'error' | 'critical' => {
    const raw = (process.env.KAIRO_ALERT_SEVERITY ?? 'warning').toLowerCase();
    if (raw === 'info' || raw === 'warning' || raw === 'error' || raw === 'critical') {
        return raw;
    }
    return 'warning';
};

export const resolveBaselineEnabled = (isTestEnv: () => boolean): boolean => {
    const raw = (process.env.KAIRO_BASELINE_ENABLED ?? "auto").toLowerCase();
    if (raw === "off" || raw === "false" || raw === "0") return false;
    if (raw === "on" || raw === "true" || raw === "1") return true;
    return !isTestEnv();
};
