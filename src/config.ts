import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface RoutingRules {
  task_types: Record<string, string>;
}

export interface Config {
  enabled: boolean;
  mode: "auto" | "manual" | "off";
  require_confirmation: boolean;
  routing_rules: RoutingRules;
}

const CONFIG_DIR = path.join(os.homedir(), ".multi-model");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const MODELS_DIR = path.join(CONFIG_DIR, "models");

const DEFAULT_CONFIG: Config = {
  enabled: true,
  mode: "manual",
  require_confirmation: false,
  routing_rules: { task_types: {} },
};

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getModelsDir(): string {
  return MODELS_DIR;
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function initConfig(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
  }
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");
  }
}

export function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_PATH)) {
    initConfig();
    return { ...DEFAULT_CONFIG };
  }
  const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  const parsed = JSON.parse(raw) as Partial<Config>;
  return { ...DEFAULT_CONFIG, ...parsed };
}

export function saveConfig(config: Config): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}
