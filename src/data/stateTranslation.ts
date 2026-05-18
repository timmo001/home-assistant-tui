/**
 * Entity state translation for the TUI dashboard.
 *
 * Mirrors the priority chain in the HA frontend's `computeStateDisplay`:
 *   1. "unknown" / "unavailable" → state.default.{state}
 *   2. Numeric entities with a unit_of_measurement → "{state} {unit}"
 *   3. device_class-specific → component.{domain}.entity_component.{dc}.state.{state}
 *   4. Generic domain → component.{domain}.entity_component._.state.{state}
 *   5. Raw state fallback
 *
 * Translation strings are fetched from the HA WebSocket API
 * (`frontend/get_translations`) and cached as a flat key→value dict.
 *
 * Source reference:
 *   frontend/src/common/entity/compute_state_display.ts
 *   frontend/src/data/translation.ts
 */
import type { Connection, HassEntity } from "home-assistant-js-websocket";

/** A simple key→value lookup over flat HA translation resources. */
export type LocalizeFunc = (key: string) => string;

type FlatTranslations = Record<string, string>;

/**
 * Fetch entity-state translations from the HA WebSocket and return a
 * `LocalizeFunc` that maps dot-notation keys to translated strings.
 *
 * Two categories are fetched in parallel:
 *   - "state"           → state.default.unknown / unavailable
 *   - "entity_component" → component.{domain}.entity_component.*.state.*
 *
 * If a category fetch fails the other is still used; if both fail the
 * returned function falls back to returning the bare key.
 */
export const fetchStateTranslations = async (
  conn: Connection,
  language = "en",
): Promise<LocalizeFunc> => {
  const [stateResult, entityResult] = await Promise.allSettled([
    conn.sendMessagePromise<{ resources: FlatTranslations }>({
      type: "frontend/get_translations",
      language,
      category: "state",
    }),
    conn.sendMessagePromise<{ resources: FlatTranslations }>({
      type: "frontend/get_translations",
      language,
      category: "entity_component",
    }),
  ]);

  const merged: FlatTranslations = {};
  if (stateResult.status === "fulfilled") {
    Object.assign(merged, stateResult.value.resources);
  }
  if (entityResult.status === "fulfilled") {
    Object.assign(merged, entityResult.value.resources);
  }

  return (key: string): string => merged[key] ?? key;
};

/**
 * Return the human-readable display state for a `HassEntity`.
 *
 * Follows the same resolution order as `computeStateDisplay` in the HA
 * frontend, omitting datetime / duration / monetary formatting which are
 * not relevant for a text-only terminal display.
 */
export const translateEntityState = (
  entity: HassEntity,
  localize: LocalizeFunc,
): string => {
  const { state, attributes, entity_id } = entity;
  const domain = entity_id.split(".")[0] ?? "";

  // Step 1: canonical sentinel states
  if (state === "unknown" || state === "unavailable") {
    const translated = localize(`state.default.${state}`);
    // localize returns the key itself when not found — guard against that
    return translated === `state.default.${state}` ? state : translated;
  }

  // Step 2: numeric entities — keep raw value and append unit
  const unit = attributes.unit_of_measurement as string | undefined;
  if (unit != null) {
    return `${state} ${unit}`;
  }

  // Step 3: device-class-specific translation
  const deviceClass = attributes.device_class as string | undefined;
  if (deviceClass) {
    const key = `component.${domain}.entity_component.${deviceClass}.state.${state}`;
    const translated = localize(key);
    if (translated !== key) return translated;
  }

  // Step 4: generic domain translation (device_class = "_")
  const genericKey = `component.${domain}.entity_component._.state.${state}`;
  const translated = localize(genericKey);
  if (translated !== genericKey) return translated;

  // Step 5: raw state as fallback
  return state;
};
