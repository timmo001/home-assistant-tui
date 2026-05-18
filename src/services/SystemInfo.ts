import { Context, Effect, Layer, Schema } from "effect";

// ---------------------------------------------------------------------------
// Typed domain error (Issue #3)
// ---------------------------------------------------------------------------

/** Structured error for system-info operations */
export class SystemInfoError extends Schema.TaggedErrorClass<SystemInfoError>()(
  "SystemInfoError",
  { message: Schema.String },
) {}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/** Aggregated snapshot returned by {@link SystemInfo.getSnapshot} */
export interface SystemSnapshot {
  readonly hostname: string;
  readonly uptime: string;
  readonly loadAvg: string;
}

// ---------------------------------------------------------------------------
// Named effect helpers (Issue #4)
// ---------------------------------------------------------------------------

/** Run a shell command and return trimmed stdout */
const runCmd = Effect.fn("SystemInfo.runCmd")(function* (
  cmd: string,
  args: readonly string[],
): Effect.fn.Return<string, SystemInfoError> {
  return yield* Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn([cmd, ...args], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        throw new Error(
          `${cmd} exited ${exitCode}: ${stderr.trim() || "(no output)"}`,
        );
      }
      return (await new Response(proc.stdout).text()).trim();
    },
    catch: (error) =>
      new SystemInfoError({
        message: error instanceof Error ? error.message : String(error),
      }),
  });
});

const getHostname = Effect.fn("SystemInfo.getHostname")(function* (): Effect.fn.Return<
  string,
  SystemInfoError
> {
  return yield* runCmd("hostname", []);
});

const getUptime = Effect.fn("SystemInfo.getUptime")(function* (): Effect.fn.Return<
  string,
  SystemInfoError
> {
  return yield* runCmd("uptime", ["-p"]);
});

const getLoadAvg = Effect.fn("SystemInfo.getLoadAvg")(function* (): Effect.fn.Return<
  string,
  SystemInfoError
> {
  return yield* runCmd("cat", ["/proc/loadavg"]);
});

const getSnapshot = Effect.fn("SystemInfo.getSnapshot")(function* (): Effect.fn.Return<
  SystemSnapshot,
  SystemInfoError
> {
  const hostname = yield* getHostname();
  const uptime = yield* getUptime();
  const loadAvg = yield* getLoadAvg();
  return { hostname, uptime, loadAvg };
});

// ---------------------------------------------------------------------------
// Service definition (Issue #2)
// ---------------------------------------------------------------------------

/** Service interface for querying basic system information */
interface SystemInfoService {
  readonly getHostname: () => Effect.Effect<string, SystemInfoError>;
  readonly getUptime: () => Effect.Effect<string, SystemInfoError>;
  readonly getLoadAvg: () => Effect.Effect<string, SystemInfoError>;
  readonly getSnapshot: () => Effect.Effect<SystemSnapshot, SystemInfoError>;
}

/** Effect service providing system information queries */
export class SystemInfo extends Context.Service<
  SystemInfo,
  SystemInfoService
>()("SystemInfo") {
  static readonly layer = Layer.succeed(SystemInfo, {
    getHostname,
    getUptime,
    getLoadAvg,
    getSnapshot,
  });
}
