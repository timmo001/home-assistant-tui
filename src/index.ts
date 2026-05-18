import { Effect, Layer } from "effect";
import { createCliRenderer } from "@opentui/core";
import { CommandRunner } from "./services/CommandRunner.js";
import { HomeAssistantService } from "./services/HomeAssistant.js";
import { loadTheme } from "./theme.js";
import { Toast } from "./tui/Toast.js";
import { App } from "./tui/App.js";
import { parseFlags, resolveSubcommand, printHelp } from "./flags.js";
import { buildMenu } from "./menu.js";
import { loadConfig, saveConfig, isConfigured } from "./config.js";
import { Strings } from "./i18n/index.js";
import { en } from "./i18n/en.js";
import { runTestConnection } from "./cmd/testConnection.js";

const log = (msg: string) => console.error(`[ha-tui] ${msg}`);

// Build menu with the default locale for CLI argument parsing.
// Rebuilt with the resolved locale inside the Effect program.
const defaultMenu = buildMenu(en);
const flags = parseFlags(process.argv.slice(2), defaultMenu);

if (flags.help) {
  printHelp();
  process.exit(0);
}

// Special diagnostic subcommand — runs without the TUI and exits
if (flags.subcommand === "test-connection") {
  process.on("SIGINT", () => {
    process.stdout.write("\nCancelled.\n");
    process.exit(0);
  });
  Effect.runPromise(runTestConnection).catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  // ── Normal TUI startup ──────────────────────────────────────────────────

  const program = Effect.scoped(
    Effect.gen(function* () {
      const strings = yield* Strings;
      const theme = yield* loadTheme;
      const menu = buildMenu(strings);
      log("Starting...");

      // Resolve subcommand to determine startup behaviour
      let executeItemId: string | undefined;

      if (flags.subcommand) {
        const resolved = resolveSubcommand(flags.subcommand, menu);
        if (!resolved) {
          console.error(strings.errors.unknownSubcommand(flags.subcommand));
          printHelp();
          process.exit(1);
        }

        const item = menu.menuItemsById.get(resolved.itemId);
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
      const config = yield* loadConfig;
      const configured = yield* isConfigured;
      const initialView = configured ? "main" : "setup";
      log(
        `Config ${configured ? "found" : "not found"} — starting on ${initialView}`,
      );

      // Run the app with services provided via layers
      yield* Effect.gen(function* () {
        const ha = yield* HomeAssistantService;
        const cr = yield* CommandRunner;

        const app = new App(
          {
            renderer,
            theme,
            strings,
            menu,
            commandRunner: cr,
            toast,
            baseUrl: config.homeassistant.url,
          },
          {
            executeItemId,
            initialView,
            initialConnectionValues: config.homeassistant,
          },
          // onConnectionSaved — called when user saves the connection form
          async (values) => {
            log(`Saving new config: url=${values.url}`);
            const newConfig = {
              homeassistant: { url: values.url, token: values.token },
            };
            await Effect.runPromise(
              saveConfig(newConfig).pipe(
                Effect.flatMap(() => ha.reconfigure(newConfig)),
              ),
            );
          },
        );
        log("App created");

        // Subscribe to HA connection state and push updates to views
        ha.subscribe((info, conn) => {
          app.updateConnectionInfo(info);
          app.updateConnection(conn);
        });

        // Only attempt connection if a token is configured
        if (configured) {
          log("Connecting to Home Assistant...");
          yield* Effect.forkScoped(ha.connect);
        }

        log("Starting renderer...");
        renderer.start();
        log("Renderer started — TUI is live");

        yield* Effect.never;
      }).pipe(
        Effect.provide(
          Layer.merge(
            HomeAssistantService.layer(config, strings),
            CommandRunner.layer(renderer, toast, strings),
          ),
        ),
      );
    }),
  );

  log("Launching...");

  Effect.runPromise(program).catch((err) => {
    log(`Fatal error: ${err}`);
    console.error(err);
    process.exit(1);
  });
}
