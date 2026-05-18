import type { Connection } from "home-assistant-js-websocket";

/**
 * An entry from the Home Assistant floor registry.
 *
 * Fetched via `config/floor_registry/list` WebSocket command.
 */
export interface FloorRegistryEntry {
  readonly floor_id: string;
  readonly name: string;
  /** Numeric level for ordering (e.g. 0 = ground, 1 = first floor) */
  readonly level: number | null;
  readonly icon: string | null;
}

/**
 * Fetch the full floor registry from Home Assistant.
 */
export async function fetchFloorRegistry(
  conn: Connection,
): Promise<FloorRegistryEntry[]> {
  return conn.sendMessagePromise<FloorRegistryEntry[]>({
    type: "config/floor_registry/list",
  });
}
