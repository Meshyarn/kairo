# Enable safe writes (plan → apply)

Kairo is designed so frameworks can enable edits without turning every call into a risky "auto-apply".

## Recommended flow

1. Plan first (get a draft + token).
2. Show the diff to a human (or your framework's review gate).
3. Apply using the provided ids/tokens.
4. Verify.

---

## Compact surface example

In compact mode (`task`), the high-level pattern is:

### Step 1: Plan

```json
{
  "request": "Plan: tighten JWT validation in src/auth/jwt.ts",
  "mode": "plan_change",
  "targetFiles": ["src/auth/jwt.ts"]
}
```

**Response:**

```json
{
  "success": true,
  "draftId": "draft_abc123",
  "applyToken": "token_xyz789_onetime",
  "summary": {
    "title": "JWT Validation Hardening",
    "bullets": [
      "Add algorithm whitelist check",
      "Validate issuer claim",
      "Add expiry margin (5-min buffer)"
    ]
  },
  "evidence": [
    { "path": "src/auth/jwt.ts", "kind": "file", "excerpt": "verify(token) { ... }" }
  ]
}
```

**Success indicators:** `success: true` + `draftId` present + `applyToken` present

### Step 2: Review

Display the diff/changes to your user or framework:

```
--- a/src/auth/jwt.ts
+++ b/src/auth/jwt.ts
@@ -5,6 +5,8 @@
 verify(token) {
+  const algorithms = ['HS256', 'RS256'];
+  if (!algorithms.includes(header.alg)) throw new Error('Invalid algorithm');
   const payload = jwt.verify(token, secret);
   return payload;
```

### Step 3: Apply

Only proceed if user/framework approves:

```json
{
  "request": "Apply the plan",
  "mode": "apply_change",
  "draftId": "draft_abc123",
  "applyToken": "token_xyz789_onetime"
}
```

**Response:**

```json
{
  "success": true,
  "result": {
    "changedFiles": ["src/auth/jwt.ts"],
    "summary": "JWT validation hardening applied successfully"
  },
  "verification": {
    "draftVersionMatches": true,
    "filesChanged": 1,
    "linesAdded": 3,
    "linesRemoved": 1
  }
}
```

**Success indicators:** `success: true` + `changedFiles` array non-empty + `verification.draftVersionMatches: true`

### Step 4: Verify (Optional)

For extra safety, compare current repo state against the draft:

```json
{
  "request": "Verify the changes match expectations",
  "mode": "verify",
  "draftId": "draft_abc123"
}
```

---

## Five Pillars surface (advanced)

For granular control, use the pillar tools directly:

```json
{
  "intent": "Tighten JWT validation",
  "targetFiles": ["src/auth/jwt.ts"],
  "edits": [
    {
      "filePath": "src/auth/jwt.ts",
      "targetString": "verify(token) {",
      "replacementString": "verify(token) {\n  const algorithms = ['HS256', 'RS256'];\n  if (!algorithms.includes(header.alg)) throw new Error('Invalid algorithm');"
    }
  ],
  "safety": "plan"
}
```

See [Tool Reference](/agent/TOOL_REFERENCE) for `change()` and `write()` parameters.

---

## Key concepts

- **`draftId`**: Unique identifier for this plan. Required to apply.
- **`applyToken`**: One-time consumable token (MCP mode). Prevents accidental re-apply with stale draft.
- **Drift detection**: If the file changed since planning, `applyToken` is rejected. Re-plan to get new token.
- **`mode="verify"`**: Compare current file against draft (optional safety check).

For more details:

- [Safe Writes concepts](/concepts/safe-writes)
- [Tool Reference](/agent/TOOL_REFERENCE)

