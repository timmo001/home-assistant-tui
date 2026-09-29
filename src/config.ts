import { parse, stringify } from "yaml";
import * as os from "os";
import * as path from "path";
import { Effect, FileSystem, Schema } from "effect";

const CONFIG_DIR = path.join(
  os.homedir(),
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

const ConfigFile = Schema.Struct({
  homeassistant: Schema.optionalKey(
    Schema.Struct({
      url: Schema.optionalKey(Schema.String),
      token: Schema.optionalKey(Schema.String),
    }),
  ),
});

type ConfigFile = typeof ConfigFile.Type;

const DEFAULT_CONFIG: HaTuiConfig = {
  homeassistant: {
    url: DEFAULT_HA_URL,
    token: "",
  },
};

export class ConfigError extends Schema.TaggedError<ConfigError>()(
  "ConfigError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}

/** Load config from disk, merging with defaults for any missing fields. */
export const loadConfig: Effect.Effect<
  HaTuiConfig,
  never,
  FileSystem.FileSystem
> = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  const parsed = yield* fs.readFileString(CONFIG_PATH).pipe(
    Effect.mapError((cause) => new ConfigError({ operation: "load", cause })),
    Effect.flatMap((contents) =>
      Effect.try({
        try: () => parse(contents),
        catch: (cause) => new ConfigError({ operation: "load", cause }),
      }),
    ),
    Effect.flatMap(Schema.decodeUnknownEffect(ConfigFile)),
    Effect.orElseSucceed((): ConfigFile => ({})),
  );

  return {
    homeassistant: {
      url:
        parsed.homeassistant?.url?.trim() || DEFAULT_CONFIG.homeassistant.url,
      token: parsed.homeassistant?.token?.trim() ?? "",
    },
  };
});

/** Persist config to disk. Creates the config directory if needed. */
export const saveConfig = (
  config: HaTuiConfig,
): Effect.Effect<void, ConfigError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    yield* fs.makeDirectory(CONFIG_DIR, { recursive: true });
    yield* fs.writeFileString(CONFIG_PATH, stringify(config));
  }).pipe(
    Effect.mapError((cause) => new ConfigError({ operation: "save", cause })),
  );

/**
 * Returns true when a config file exists with a non-empty token.
 * A false result means the first-run setup flow should be shown.
 */
export const isConfigured: Effect.Effect<
  boolean,
  never,
  FileSystem.FileSystem
> = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  const accessible = yield* fs
    .exists(CONFIG_PATH)
    .pipe(Effect.orElseSucceed(() => false));

  if (!accessible) return false;
  const cfg = yield* loadConfig;

  return cfg.homeassistant.token.length > 0;
});
