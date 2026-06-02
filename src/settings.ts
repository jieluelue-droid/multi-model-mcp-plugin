import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { getModelsDir } from "./config.js";

export interface ModelSettings {
  _name: string;
  _model: string;
  _description: string;
  _added_at: string;
  env: {
    ANTHROPIC_BASE_URL: string;
    ANTHROPIC_AUTH_TOKEN: string;
    ANTHROPIC_MODEL: string;
  };
  mcpServers: Record<string, unknown>;
  permissions: {
    allow: string[];
    deny: string[];
  };
}

const TMP_DIR = path.join(os.tmpdir(), "multi-model");
const MAX_OUTPUT_SIZE = 100 * 1024; // 100KB

// Simple encryption: derive key from machine hostname + username
function getEncryptionKey(): Buffer {
  const raw = `${os.hostname()}:${os.userInfo().username}:multi-model-mcp`;
  return crypto.scryptSync(raw, "multi-model-salt", 32);
}

export function encryptApiKey(apiKey: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(apiKey, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

export function decryptApiKey(encrypted: string): string {
  const key = getEncryptionKey();
  const [ivHex, data] = encrypted.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(data, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function getModelPath(name: string): string {
  return path.join(getModelsDir(), `${name}.json`);
}

export function addModelSettings(
  name: string,
  model: string,
  apiBaseUrl: string,
  apiKey: string,
  description: string,
): void {
  const modelsDir = getModelsDir();
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
  }

  const filePath = getModelPath(name);
  if (fs.existsSync(filePath)) {
    throw new Error(`Model "${name}" already exists. Use a different name or remove it first.`);
  }

  const settings: ModelSettings = {
    _name: name,
    _model: model,
    _description: description,
    _added_at: new Date().toISOString(),
    env: {
      ANTHROPIC_BASE_URL: apiBaseUrl,
      ANTHROPIC_AUTH_TOKEN: encryptApiKey(apiKey),
      ANTHROPIC_MODEL: model,
    },
    mcpServers: {},
    permissions: {
      allow: ["Read", "Edit", "Bash(npm test:*)", "Bash(npm run:*)"],
      deny: ["Bash(rm:*)", "Bash(git push:*)", "Bash(git force:*)"],
    },
  };

  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), "utf-8");
}

export function removeModelSettings(name: string): void {
  const filePath = getModelPath(name);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Model "${name}" does not exist.`);
  }
  fs.unlinkSync(filePath);
}

export function loadModelSettings(name: string): ModelSettings {
  const filePath = getModelPath(name);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Model "${name}" does not exist.`);
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as ModelSettings;
}

export function listModelNames(): string[] {
  const modelsDir = getModelsDir();
  if (!fs.existsSync(modelsDir)) {
    return [];
  }
  return fs
    .readdirSync(modelsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.basename(f, ".json"));
}

export function listAllModels(): Array<{ name: string; model: string; description: string }> {
  return listModelNames().map((name) => {
    const settings = loadModelSettings(name);
    return {
      name: settings._name,
      model: settings._model,
      description: settings._description,
    };
  });
}

/**
 * Create a runtime copy of model settings with decrypted API key.
 * This copy is used by `claude -p --settings <copy-path>`.
 * Each invocation gets its own copy to avoid concurrent process interference.
 */
export function createSettingsCopy(modelName: string): string {
  const settings = loadModelSettings(modelName);

  // Decrypt API key for runtime use
  const runtimeSettings = {
    env: {
      ANTHROPIC_BASE_URL: settings.env.ANTHROPIC_BASE_URL,
      ANTHROPIC_AUTH_TOKEN: decryptApiKey(settings.env.ANTHROPIC_AUTH_TOKEN),
      ANTHROPIC_MODEL: settings.env.ANTHROPIC_MODEL,
    },
    mcpServers: settings.mcpServers,
    permissions: settings.permissions,
  };

  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }

  const copyId = crypto.randomUUID();
  const copyPath = path.join(TMP_DIR, `${copyId}.json`);
  fs.writeFileSync(copyPath, JSON.stringify(runtimeSettings, null, 2), "utf-8");

  return copyPath;
}

export function cleanupSettingsCopy(copyPath: string): void {
  try {
    if (fs.existsSync(copyPath)) {
      fs.unlinkSync(copyPath);
    }
  } catch {
    // Best-effort cleanup; don't throw on failure
  }
}

export function cleanupStaleCopies(maxAgeMs: number = 30 * 60 * 1000): void {
  if (!fs.existsSync(TMP_DIR)) {
    return;
  }
  const now = Date.now();
  const files = fs.readdirSync(TMP_DIR).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const filePath = path.join(TMP_DIR, file);
    try {
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Skip files that disappear between readdir and stat
    }
  }
}

export { MAX_OUTPUT_SIZE };
