/**
 * Minimal copy of HA frontend home-panel system data types and helpers.
 * Source: frontend/src/data/frontend.ts + frontend/src/panels/home/ha-panel-home.ts
 */
import type { Connection } from "home-assistant-js-websocket";

/** Stored home-panel configuration keyed under "home" in frontend system data. */
export interface HomeFrontendSystemData {
  favorite_entities?: string[];
  welcome_banner_dismissed?: boolean;
  hide_welcome_message?: boolean;
  hide_suggested_entities?: boolean;
}

/**
 * Fetch the home-panel frontend system data for the current installation.
 * Mirrors fetchFrontendSystemData(conn, "home") from the HA frontend.
 */
export const fetchFrontendHomeData = (
  conn: Connection,
): Promise<HomeFrontendSystemData | null> =>
  conn
    .sendMessagePromise<{ value: HomeFrontendSystemData | null }>({
      type: "frontend/get_system_data",
      key: "home",
    })
    .then((r) => r.value);
