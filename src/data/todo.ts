import { callService } from "home-assistant-js-websocket";
import type { Connection, HassEntity } from "home-assistant-js-websocket";

export interface TodoList {
  readonly entity_id: string;
  readonly name: string;
}

export const enum TodoItemStatus {
  NeedsAction = "needs_action",
  Completed = "completed",
}

export interface TodoItem {
  readonly uid: string;
  readonly summary: string;
  readonly status: TodoItemStatus | null;
  readonly description?: string | null;
  readonly due?: string | null;
  readonly completed?: string | null;
}

export const enum TodoListEntityFeature {
  CREATE_TODO_ITEM = 1,
  DELETE_TODO_ITEM = 2,
  UPDATE_TODO_ITEM = 4,
  MOVE_TODO_ITEM = 8,
  SET_DUE_DATE_ON_ITEM = 16,
  SET_DUE_DATETIME_ON_ITEM = 32,
  SET_DESCRIPTION_ON_ITEM = 64,
}

interface TodoItems {
  readonly items: TodoItem[];
}

type TodoItemsUnsubscribe = () => Promise<void>;

export const computeStateName = (stateObj: HassEntity): string => {
  const friendlyName = stateObj.attributes.friendly_name;
  if (friendlyName !== undefined) {
    return String(friendlyName ?? "");
  }
  return (
    stateObj.entity_id.split(".")[1]?.replace(/_/g, " ") ?? stateObj.entity_id
  );
};

export const getTodoLists = (states: Record<string, HassEntity>): TodoList[] =>
  Object.values(states)
    .filter(
      (stateObj) =>
        stateObj.entity_id.split(".")[0] === "todo" &&
        stateObj.state !== "unavailable",
    )
    .map((stateObj) => ({
      entity_id: stateObj.entity_id,
      name: computeStateName(stateObj),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

export const fetchItems = async (
  conn: Connection,
  entityId: string,
): Promise<TodoItem[]> => {
  const result = await conn.sendMessagePromise<TodoItems>({
    type: "todo/item/list",
    entity_id: entityId,
  });
  return result.items;
};

export const subscribeItems = (
  conn: Connection,
  entityId: string,
  callback: (update: TodoItems) => void,
): Promise<TodoItemsUnsubscribe> =>
  conn.subscribeMessage<TodoItems>(callback, {
    type: "todo/item/subscribe",
    entity_id: entityId,
  });

export const createItem = (
  conn: Connection,
  entityId: string,
  item: Pick<TodoItem, "summary" | "description">,
): Promise<unknown> =>
  callService(
    conn,
    "todo",
    "add_item",
    {
      item: item.summary,
      description: item.description || undefined,
    },
    { entity_id: entityId },
  );

export const updateItem = (
  conn: Connection,
  entityId: string,
  item: Pick<TodoItem, "uid" | "summary"> & Partial<TodoItem>,
): Promise<unknown> =>
  callService(
    conn,
    "todo",
    "update_item",
    {
      item: item.uid,
      rename: item.summary,
      status: item.status,
      description: item.description,
    },
    { entity_id: entityId },
  );

export const deleteItems = (
  conn: Connection,
  entityId: string,
  uids: readonly string[],
): Promise<unknown> =>
  callService(
    conn,
    "todo",
    "remove_item",
    {
      item: [...uids],
    },
    { entity_id: entityId },
  );

export function supportsFeature(
  entity: HassEntity | undefined,
  feature: number,
): boolean {
  const supported = entity?.attributes.supported_features;
  return typeof supported === "number" && (supported & feature) !== 0;
}
