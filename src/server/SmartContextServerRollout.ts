export function buildRolloutContext(args: any): { userId: string } | undefined {
  const userId = resolveRolloutUser(args);
  if (!userId) return undefined;
  return { userId };
}

export function resolveRolloutUser(args: any): string | undefined {
  const candidates: Array<unknown> = [];
  if (args && typeof args === "object") {
    const candidatePaths: string[][] = [
      ["userId"],
      ["user", "id"],
      ["user", "email"],
      ["session", "userId"],
      ["session", "user", "id"],
      ["metadata", "userId"],
      ["metadata", "user", "id"],
      ["metadata", "actor", "id"],
      ["client", "userId"],
      ["__client", "userId"],
      ["__context", "userId"],
      ["__metadata", "userId"],
      ["__metadata", "actor", "id"],
      ["identity", "userId"],
      ["actor", "id"]
    ];
    for (const path of candidatePaths) {
      candidates.push(extractNestedValue(args, path));
    }
    candidates.push(extractHeaderUser(args));
  }
  candidates.push(
    process.env.KAIRO_ROLLOUT_USER,
    process.env.KAIRO_USER_ID,
    process.env.KAIRO_DEFAULT_USER
  );
  return pickFirstString(...candidates);
}

function extractNestedValue(source: any, path: string[]): unknown {
  let current = source;
  for (const segment of path) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function extractHeaderUser(args: any): string | undefined {
  const headerSources = [args?.__headers, args?.headers];
  for (const headers of headerSources) {
    if (!headers || typeof headers !== "object") continue;
    for (const key of Object.keys(headers)) {
      const lowered = key.toLowerCase();
      if (lowered === "x-user-id" || lowered === "x-slack-user" || lowered === "x-github-user") {
        const value = headers[key];
        if (typeof value === "string") {
          const trimmed = value.trim();
          if (trimmed) return trimmed;
        }
      }
    }
  }
  return undefined;
}

function pickFirstString(...candidates: Array<unknown>): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return undefined;
}
