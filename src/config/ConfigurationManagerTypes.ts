export type OverridePolicyConfig = {
    enabled?: boolean;
    maxTtlMinutes?: number;
    maxFiles?: number;
    allowed?: Record<string, boolean | "confirm_only">;
};
