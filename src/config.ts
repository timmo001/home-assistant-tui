import { parse, stringify } from "yaml";
import * as fs from "fs";
import * as path from "path";

const CONFIG_DIR = path.join(
  process.env.HOME ?? "~",
  ".local",
  "share",
  "home-assistant-tui",
);

export const CONFIG_PATH = path.join(CONFIG_DIR, "config.yml");

export const DEFAULT_HA_URL = "http://homeassistant.local:8123";

export interface HaTuiConfig {
  readonly homeassistant: {
    readonly url: string;
    readonly token: string;
  };
}

const DEFAULT_CONFIG: HaTuiConfig = {
  homeassistant: {
    url: DEFAULT_HA_URL,
    token: "",
  },
};

/** Load config from disk, merging with defaults for any missing fields. */
export function loadConfig(): HaTuiConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const parsed = parse(raw) as Partial<HaTuiConfig> | null;
    return {
      homeassistant: {
        url:
          parsed?.homeassistant?.url?.trim() ||
          DEFAULT_CONFIG.homeassistant.url,
        token: parsed?.homeassistant?.token?.trim() ?? "",
      },
    };
  } catch {
    return {
      homeassistant: { ...DEFAULT_CONFIG.homeassistant },
    };
  }
}

/** Persist config to disk. Creates the config directory if needed. */
export function saveConfig(config: HaTuiConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, stringify(config), "utf-8");
}

/**
 * Returns true when a config file exists with a non-empty token.
 * A false result means the first-run setup flow should be shown.
 */
export function isConfigured(): boolean {
  try {
    fs.accessSync(CONFIG_PATH);
  } catch {
    return false;
  }
  const cfg = loadConfig();
  return cfg.homeassistant.token.length > 0;
}
