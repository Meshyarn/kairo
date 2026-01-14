import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MODEL = "multilingual-e5-small";

const modelRaw = process.env.KAIRO_EMBEDDING_MODEL || DEFAULT_MODEL;
const modelId = normalizeModelId(modelRaw);
const profileRaw = (process.env.KAIRO_MODEL_BUNDLE_PROFILE || "minimal").trim().toLowerCase();
const bundleProfile = profileRaw === "full" ? "full" : "minimal";
const quantized = process.env.KAIRO_EMBEDDING_QUANTIZED !== "false";

if (!modelId || modelId === "hash") {
    console.log("[bundle-models] Hash embedding selected; skipping model bundle.");
    process.exit(0);
}

const sourceEnv = process.env.KAIRO_MODEL_SOURCE
    || process.env.KAIRO_MODEL_SOURCE_DIR
    || process.env.KAIRO_MODEL_BUNDLE_SOURCE;
const sourceBase = sourceEnv
    ? path.resolve(sourceEnv)
    : path.join(ROOT_DIR, "models");

const skipBundle = process.env.KAIRO_SKIP_MODEL_BUNDLE === "true";
const sourcePath = await resolveModelSource(sourceBase, modelId);
if (!sourcePath) {
    const message = `[bundle-models] Model source not found for "${modelId}". Set KAIRO_MODEL_SOURCE or provide ./models/${modelId}.`;
    if (skipBundle) {
        console.warn(`${message} Skipping bundle because KAIRO_SKIP_MODEL_BUNDLE=true.`);
        process.exit(0);
    }
    console.error(message);
    process.exit(1);
}

const destinationRoot = process.env.KAIRO_MODEL_DIR
    ? path.resolve(process.env.KAIRO_MODEL_DIR)
    : path.join(ROOT_DIR, "dist", "models");
const destinationPath = path.join(destinationRoot, modelId);

await fs.rm(destinationPath, { recursive: true, force: true });
if (bundleProfile === "full") {
    await copyDir(sourcePath, destinationPath);
} else {
    await copyMinimalBundle(sourcePath, destinationPath, { quantized });
}

const required = [
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    quantized ? path.join("onnx", "model_quantized.onnx") : path.join("onnx", "model.onnx")
];
const missing = await checkMissingFiles(destinationPath, required);
if (missing.length > 0) {
    console.warn(`[bundle-models] Bundled model missing expected files: ${missing.join(", ")}`);
}

await writeManifest(destinationPath, {
    modelId,
    profile: bundleProfile,
    quantized,
    requiredFiles: required
});

console.log(`[bundle-models] Bundled "${modelId}" -> ${destinationPath}`);

function normalizeModelId(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) return "";
    if (trimmed.toLowerCase().startsWith("bundled:")) {
        return trimmed.slice("bundled:".length).trim();
    }
    return trimmed;
}

async function resolveModelSource(basePath, modelId) {
    if (await looksLikeModelRoot(basePath)) {
        return basePath;
    }
    const candidate = path.join(basePath, modelId);
    if (await looksLikeModelRoot(candidate)) {
        return candidate;
    }
    return null;
}

async function looksLikeModelRoot(candidate) {
    try {
        const stat = await fs.stat(candidate);
        if (!stat.isDirectory()) return false;
        const configPath = path.join(candidate, "config.json");
        const tokenizerPath = path.join(candidate, "tokenizer.json");
        await fs.access(configPath);
        await fs.access(tokenizerPath);
        return true;
    } catch {
        return false;
    }
}

async function copyDir(src, dest) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            await copyDir(srcPath, destPath);
        } else if (entry.isFile()) {
            await fs.copyFile(srcPath, destPath);
        }
    }
}

async function copyMinimalBundle(src, dest, options) {
    await fs.mkdir(dest, { recursive: true });
    const requiredFiles = [
        "config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        options.quantized ? path.join("onnx", "model_quantized.onnx") : path.join("onnx", "model.onnx")
    ];
    const optionalFiles = [
        "special_tokens_map.json",
        "sentencepiece.bpe.model",
        "quant_config.json",
        "vocab.json",
        "merges.txt",
        "tokenizer.model"
    ];
    for (const file of requiredFiles) {
        await copyFileOrThrow(src, dest, file);
    }
    for (const file of optionalFiles) {
        await copyFileIfExists(src, dest, file);
    }
}

async function copyFileOrThrow(srcRoot, destRoot, relativePath) {
    const srcPath = path.join(srcRoot, relativePath);
    const destPath = path.join(destRoot, relativePath);
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.copyFile(srcPath, destPath);
}

async function copyFileIfExists(srcRoot, destRoot, relativePath) {
    const srcPath = path.join(srcRoot, relativePath);
    try {
        await fs.access(srcPath);
    } catch {
        return;
    }
    const destPath = path.join(destRoot, relativePath);
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.copyFile(srcPath, destPath);
}

async function checkMissingFiles(root, files) {
    const missing = [];
    for (const file of files) {
        try {
            await fs.access(path.join(root, file));
        } catch {
            missing.push(file);
        }
    }
    return missing;
}

async function writeManifest(destRoot, payload) {
    const manifest = {
        ...payload,
        createdAt: new Date().toISOString()
    };
    const manifestPath = path.join(destRoot, "kairo-model.json");
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}
