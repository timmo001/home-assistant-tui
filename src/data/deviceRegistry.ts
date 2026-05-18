import type { Connection } from "home-assistant-js-websocket";

/**
 * An entry from the Home Assistant device registry.
 *
 * Fetched via `config/device_registry/list` WebSocket command.
 */
export interface DeviceRegistryEntry {
  readonly id: string;
  readonly name: string | null;
  readonly name_by_user: string | null;
  readonly manufacturer: string | null;
  readonly model: string | null;
  readonly area_id: string | null;
  readonly disabled_by: string | null;
}

/**
 * Fetch the full device registry from Home Assistant.
 */
export async function fetchDeviceRegistry(
  conn: Connection,
): Promise<DeviceRegistryEntry[]> {
  return conn.sendMessagePromise<DeviceRegistryEntry[]>({
    type: "config/device_registry/list",
  });
}

/** Compute the display name for a device (user override takes priority). */
export function computeDeviceName(device: DeviceRegistryEntry): string {
  return (device.name_by_user || device.name || "").trim();
}
