import { Context } from "effect";
import type { Locale } from "./types.js";
import { en } from "./en.js";

/**
 * Active locale reference — yields the English locale by default.
 *
 * This is a `Context.Reference` rather than a `Context.Service` because the
 * English locale is always a valid default; no explicit layer provision is
 * needed for the standard case. Override by providing a different layer:
 *
 *   Effect.provide(program, Layer.succeed(Strings, myLocale))
 */
export const Strings = Context.Reference<Locale>("ha-tui/Strings", {
  defaultValue: () => en,
});

export type { Locale } from "./types.js";
export { en } from "./en.js";
