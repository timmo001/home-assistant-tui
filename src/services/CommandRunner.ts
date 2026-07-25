import type { CliRenderer } from "@opentui/core";
import { Context, Layer, Effect, Schema } from "effect";
import type { NotifyConfig } from "../types.js";
import type { Toast } from "../tui/Toast.js";
import type { Locale } from "../i18n/index.js";

const log = (msg: string) => console.error(`[ha-tui:CommandRunner] ${msg}`);

/** Service for executing shell commands with TUI suspend/resume lifecycle */
export interface CommandRunnerI {
  /** Suspend the TUI, run the command with inherited stdio, then resume.
   *  When wait is true, shows "Press any key to continue" before resuming. */
  readonly runSuspended: (
    cmd: string,
    wait: boolean,
  ) => Effect.Effect<void, CommandError>;

  /** Run a command in the background without suspending the TUI.
   *  Returns immediately; stdout/stderr are captured silently. */
  readonly runSilent: (cmd: string) => Effect.Effect<void, CommandError>;

  /** Run a command silently with toast notifications for progress and result. */
  readonly runNotify: (
    cmd: string,
    notify: NotifyConfig,
  ) => Effect.Effect<void, CommandError>;
}

export class CommandError extends Schema.TaggedErrorClass<CommandError>()(
  "CommandError",
  {
    command: Schema.String,
    cause: Schema.Defect(),
  },
) {}

function makeCommandRunner(
  renderer: CliRenderer,
  toast: Toast,
  strings: Locale,
): CommandRunnerI {
  return {
    runSuspended: Effect.fn("CommandRunner.runSuspended")((cmd, wait) =>
      Effect.tryPromise({
        try: async () => {
          log(`Suspending for: ${cmd}`);
          renderer.suspend();
          renderer.currentRenderBuffer.clear();

          try {
            const cols = process.stdout.columns || 80;
            const label = ` ${cmd} `;
            const pad = Math.max(0, cols - label.length);
            const left = Math.floor(pad / 2);
            const right = pad - left;
            const header =
              "\x1b[90m" +
              "─".repeat(left) +
              "\x1b[0m\x1b[1m" +
              label +
              "\x1b[0m\x1b[90m" +
              "─".repeat(right) +
              "\x1b[0m";
            process.stdout.write(`\n\n${header}\n\n`);

            const proc = Bun.spawn(["bash", "-c", cmd], {
              stdin: "inherit",
              stdout: "inherit",
              stderr: "inherit",
            });
            await proc.exited;

            if (wait) {
              process.stdout.write(
                `\n\x1b[90m${strings.commands.pressAnyKey}\x1b[0m`,
              );
              await new Promise<void>((resolve) => {
                const wasRaw = process.stdin.isRaw;
                if (process.stdin.isTTY) process.stdin.setRawMode(true);
                process.stdin.resume();
                process.stdin.once("data", () => {
                  if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw);
                  process.stdin.pause();
                  resolve();
                });
              });
            }
          } finally {
            renderer.currentRenderBuffer.clear();
            renderer.resume();
            renderer.requestRender();
            log("Resumed after command");
          }
        },
        catch: (cause) => new CommandError({ command: cmd, cause }),
      }),
    ),

    runSilent: Effect.fn("CommandRunner.runSilent")((cmd) =>
      Effect.tryPromise({
        try: async () => {
          log(`Running silently: ${cmd}`);
          const proc = Bun.spawn(["bash", "-c", cmd], {
            stdout: "pipe",
            stderr: "pipe",
          });
          const exitCode = await proc.exited;

          if (exitCode !== 0) {
            const stderr = await new Response(proc.stderr).text();
            log(`Silent command failed (exit ${exitCode}): ${stderr}`);
          } else {
            log(`Silent command completed: ${cmd}`);
          }
        },
        catch: (cause) => new CommandError({ command: cmd, cause }),
      }),
    ),

    runNotify: Effect.fn("CommandRunner.runNotify")((cmd, notify) =>
      Effect.tryPromise({
        try: async () => {
          log(`Running with notification: ${cmd}`);
          toast.show(notify.id, notify.progress, "info");

          const proc = Bun.spawn(["bash", "-c", cmd], {
            stdout: "pipe",
            stderr: "pipe",
          });
          const exitCode = await proc.exited;

          if (exitCode !== 0) {
            const stderr = await new Response(proc.stderr).text();
            const errMsg =
              stderr.trim().split("\n")[0] || strings.commands.commandFailed;
            log(`Notify command failed (exit ${exitCode}): ${stderr}`);
            toast.show(notify.id, errMsg, "error");
          } else {
            log(`Notify command completed: ${cmd}`);
            toast.show(notify.id, notify.success, "success");
          }
        },
        catch: (cause) => new CommandError({ command: cmd, cause }),
      }),
    ),
  };
}

export class CommandRunner extends Context.Service<
  CommandRunner,
  CommandRunnerI
>()("CommandRunner") {
  static layer(
    renderer: CliRenderer,
    toast: Toast,
    strings: Locale,
  ): Layer.Layer<CommandRunner> {
    return Layer.sync(CommandRunner, () =>
      CommandRunner.of(makeCommandRunner(renderer, toast, strings)),
    );
  }
}
