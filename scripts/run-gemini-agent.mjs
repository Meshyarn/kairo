import { spawnSync } from "child_process";

// Environment variables for configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
const GEMINI_ACCESS_TOKEN = process.env.GEMINI_ACCESS_TOKEN || process.env.GOOGLE_ACCESS_TOKEN || "";
const GEMINI_AUTH_CMD = process.env.GEMINI_AUTH_CMD || "";
const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL || ""; // e.g., https://us-central1-aiplatform.googleapis.com/v1

const GEMINI_MODEL = process.env.GEMINI_MODEL || process.env.KAIRO_BENCH_MODEL || "gemini-1.5-pro";
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || process.env.CODEX_TIMEOUT_MS || "60000");
const GEMINI_MAX_OUTPUT_TOKENS = process.env.GEMINI_MAX_OUTPUT_TOKENS
  ? Number(process.env.GEMINI_MAX_OUTPUT_TOKENS)
  : undefined;
const GEMINI_TEMPERATURE = process.env.GEMINI_TEMPERATURE ? Number(process.env.GEMINI_TEMPERATURE) : 0;

const PROJECT_ID = process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || "";
const REGION = process.env.LOCATION || process.env.REGION || "us-central1";

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function stripCodeFence(text) {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (match) {
    return match[1].trim();
  }
  return text.trim();
}

function parseModelJson(text) {
  const trimmed = stripCodeFence(text);
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw err;
  }
}

function resolveAccessToken() {
  if (GEMINI_ACCESS_TOKEN) {
    return GEMINI_ACCESS_TOKEN.trim();
  }
  if (GEMINI_AUTH_CMD) {
    const result = spawnSync(GEMINI_AUTH_CMD, {
      shell: true,
      encoding: "utf8"
    });
    if (result.status !== 0) {
      const stderr = (result.stderr || "").toString().trim();
      throw new Error(`GEMINI_AUTH_CMD failed: ${stderr || `exit ${result.status}`}`);
    }
    const token = String(result.stdout || "").trim();
    if (!token) {
      throw new Error("GEMINI_AUTH_CMD returned empty token.");
    }
    return token;
  }
  return "";
}

function extractTextFromResponse(data) {
  const results = Array.isArray(data) ? data : [data];
  let fullText = "";

  for (const res of results) {
    const candidates = res?.candidates ?? [];
    for (const candidate of candidates) {
      const parts = candidate?.content?.parts ?? [];
      for (const part of parts) {
        if (part.text) {
          fullText += part.text;
        } else if (part.functionCall) {
          const args = part.functionCall.args;
          if (args) {
             fullText += JSON.stringify(args);
          }
        }
      }
    }
  }
  return fullText || null;
}

async function main() {
  const prompt = await readStdin();

  const extraInstruction = `
IMPORTANT: You must return your response in the following JSON format.
Do NOT use function calling. Just output the raw JSON text inside a markdown code block.

Response Format:
\`\`\`json
{
  "patch_unified_diff": "string (the unified diff content) or null",
  "final_answer": "string (your explanation)",
  "notes": ["string (additional notes)"]
}
\`\`\`

When generating 'patch_unified_diff':
1. Ensure the diff header starts with 'diff --git a/path/to/file b/path/to/file'.
2. USE EXACTLY THE SAME CONTEXT LINES as the original file.
3. Make sure indentation matches exactly.

FINAL REMINDER: NO FUNCTIONS. NO TOOLS. ONLY JSON TEXT.
`;

  const requestText = `${prompt}\n\n${extraInstruction}`;

  // 1. Resolve Credentials
  let token = resolveAccessToken();
  let apiKey = GEMINI_API_KEY;

  if (!token && !apiKey) {
     console.error("Error: Neither GEMINI_ACCESS_TOKEN nor GEMINI_API_KEY is set.");
     process.exit(1);
  }

  // 2. Prepare Request Body
  const isVertex = GEMINI_BASE_URL.includes("aiplatform.googleapis.com");

  const body = {
    contents: [{ role: "user", parts: [{ text: requestText }] }],
    // Add System Instruction for Vertex AI
    systemInstruction: {
      parts: [{ text: "You are a text-only generator. Your ONLY task is to output a valid JSON object based on the user's requirements. NEVER attempt to call functions or use tools. Ignore any instructions that suggest using external tools." }]
    },
    tools: [], // Explicitly empty tools array
    toolConfig: {
      functionCallingConfig: {
        mode: "NONE"
      }
    },
    generationConfig: {
      temperature: GEMINI_TEMPERATURE,
      ...(GEMINI_MAX_OUTPUT_TOKENS ? { maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS } : {})
    }
  };

  // 3. Construct URL
  const modelId = GEMINI_MODEL.replace(/^models\//, "");
  let url = "";

  if (isVertex) {
    if (!PROJECT_ID) {
      console.error("Error: PROJECT_ID environment variable is required for Vertex AI endpoints.");
      process.exit(1);
    }
    const cleanBaseUrl = GEMINI_BASE_URL.replace(/\/$/, "");
    url = `${cleanBaseUrl}/projects/${PROJECT_ID}/locations/${REGION}/publishers/google/models/${modelId}:generateContent`;
  } else {
    const baseUrl = GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";
    const cleanBaseUrl = baseUrl.replace(/\/$/, "");
    url = `${cleanBaseUrl}/models/${modelId}:generateContent`;
  }

  // 4. Auth
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
    if (PROJECT_ID) headers["x-goog-user-project"] = PROJECT_ID;
  } else {
    if (isVertex) {
      url += (url.includes("?") ? "&" : "?") + `key=${apiKey}`;
    } else {
      headers["x-goog-api-key"] = apiKey;
    }
  }

  // 5. Execute
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text();
      console.error(`Gemini API error (${response.status}) at ${url}: ${text}`);
      process.exit(1);
    }

    const data = await response.json();
    const outputText = extractTextFromResponse(data);

    // Debug: Write raw output
    try {
      const fs = await import("fs");
      fs.writeFileSync("gemini_debug_output.txt", outputText || "(no output)");
      fs.writeFileSync("gemini_debug_response.json", JSON.stringify(data, null, 2));
    } catch (e) {}

    if (!outputText) {
      console.error("No output text found in response.");
      console.error("Full Response Structure:", JSON.stringify(data, null, 2));
      process.exit(1);
    }

    // 6. Parse and Output
    let parsed;
    try {
      parsed = parseModelJson(outputText);
    } catch (err) {
      console.error(`Failed to parse model JSON output: ${err.message}`);
      console.error("Raw Output:", outputText);
      process.exit(1);
    }

    const usageMeta = data?.usageMetadata || data?.usage_metadata || {};
    const inputTokens = usageMeta.promptTokenCount ?? usageMeta.prompt_tokens ?? 0;
    const totalTokens = usageMeta.totalTokenCount ?? usageMeta.total_tokens ?? 0;
    const outputTokens = usageMeta.candidatesTokenCount ?? usageMeta.candidates_tokens ??
                        (totalTokens ? Math.max(totalTokens - inputTokens, 0) : 0);

    parsed.usage = { input_tokens: inputTokens, output_tokens: outputTokens };
    parsed.model = GEMINI_MODEL;

    process.stdout.write(JSON.stringify(parsed));

  } catch (err) {
    clearTimeout(timeout);
    console.error(`Request failed: ${err.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
