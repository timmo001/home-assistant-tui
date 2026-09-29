import type { CliRenderer } from "@opentui/core";
import { Context, Layer, Effect, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
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

export class CommandError extends Schema.TaggedError<CommandError>()(
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
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
): CommandRunnerI {
  const runBash = (cmd: string, stdio: "inherit" | "pipe") =>
    Effect.scoped(
      Effect.gen(function* () {
        const child = yield* spawner.spawn(
          ChildProcess.make("bash", ["-c", cmd], {
            stdin: stdio === "inherit" ? "inherit" : "ignore",
            stdout: stdio,
            stderr: stdio,
          }),
        );

        if (stdio === "inherit") {
          return { code: Number(yield* child.exitCode), stderr: "" };
        }

        const [, stderr, code] = yield* Effect.all(
          [
            Stream.runDrain(child.stdout),
            child.stderr.pipe(Stream.decodeText(), Stream.mkString),
            child.exitCode,
          ],
          { concurrency: "unbounded" },
        );

        return { code: Number(code), stderr };
      }),
    );

  return {
    runSuspended: Effect.fn("CommandRunner.runSuspended")((cmd, wait) =>
      Effect.gen(function* () {
        log(`Suspending for: ${cmd}`);
        renderer.suspend();
        renderer.currentRenderBuffer.clear();

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

        yield* runBash(cmd, "inherit");

        if (wait) {
          process.stdout.write(
            `\n\x1b[90m${strings.commands.pressAnyKey}\x1b[0m`,
          );
          yield* Effect.promise(
            () =>
              new Promise<void>((resolve) => {
                const wasRaw = process.stdin.isRaw;

                if (process.stdin.isTTY) process.stdin.setRawMode(true);
                process.stdin.resume();
                process.stdin.once("data", () => {
                  if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw);
                  process.stdin.pause();
                  resolve();
                });
              }),
          );
        }
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            renderer.currentRenderBuffer.clear();
            renderer.resume();
            renderer.requestRender();
            log("Resumed after command");
          }),
        ),
        Effect.mapError((cause) => new CommandError({ command: cmd, cause })),
      ),
    ),

    runSilent: Effect.fn("CommandRunner.runSilent")((cmd) =>
      Effect.gen(function* () {
        log(`Running silently: ${cmd}`);

        const { code, stderr } = yield* runBash(cmd, "pipe");

        if (code !== 0) {
          log(`Silent command failed (exit ${code}): ${stderr}`);
        } else {
          log(`Silent command completed: ${cmd}`);
        }
      }).pipe(
        Effect.mapError((cause) => new CommandError({ command: cmd, cause })),
      ),
    ),

    runNotify: Effect.fn("CommandRunner.runNotify")((cmd, notify) =>
      Effect.gen(function* () {
        log(`Running with notification: ${cmd}`);
        toast.show(notify.id, notify.progress, "info");

        const { code, stderr } = yield* runBash(cmd, "pipe");

        if (code !== 0) {
          const errMsg =
            stderr.trim().split("\n")[0] || strings.commands.commandFailed;

          log(`Notify command failed (exit ${code}): ${stderr}`);
          toast.show(notify.id, errMsg, "error");
        } else {
          log(`Notify command completed: ${cmd}`);
          toast.show(notify.id, notify.success, "success");
        }
      }).pipe(
        Effect.mapError((cause) => new CommandError({ command: cmd, cause })),
      ),
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
  ): Layer.Layer<
    CommandRunner,
    never,
    ChildProcessSpawner.ChildProcessSpawner
  > {
    return Layer.effect(
      CommandRunner,
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

        return CommandRunner.of(
          makeCommandRunner(renderer, toast, strings, spawner),
        );
      }),
    );
  }
}
