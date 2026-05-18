/**
 * Minimal copy of HA frontend usage prediction helper.
 * Source: frontend/src/data/usage_prediction.ts
 */
import type { Connection } from "home-assistant-js-websocket";

/** Result from the usage_prediction/common_control WS command. */
export interface CommonControlsResult {
  entities: string[];
}

/**
 * Fetch the server-side usage-predicted common controls.
 * Mirrors getCommonControlsUsagePrediction from the HA frontend.
 * May throw if the usage_prediction integration is unavailable.
 */
export const getCommonControlsUsagePrediction = (
  conn: Connection,
): Promise<CommonControlsResult> =>
  conn.sendMessagePromise<CommonControlsResult>({
    type: "usage_prediction/common_control",
  });
