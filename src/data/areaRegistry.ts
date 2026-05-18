import type { Connection } from "home-assistant-js-websocket";

/**
 * An entry from the Home Assistant area registry.
 *
 * Fetched via `config/area_registry/list` WebSocket command.
 */
export interface AreaRegistryEntry {
  readonly area_id: string;
  readonly name: string;
  readonly floor_id: string | null;
  readonly icon: string | null;
}

/**
 * Fetch the full area registry from Home Assistant.
 */
export async function fetchAreaRegistry(
  conn: Connection,
): Promise<AreaRegistryEntry[]> {
  return conn.sendMessagePromise<AreaRegistryEntry[]>({
    type: "config/area_registry/list",
  });
}
