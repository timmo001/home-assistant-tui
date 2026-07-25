import {
  createConnection,
  createLongLivedTokenAuth,
  createSocket,
} from "home-assistant-js-websocket";
import type { Connection } from "home-assistant-js-websocket";
import { Effect, Schema } from "effect";
import { CONFIG_PATH, isConfigured, loadConfig } from "../config.js";
import { fetchItems, TodoItemStatus, type TodoItem } from "../data/todo.js";

interface TodoCommandOptions {
  readonly entityId: string;
  readonly barJson: boolean;
  readonly count: boolean;
  readonly includeCompleted: boolean;
}

interface BarJson {
  readonly text: string;
  readonly tooltip: string;
  readonly class: string;
}

class TodoCommandError extends Schema.TaggedErrorClass<TodoCommandError>()(
  "TodoCommandError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

const todoOutputFlags = new Set(["--bar-json", "--count", "--all"]);

/** Return whether todo args request non-interactive machine output. */
export function hasTodoOutputFlag(args: readonly string[]): boolean {
  return args.includes("--bar-json") || args.includes("--count");
}

/** Run a non-interactive todo output command. */
export const runTodoCommand = (
  args: readonly string[],
): Effect.Effect<void, TodoCommandError> =>
  Effect.gen(function* () {
    const options = yield* Effect.try({
      try: () => parseTodoCommandOptions(args),
      catch: (cause) =>
        new TodoCommandError({ message: formatError(cause), cause }),
    });

    const result = yield* loadTodoItems(options.entityId).pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          options.barJson
            ? Effect.sync(() => writeBarJson(formatBarError(options, error)))
            : Effect.fail(error),
        onSuccess: (items) =>
          Effect.sync(() => {
            if (options.barJson) {
              writeBarJson(formatTodoBarJson(options, items));
            } else if (options.count) {
              process.stdout.write(`${countItems(options, items)}\n`);
            }
          }),
      }),
    );

    return result;
  });

function parseTodoCommandOptions(args: readonly string[]): TodoCommandOptions {
  const unknownFlag = args.find(
    (arg) => arg.startsWith("-") && !todoOutputFlags.has(arg),
  );
  if (unknownFlag) {
    throw new Error(`home-assistant-tui todo: unknown option ${unknownFlag}`);
  }

  const entityIds = args.filter((arg) => !arg.startsWith("-"));
  if (entityIds.length === 0) {
    throw new Error(
      "home-assistant-tui todo requires a todo entity ID, for example: todo.my_tasks",
    );
  }
  if (entityIds.length > 1) {
    throw new Error(
      `home-assistant-tui todo accepts one todo entity ID, got: ${entityIds.join(", ")}`,
    );
  }

  return {
    entityId: entityIds[0],
    barJson: args.includes("--bar-json"),
    count: args.includes("--count"),
    includeCompleted: args.includes("--all"),
  };
}

function loadTodoItems(
  entityId: string,
): Effect.Effect<readonly TodoItem[], TodoCommandError> {
  return Effect.gen(function* () {
    const configured = yield* isConfigured;
    if (!configured) {
      return yield* new TodoCommandError({
        message: `No config found or token is empty at ${CONFIG_PATH}`,
      });
    }

    const config = yield* loadConfig;
    const { url, token } = config.homeassistant;

    return yield* Effect.tryPromise({
      try: async () => {
        const auth = createLongLivedTokenAuth(url, token);
        const conn = await createConnection({ auth, createSocket });
        try {
          return await fetchItems(conn, entityId);
        } finally {
          closeConnection(conn);
        }
      },
      catch: (cause) =>
        new TodoCommandError({ message: formatError(cause), cause }),
    });
  });
}

function closeConnection(conn: Connection): void {
  conn.close();
}

function countItems(
  options: Pick<TodoCommandOptions, "includeCompleted">,
  items: readonly TodoItem[],
): number {
  return visibleItems(options, items).length;
}

function visibleItems(
  options: Pick<TodoCommandOptions, "includeCompleted">,
  items: readonly TodoItem[],
): readonly TodoItem[] {
  return options.includeCompleted
    ? items
    : items.filter((item) => item.status !== TodoItemStatus.Completed);
}

function formatTodoBarJson(
  options: TodoCommandOptions,
  items: readonly TodoItem[],
): BarJson {
  const visible = visibleItems(options, items);
  const count = visible.length;
  const noun = options.includeCompleted ? "total" : "active";
  const label = formatEntityLabel(options.entityId);
  const lines = [
    `${label}: ${count.toLocaleString()} ${noun} item${plural(count)}.`,
  ];

  for (const item of visible.slice(0, 8)) {
    const due = item.due ? ` (${item.due})` : "";
    lines.push(`- ${item.summary}${due}`);
  }
  if (visible.length > 8) {
    lines.push(`+${visible.length - 8} more`);
  }

  return {
    text: count > 0 ? `󰄬 ${count.toLocaleString()}` : "",
    tooltip: lines.join("\n"),
    class: count > 0 ? "todo-active" : "hidden",
  };
}

function formatBarError(options: TodoCommandOptions, error: unknown): BarJson {
  return {
    text: "?",
    tooltip: `${formatEntityLabel(options.entityId)}: ${formatError(error)}`,
    class: "critical",
  };
}

function writeBarJson(value: BarJson): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function formatEntityLabel(entityId: string): string {
  return (entityId.split(".")[1] ?? entityId).replaceAll("_", " ");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}
