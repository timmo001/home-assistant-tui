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
import { Context, Layer, Effect } from "effect";
import type { HaTuiConfig } from "../config.js";
import type { ConnectionInfo, ConnectionStatus } from "../types.js";

const log = (msg: string) => console.error(`[ha-tui:HomeAssistant] ${msg}`);

export type ConnectionListener = (info: ConnectionInfo) => void;

export interface HomeAssistantServiceI {
  readonly connect: Effect.Effect<void>;
  readonly disconnect: Effect.Effect<void>;
  readonly subscribe: (cb: ConnectionListener) => () => void;
  readonly reconfigure: (config: HaTuiConfig) => Effect.Effect<void>;
}

function makeHomeAssistantService(
  initialConfig: HaTuiConfig,
): HomeAssistantServiceI {
  let config = initialConfig;
  let connection: Connection | null = null;
  const listeners = new Set<ConnectionListener>();
  let currentInfo: ConnectionInfo = {
    status: "disconnected",
    url: initialConfig.homeassistant.url,
  };
  let unsubStateChanges: (() => Promise<void>) | null = null;

  function emit(partial: Partial<ConnectionInfo>): void {
    currentInfo = { ...currentInfo, ...partial };
    for (const cb of listeners) cb(currentInfo);
  }

  function resolveErrorStatus(err: unknown): ConnectionStatus {
    if (err === ERR_INVALID_AUTH) return "error";
    if (err === ERR_CANNOT_CONNECT) return "disconnected";
    if (err === ERR_CONNECTION_LOST) return "disconnected";
    return "error";
  }

  async function onReady(): Promise<void> {
    log("Connection ready — fetching HA config and user");
    if (!connection) return;

    const haVersion = connection.haVersion;
    emit({ status: "connected", haVersion, errorMessage: undefined });

    try {
      const [hassConfig, hassUser] = await Promise.all([
        getConfig(connection),
        getUser(connection),
      ]);
      emit({
        status: "connected",
        haVersion: hassConfig.version ?? haVersion,
        userName: hassUser.name,
        lastUpdateAt: new Date(),
      });
    } catch (err) {
      log(`Failed to fetch HA config/user: ${err}`);
    }

    try {
      unsubStateChanges = await connection.subscribeEvents<unknown>(() => {
        emit({ lastUpdateAt: new Date() });
      }, "state_changed");
    } catch (err) {
      log(`Failed to subscribe to state_changed: ${err}`);
    }
  }

  const connect: Effect.Effect<void> = Effect.promise(async () => {
    emit({ status: "connecting", errorMessage: undefined });

    const auth = createLongLivedTokenAuth(
      config.homeassistant.url,
      config.homeassistant.token,
    );

    try {
      connection = await createConnection({ auth, createSocket });
    } catch (err) {
      const status = resolveErrorStatus(err);
      emit({ status, errorMessage: String(err) });
      return;
    }

    connection.addEventListener("ready", () => {
      void onReady();
    });

    connection.addEventListener("disconnected", () => {
      log("Disconnected from Home Assistant");
      emit({ status: "disconnected" });
    });

    connection.addEventListener("reconnect-error", (_, err) => {
      log(`Reconnect error: ${err}`);
      emit({ status: "error", errorMessage: "Reconnection failed" });
    });
  });

  const disconnect: Effect.Effect<void> = Effect.sync(() => {
    if (unsubStateChanges) {
      void unsubStateChanges();
      unsubStateChanges = null;
    }
    connection?.close();
    connection = null;
    emit({ status: "disconnected" });
  });

  return {
    connect,
    disconnect,
    subscribe: (cb) => {
      listeners.add(cb);
      cb(currentInfo);
      return () => {
        listeners.delete(cb);
      };
    },
    reconfigure: (newConfig) =>
      Effect.gen(function* () {
        config = newConfig;
        yield* disconnect;
        emit({ url: newConfig.homeassistant.url });
        yield* connect;
      }),
  };
}

export class HomeAssistantService extends Context.Service<
  HomeAssistantService,
  HomeAssistantServiceI
>()("HomeAssistantService") {
  static layer(config: HaTuiConfig): Layer.Layer<HomeAssistantService> {
    return Layer.effect(
      HomeAssistantService,
      Effect.sync(() => makeHomeAssistantService(config)),
    );
  }
}
