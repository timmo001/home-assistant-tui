import {
  Context,
  Effect,
  Layer,
  PubSub,
  Schedule,
  Schema,
  Stream,
} from "effect";
import {
  SystemInfo,
  type SystemSnapshot,
} from "./SystemInfo.js";

const log = (msg: string) =>
  console.error(`[starter-tui:Watcher] ${msg}`);

// ---------------------------------------------------------------------------
// Typed domain error (Issue #3)
// ---------------------------------------------------------------------------

/** Structured error for watcher operations */
export class WatcherError extends Schema.TaggedErrorClass<WatcherError>()(
  "WatcherError",
  { message: Schema.String },
) {}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/** State snapshot emitted by the watcher on each poll cycle */
export interface WatcherState {
  readonly snapshot: SystemSnapshot;
  readonly updatedAt: number;
}

// ---------------------------------------------------------------------------
// Service definition (Issue #2)
// ---------------------------------------------------------------------------

/** Service interface for subscribing to periodic system snapshots */
interface WatcherService {
  /** Returns a stream that emits a new {@link WatcherState} on each poll */
  readonly subscribe: () => Stream.Stream<WatcherState>;
}

/**
 * Background polling service that periodically queries {@link SystemInfo}
 * and publishes state updates via {@link PubSub}.
 *
 * Demonstrates:
 * - `Layer.effect` for effectful layer construction (Issue #2)
 * - `PubSub` + `Stream.fromPubSub` for reactive data flow
 * - `Schedule.spaced` + `Effect.repeat` for periodic work
 * - `Effect.forkScoped` for managed background fibers
 * - `Effect.catch` for graceful error recovery (Issue #5)
 */
export class Watcher extends Context.Service<Watcher, WatcherService>()(
  "Watcher",
) {
  static readonly layer = Layer.effect(
    Watcher,
    Effect.gen(function* () {
      const systemInfo = yield* SystemInfo;
      const pubsub = yield* PubSub.unbounded<WatcherState>();

      // Single poll cycle — fetch a snapshot and publish it.
      // Errors are caught so the poll loop survives transient failures (Issue #5).
      const poll = Effect.gen(function* () {
        const snapshot = yield* systemInfo.getSnapshot();
        const state: WatcherState = { snapshot, updatedAt: Date.now() };
        yield* PubSub.publish(pubsub, state);
      }).pipe(
        Effect.catch(() => {
          log("Poll failed, will retry next cycle");
          return Effect.void;
        }),
      );

      // Run the first poll immediately, then repeat every 5 seconds.
      // The fiber is tied to the program scope via Effect.forkScoped.
      yield* poll.pipe(
        Effect.repeat(Schedule.spaced("5 seconds")),
        Effect.forkScoped,
      );

      log("Background polling started");

      return Watcher.of({
        subscribe: () => Stream.fromPubSub(pubsub),
      });
    }),
  );
}
