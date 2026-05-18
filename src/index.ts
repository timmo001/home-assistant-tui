import { Effect, Layer, Stream } from "effect";
import { createCliRenderer } from "@opentui/core";
import { createCommandRunner } from "./services/CommandRunner.js";
import { SystemInfo } from "./services/SystemInfo.js";
import { Watcher } from "./services/Watcher.js";
import { loadTheme } from "./theme.js";
import { Toast } from "./tui/Toast.js";
import { App } from "./tui/App.js";
import { parseFlags, resolveSubcommand, printHelp } from "./flags.js";
import { menuItemsById } from "./menu.js";

const log = (msg: string) => console.error(`[starter-tui] ${msg}`);

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

  // Resolve the Watcher service from the provided layer
  const watcher = yield* Watcher;

  log("Creating renderer...");
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

  // Create the app with concrete dependencies
  const app = new App(
    { renderer, theme, commandRunner },
    {
      title: "Starter TUI",
      subtitle: "menu template",
      executeItemId,
    },
  );
  log("App created");

  // Subscribe to the watcher stream and log state updates.
  // Replace the Effect.sync body with view updates when adding richer views.
  yield* watcher.subscribe().pipe(
    Stream.runForEach((state) =>
      Effect.sync(() => {
        log(
          `Watcher tick: ${state.snapshot.hostname} / ${state.snapshot.loadAvg}`,
        );
      }),
    ),
    Effect.forkScoped,
  );

  log("Starting renderer...");
  renderer.start();
  log("Renderer started — TUI is live");

  // Keep alive until the process exits
  yield* Effect.never;
});

// ---------------------------------------------------------------------------
// Layer composition & launch
// ---------------------------------------------------------------------------

const MainLayer = Watcher.layer.pipe(
  Layer.provideMerge(SystemInfo.layer),
);

const runnable = program.pipe(Effect.scoped, Effect.provide(MainLayer));

log("Launching...");

Effect.runPromise(runnable).catch((err) => {
  log(`Fatal error: ${err}`);
  console.error(err);
  process.exit(1);
});
