# Advanced tuning

This page is for deeper tuning once you have reliable “first success”.

## Adaptive LOD

Adaptive LOD downshifts output detail when budgets/timeboxing require it.

| Variable | Purpose | Notes |
|---|---|---|
| `KAIRO_ADAPTIVE_LOD_ENABLED` | Enable adaptive profile downshift. | Default `true`; set `false` to disable. |
| `KAIRO_ADAPTIVE_LOD_WINDOW` | Sliding window size (calls). | Default 12. |
| `KAIRO_ADAPTIVE_LOD_COOLDOWN_CALLS` | Cooldown before allowing recovery. | Default 20. |

## Scale tiers

Scale tiers cap behavior for large repos.

| Variable | Purpose | Notes |
|---|---|---|
| `KAIRO_SCALE_TIER_S_MAX_FILES` | Max file count for scale tier S. | Default 5000. |
| `KAIRO_SCALE_TIER_M_MAX_FILES` | Max file count for scale tier M. | Default 50000. |

For the complete set:

- [Configuration (all env vars)](/guides/configuration)
