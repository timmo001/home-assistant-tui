import type { Connection } from "home-assistant-js-websocket";

/**
 * An entry from the Home Assistant entity registry.
 *
 * Fetched via `config/entity_registry/list` WebSocket command.
 * Provides metadata beyond what `subscribeEntities` offers (platform,
 * area, disabled state, entity category, etc.)
 */
export interface EntityRegistryEntry {
  readonly entity_id: string;
  readonly name: string | null;
  readonly icon: string | null;
  readonly platform: string;
  readonly area_id: string | null;
  readonly device_id: string | null;
  readonly disabled_by: string | null;
  readonly hidden_by: string | null;
  readonly entity_category: string | null;
  readonly has_entity_name: boolean;
  readonly original_name: string | null;
}

/**
 * Fetch the full entity registry from Home Assistant.
 *
 * Uses the `config/entity_registry/list` WebSocket command,
 * matching the frontend's `fetchEntityRegistry` implementation.
 */
export async function fetchEntityRegistry(
  conn: Connection,
): Promise<EntityRegistryEntry[]> {
  return conn.sendMessagePromise<EntityRegistryEntry[]>({
    type: "config/entity_registry/list",
  });
}

/**
 * Subscribe to entity registry update events.
 *
 * When the registry changes (entities added/removed/modified),
 * the callback fires. Re-fetch the full registry to get updated data.
 */
export function subscribeEntityRegistryUpdates(
  conn: Connection,
  onChange: () => void,
): () => void {
  let unsub: (() => void) | undefined;

  conn.subscribeEvents(onChange, "entity_registry_updated").then((unsubFn) => {
    unsub = unsubFn;
  });

  return () => {
    unsub?.();
  };
}
