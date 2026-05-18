/**
 * MDI icon resolution for TUI terminal rendering.
 *
 * Converts MDI icon names (e.g. "mdi:lightbulb") to the corresponding
 * Nerd Font v3 Unicode glyph. Nerd Font v3 places every MDI icon at its
 * MDI-assigned private-use code point (U+F{hex}), so the glyph is
 * derived directly from the MDI codepoint metadata.
 *
 * Resolution order for a HassEntity:
 *   1. entity.attributes.icon  — user-customised MDI icon from HA
 *   2. DOMAIN_ICONS[domain]    — HA frontend's default MDI icon per domain
 *   3. DEFAULT_ICON            — generic file icon fallback
 *
 * Source reference:
 *   frontend/src/data/icons.ts  (FALLBACK_DOMAIN_ICONS + domainIcon())
 *   frontend/node_modules/@mdi/svg/meta.json  (name → codepoint)
 */
import type { HassEntity } from "home-assistant-js-websocket";
import { MDI_CODEPOINTS } from "./mdiCodepoints.js";

/** Generic fallback glyph shown when no MDI mapping is found. */
export const DEFAULT_ICON = MDI_CODEPOINTS["file"] ?? "󰈚";

/**
 * Convert an MDI icon name (with or without the "mdi:" prefix) to the
 * Nerd Font v3 Unicode glyph. Returns `undefined` if the name is not in
 * the codepoints table.
 */
export function mdiToNerdFont(mdiName: string): string | undefined {
  const name = mdiName.startsWith("mdi:") ? mdiName.slice(4) : mdiName;
  return MDI_CODEPOINTS[name];
}

/**
 * HA frontend's canonical domain→MDI icon mapping.
 *
 * Primary source: entity_component default icons from each domain's
 * icons.json in the HA core. Where the backend has no entry, the
 * FALLBACK_DOMAIN_ICONS from frontend/src/data/icons.ts is used.
 *
 * Reference: frontend/src/data/icons.ts — FALLBACK_DOMAIN_ICONS
 */
const DOMAIN_MDI: Record<string, string> = {
  light: "lightbulb",
  switch: "toggle-switch-variant",
  sensor: "eye",
  binary_sensor: "radiobox-blank",
  climate: "thermostat",
  media_player: "cast",
  person: "account",
  device_tracker: "account",
  automation: "robot",
  script: "script-text",
  scene: "palette",
  input_boolean: "check-circle-outline",
  cover: "window-open",
  lock: "lock",
  fan: "fan",
  vacuum: "robot-vacuum",
  weather: "weather-partly-cloudy",
  button: "button-pointer",
  update: "package-up",
  number: "ray-vertex",
  select: "format-list-bulleted",
  input_number: "ray-vertex",
  input_select: "format-list-bulleted",
  input_text: "form-textbox",
  timer: "timer-outline",
  counter: "counter",
  calendar: "calendar",
  camera: "video",
};

/** Pre-resolved domain → Nerd Font glyph map. */
export const DOMAIN_ICONS: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries(DOMAIN_MDI).flatMap(([domain, mdi]) => {
      const glyph = MDI_CODEPOINTS[mdi];
      return glyph !== undefined ? [[domain, glyph]] : [];
    }),
  );

/**
 * Resolve the best available Nerd Font icon glyph for a HassEntity.
 *
 * Priority:
 *   1. entity.attributes.icon (user-customised, e.g. "mdi:lightbulb")
 *   2. Domain default from DOMAIN_ICONS
 *   3. DEFAULT_ICON fallback
 */
export function resolveEntityIcon(entity: HassEntity): string {
  const attrIcon = entity.attributes["icon"] as string | undefined;
  if (typeof attrIcon === "string" && attrIcon.length > 0) {
    const glyph = mdiToNerdFont(attrIcon);
    if (glyph !== undefined) return glyph;
  }

  const domain = entity.entity_id.split(".")[0] ?? "";
  return DOMAIN_ICONS[domain] ?? DEFAULT_ICON;
}
