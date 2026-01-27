const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is required.");
  process.exit(1);
}

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const OPENAI_MODEL = process.env.OPENAI_MODEL || process.env.KAIRO_BENCH_MODEL || "gpt-5.2";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || "60000");
const OPENAI_MAX_OUTPUT_TOKENS = process.env.OPENAI_MAX_OUTPUT_TOKENS
  ? Number(process.env.OPENAI_MAX_OUTPUT_TOKENS)
  : undefined;
const OPENAI_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT;
const OPENAI_VERBOSITY = process.env.OPENAI_VERBOSITY;

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function extractOutputText(response) {
  const outputs = response.output || [];
  for (const item of outputs) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const content of item.content) {
        if (content.type === "output_text") {
          return content.text;
        }
      }
    }
  }
  return null;
}

async function main() {
  const prompt = await readStdin();
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      patch_unified_diff: { type: "string" },
      final_answer: { type: "string" },
      notes: { type: "array", items: { type: "string" } },
      response_id: { type: "string" },
      model: { type: "string" },
      usage: {
        type: "object",
        additionalProperties: true,
        properties: {
          input_tokens: { type: "integer" },
          output_tokens: { type: "integer" }
        }
      }
    },
    required: ["patch_unified_diff", "final_answer", "notes"]
  };

  const body = {
    model: OPENAI_MODEL,
    instructions:
      "Return ONLY JSON that matches the schema. Do not wrap in code fences. " +
      "If no code changes are needed, set patch_unified_diff to an empty string.",
    input: prompt,
    text: {
      format: {
        type: "json_schema",
        name: "agent_output",
        strict: true,
        schema
      }
    },
    temperature: 0
  };

  if (OPENAI_MAX_OUTPUT_TOKENS) {
    body.max_output_tokens = OPENAI_MAX_OUTPUT_TOKENS;
  }
  if (OPENAI_REASONING_EFFORT) {
    body.reasoning = { effort: OPENAI_REASONING_EFFORT };
  }
  if (OPENAI_VERBOSITY) {
    body.text.verbosity = OPENAI_VERBOSITY;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(body),
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    const text = await response.text();
    console.error(`OpenAI API error (${response.status}): ${text}`);
    process.exit(1);
  }

  const data = await response.json();
  const outputText = extractOutputText(data);
  if (!outputText) {
    console.error("No output text found in response.");
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(outputText);
  } catch (err) {
    console.error(`Failed to parse model JSON output: ${err.message}`);
    process.exit(1);
  }

  parsed.usage = {
    input_tokens: data.usage?.input_tokens ?? 0,
    output_tokens: data.usage?.output_tokens ?? 0
  };
  parsed.response_id = data.id;
  parsed.model = data.model;

  process.stdout.write(JSON.stringify(parsed));
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
