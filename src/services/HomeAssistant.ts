import {
  createLongLivedTokenAuth,
  createConnection,
  createSocket,
  getConfig,
  getUser,
  ERR_CANNOT_CONNECT,
  ERR_INVALID_AUTH,
  ERR_CONNECTION_LOST,
} from "home-assistant-js-websocket";
import type { Connection } from "home-assistant-js-websocket";
import type { HaTuiConfig } from "../config.js";
import type { ConnectionInfo, ConnectionStatus } from "../types.js";

const log = (msg: string) => console.error(`[ha-tui:HomeAssistant] ${msg}`);

export type ConnectionListener = (info: ConnectionInfo) => void;

/**
 * Manages the Home Assistant WebSocket connection.
 *
 * Uses `home-assistant-js-websocket` (the official HA client library) with a
 * long-lived access token. The connection library handles automatic reconnects.
 * Callers subscribe via `subscribe()` to receive `ConnectionInfo` updates.
 *
 * Types sourced from `home-assistant-js-websocket` and the HA frontend:
 *   - `HassConfig.version` — HA release string, e.g. "2025.5.1"
 *   - `HassUser.name`      — display name of the authenticated user
 *   - `Connection`         — manages the WS lifecycle and reconnection
 *   - `createLongLivedTokenAuth` — constructs an `Auth` from a LLAT
 */
export class HomeAssistantService {
  private connection: Connection | null = null;
  private listeners = new Set<ConnectionListener>();
  private currentInfo: ConnectionInfo;
  private unsubStateChanges: (() => Promise<void>) | null = null;

  constructor(private readonly config: HaTuiConfig) {
    this.currentInfo = {
      status: "disconnected",
      url: config.homeassistant.url,
    };
  }

  /**
   * Subscribe to connection state changes.
   * The callback is invoked immediately with the current state,
   * then on every subsequent change.
   *
   * @returns An unsubscribe function.
   */
  subscribe(cb: ConnectionListener): () => void {
    this.listeners.add(cb);
    cb(this.currentInfo);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Establish the WebSocket connection to Home Assistant. */
  async connect(): Promise<void> {
    this.emit({ status: "connecting", errorMessage: undefined });

    const auth = createLongLivedTokenAuth(
      this.config.homeassistant.url,
      this.config.homeassistant.token,
    );

    try {
      this.connection = await createConnection({ auth, createSocket });
    } catch (err) {
      const status = this.resolveErrorStatus(err);
      this.emit({ status, errorMessage: String(err) });
      return;
    }

    this.connection.addEventListener("ready", () => {
      void this.onReady();
    });

    this.connection.addEventListener("disconnected", () => {
      log("Disconnected from Home Assistant");
      this.emit({ status: "disconnected" });
    });

    this.connection.addEventListener("reconnect-error", (_, err) => {
      log(`Reconnect error: ${err}`);
      this.emit({ status: "error", errorMessage: "Reconnection failed" });
    });
  }

  /** Close the connection and clean up subscriptions. */
  disconnect(): void {
    if (this.unsubStateChanges) {
      void this.unsubStateChanges();
      this.unsubStateChanges = null;
    }
    this.connection?.close();
    this.connection = null;
    this.emit({ status: "disconnected" });
  }

  // ---------------------------------------------------------------------------

  private async onReady(): Promise<void> {
    log("Connection ready — fetching HA config and user");
    if (!this.connection) return;

    const haVersion = this.connection.haVersion;

    // Emit optimistic connected state immediately with the socket's version
    this.emit({ status: "connected", haVersion, errorMessage: undefined });

    // Fetch richer metadata in the background
    try {
      const [hassConfig, hassUser] = await Promise.all([
        getConfig(this.connection),
        getUser(this.connection),
      ]);
      this.emit({
        status: "connected",
        haVersion: hassConfig.version ?? haVersion,
        userName: hassUser.name,
        lastUpdateAt: new Date(),
      });
    } catch (err) {
      log(`Failed to fetch HA config/user: ${err}`);
      // Remain connected — metadata fetch is best-effort
    }

    // Track last state update time
    try {
      this.unsubStateChanges =
        await this.connection.subscribeEvents<unknown>(() => {
          this.emit({ lastUpdateAt: new Date() });
        }, "state_changed");
    } catch (err) {
      log(`Failed to subscribe to state_changed: ${err}`);
    }
  }

  private emit(partial: Partial<ConnectionInfo>): void {
    this.currentInfo = { ...this.currentInfo, ...partial };
    for (const cb of this.listeners) {
      cb(this.currentInfo);
    }
  }

  private resolveErrorStatus(err: unknown): ConnectionStatus {
    if (err === ERR_INVALID_AUTH) return "error";
    if (err === ERR_CANNOT_CONNECT) return "disconnected";
    if (err === ERR_CONNECTION_LOST) return "disconnected";
    return "error";
  }
}
