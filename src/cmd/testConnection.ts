/**
 * `test-connection` — diagnostic subcommand.
 *
 * Loads config, attempts a WebSocket connection to Home Assistant,
 * and prints step-by-step results. No TUI is opened.
 */
import {
  createLongLivedTokenAuth,
  createConnection,
  createSocket,
  getConfig,
  getUser,
  ERR_CANNOT_CONNECT,
  ERR_INVALID_AUTH,
  ERR_CONNECTION_LOST,
} from "home-assistant-js-websocket";
import { Effect, Schema } from "effect";
import { loadConfig, isConfigured, CONFIG_PATH } from "../config.js";

function ok(msg: string): void {
  process.stdout.write(`  ✓  ${msg}\n`);
}

function fail(msg: string): void {
  process.stdout.write(`  ✗  ${msg}\n`);
}

function info(msg: string): void {
  process.stdout.write(`     ${msg}\n`);
}

function header(msg: string): void {
  process.stdout.write(`\n${msg}\n${"─".repeat(msg.length)}\n`);
}

function maskToken(token: string): string {
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

function describeError(err: unknown): string {
  if (err === ERR_CANNOT_CONNECT)
    return `ERR_CANNOT_CONNECT — could not reach the server`;
  if (err === ERR_INVALID_AUTH) return `ERR_INVALID_AUTH — token rejected`;
  if (err === ERR_CONNECTION_LOST)
    return `ERR_CONNECTION_LOST — connection dropped`;
  return String(err);
}

class ConnectionTestError extends Schema.TaggedErrorClass<ConnectionTestError>()(
  "ConnectionTestError",
  { cause: Schema.Defect() },
) {}

export const runTestConnection: Effect.Effect<void> = Effect.gen(function* () {
  header("Home Assistant TUI — connection test");

  // ── Config ────────────────────────────────────────────────────────────────
  header("1. Config");
  info(`Path: ${CONFIG_PATH}`);

  const configured = yield* isConfigured;
  if (!configured) {
    fail("No config found or token is empty — run the TUI first-run setup");
    process.exit(1);
  }

  const config = yield* loadConfig;
  const { url, token } = config.homeassistant;

  ok(`URL:   ${url}`);
  ok(`Token: ${maskToken(token)}`);

  // ── WebSocket connection ──────────────────────────────────────────────────
  header("2. WebSocket connection");

  const auth = createLongLivedTokenAuth(url, token);
  info(`Connecting to ${url} …`);

  const t0 = Date.now();

  const conn = yield* Effect.tryPromise({
    try: () => createConnection({ auth, createSocket }),
    catch: (cause) => new ConnectionTestError({ cause }),
  }).pipe(
    Effect.matchEffect({
      onFailure: (err) =>
        Effect.sync(() => {
          fail(`Connection failed: ${describeError(err.cause)}`);
          process.exit(1);
        }),
      onSuccess: (c) => Effect.succeed(c),
    }),
  );

  ok(
    `Connected in ${Date.now() - t0} ms   (HA version on socket: ${conn.haVersion ?? "unknown"})`,
  );

  // ── HA config + user ──────────────────────────────────────────────────────
  header("3. HA config and user");

  const [haConfigResult, haUserResult] = yield* Effect.promise(() =>
    Promise.allSettled([getConfig(conn), getUser(conn)]),
  );

  if (haConfigResult.status === "fulfilled") {
    const c = haConfigResult.value;
    ok(`HA version:   ${c.version}`);
    ok(`Location:     ${c.location_name}`);
    ok(`State:        ${c.state}`);
  } else {
    fail(`getConfig failed: ${String(haConfigResult.reason)}`);
  }

  if (haUserResult.status === "fulfilled") {
    const u = haUserResult.value;
    ok(`Logged in as: ${u.name} (is_admin=${u.is_admin})`);
  } else {
    fail(`getUser failed: ${String(haUserResult.reason)}`);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  conn.close();

  header("Result");
  ok("Connection successful — Home Assistant is reachable");
  process.stdout.write("\n");
});
