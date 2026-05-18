import { Effect, Layer } from "effect";
import { createCliRenderer } from "@opentui/core";
import { createCommandRunner } from "./services/CommandRunner.js";
import { HomeAssistantService } from "./services/HomeAssistant.js";
import { loadTheme } from "./theme.js";
import { Toast } from "./tui/Toast.js";
import { App } from "./tui/App.js";
import { parseFlags, resolveSubcommand, printHelp } from "./flags.js";
import { menuItemsById } from "./menu.js";
import { loadConfig, saveConfig, isConfigured } from "./config.js";

const log = (msg: string) => console.error(`[ha-tui] ${msg}`);

const flags = parseFlags(process.argv.slice(2));

if (flags.help) {
  printHelp();
  process.exit(0);
}

// Resolve subcommand to determine startup behaviour
let executeItemId: string | undefined;

if (flags.subcommand) {
  const resolved = resolveSubcommand(flags.subcommand);
  if (!resolved) {
    console.error(`Unknown subcommand: ${flags.subcommand}`);
    printHelp();
    process.exit(1);
  }

  const item = menuItemsById.get(resolved.itemId);
  if (item) {
    const { action } = item;
    if (
      action.type === "command" ||
      action.type === "silent" ||
      action.type === "notify" ||
      action.type === "submenu"
    ) {
      executeItemId = resolved.itemId;
    }
  }
}

const program = Effect.gen(function* () {
  const theme = yield* loadTheme;
  log("Starting...");

  const renderer = yield* Effect.promise(() =>
    createCliRenderer({
      exitOnCtrlC: true,
      screenMode: "alternate-screen",
      useMouse: false,
      backgroundColor: theme.bg,
      onDestroy: () => process.exit(0),
    }),
  );
  log("Renderer created");

  const toast = new Toast(renderer, theme);
  const commandRunner = createCommandRunner(renderer, toast);

  // Determine whether the first-run setup view should be shown
  const configured = isConfigured();
  const initialView = configured ? "main" : "setup";
  log(`Config ${configured ? "found" : "not found"} — starting on ${initialView}`);

  // Load whatever config exists (may be empty defaults)
  let config = loadConfig();

  // Build HA service from current config
  let haService = new HomeAssistantService(config);

  const app = new App(
    { renderer, theme, commandRunner },
    {
      title: "Home Assistant TUI",
      executeItemId,
      initialView,
    },
    // onConnectionSaved — called when user saves the connection form
    (values) => {
      log(`Saving new config: url=${values.url}`);
      const newConfig = {
        homeassistant: { url: values.url, token: values.token },
      };
      saveConfig(newConfig);
      config = newConfig;

      // Reconnect with the new config
      haService.disconnect();
      haService = new HomeAssistantService(newConfig);
      haService.subscribe((info) => app.updateConnectionInfo(info));
      void haService.connect();
    },
  );
  log("App created");

  // Subscribe to HA connection state and push updates to the header bar
  haService.subscribe((info) => app.updateConnectionInfo(info));

  // Only attempt connection if a token is configured
  if (configured) {
    log("Connecting to Home Assistant...");
    void haService.connect();
  }

  log("Starting renderer...");
  renderer.start();
  log("Renderer started — TUI is live");

  yield* Effect.never;
});

const runnable = program.pipe(Effect.scoped);

log("Launching...");

Effect.runPromise(runnable).catch((err) => {
  log(`Fatal error: ${err}`);
  console.error(err);
  process.exit(1);
});
