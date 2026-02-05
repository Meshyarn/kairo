export const filterByFrequency = <T extends { count: number }>(
    patterns: T[],
    minFrequency: number
): T[] => {
    return patterns
        .filter(pattern => pattern.count >= minFrequency)
        .sort((a, b) => b.count - a.count);
};
