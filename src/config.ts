import { parse, stringify } from "yaml";
import * as fs from "fs";
import * as path from "path";
import { Data, Effect } from "effect";

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

export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly cause: unknown;
}> {}

/** Load config from disk, merging with defaults for any missing fields. */
export const loadConfig: Effect.Effect<HaTuiConfig> = Effect.sync(() => {
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
});

/** Persist config to disk. Creates the config directory if needed. */
export const saveConfig = (
  config: HaTuiConfig,
): Effect.Effect<void, ConfigError> =>
  Effect.try({
    try: () => {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(CONFIG_PATH, stringify(config), "utf-8");
    },
    catch: (cause) => new ConfigError({ cause }),
  });

/**
 * Returns true when a config file exists with a non-empty token.
 * A false result means the first-run setup flow should be shown.
 */
export const isConfigured: Effect.Effect<boolean> = Effect.gen(function* () {
  const accessible = yield* Effect.sync(() => {
    try {
      fs.accessSync(CONFIG_PATH);
      return true;
    } catch {
      return false;
    }
  });
  if (!accessible) return false;
  const cfg = yield* loadConfig;
  return cfg.homeassistant.token.length > 0;
});
