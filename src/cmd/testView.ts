/**
 * `test-view` — launch the TUI sandbox view directly.
 *
 * Opens the TestView without navigating through the main menu.
 * Useful for exercising TUI scaffolding during development.
 */
import { Effect, Layer } from "effect";
import { createCliRenderer } from "@opentui/core";
import { CommandRunner } from "../services/CommandRunner.js";
import { HomeAssistantService } from "../services/HomeAssistant.js";
import { loadTheme } from "../theme.js";
import { Toast } from "../tui/Toast.js";
import { App } from "../tui/App.js";
import { buildMenu } from "../menu.js";
import { loadConfig, isConfigured } from "../config.js";
import { Strings } from "../i18n/index.js";

const log = (msg: string) => console.error(`[ha-tui:test-view] ${msg}`);

export const runTestView: Effect.Effect<void> = Effect.scoped(
  Effect.gen(function* () {
    const strings = yield* Strings;
    const theme = yield* loadTheme;
    const menu = buildMenu(strings);
    log("Starting test view...");

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
          initialView: "test",
          standalone: true,
          initialConnectionValues: config.homeassistant,
        },
      );
      log("App created with test view");

      ha.subscribe((info, conn) => {
        app.updateConnectionInfo(info);
        app.updateConnection(conn);
      });

      if (configured) {
        log("Connecting to Home Assistant...");
        yield* Effect.forkScoped(ha.connect);
      }

      log("Starting renderer...");
      renderer.start();
      log("Test view is live");

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
