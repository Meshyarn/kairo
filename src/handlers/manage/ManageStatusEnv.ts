export const parseNumberEnv = (raw: string | undefined, fallback: number): number => {
    if (!raw) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
};
