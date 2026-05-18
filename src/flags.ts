import { menuItemsById, submenus } from "./menu.js";

/** Parsed CLI flags */
export interface Flags {
  /** Resolved subcommand (dot-separated path) matching a menu item ID or submenu */
  readonly subcommand: string | undefined;
  /** Show help and exit */
  readonly help: boolean;
  /** Remaining args not consumed by subcommand or flag parsing */
  readonly rest: readonly string[];
}

/** Check whether a candidate string matches any known menu item or submenu */
function isKnownTarget(candidate: string): boolean {
  if (menuItemsById.has(candidate) || submenus.has(candidate)) return true;
  return false;
}

/**
 * Parse CLI args into structured flags with greedy subcommand resolution.
 *
 * Positional args are joined with `.` using greedy longest-match against
 * the menu registry. For example, `["settings", "display", "colors"]` resolves
 * to subcommand `"settings.display.colors"` if that ID exists in the registry.
 */
export function parseFlags(args: readonly string[]): Flags {
  let subcommand: string | undefined;
  let help = false;
  const rest: string[] = [];

  let i = 0;

  // Collect all leading positional args (before any flags)
  const positionals: string[] = [];
  while (i < args.length && !args[i].startsWith("-")) {
    positionals.push(args[i]);
    i++;
  }

  // Greedy longest-match resolution for subcommand path
  if (positionals.length > 0) {
    let consumed = 0;
    // Try longest candidate first, shrink until a match is found
    for (let len = positionals.length; len >= 1; len--) {
      const candidate = positionals.slice(0, len).join(".");
      if (isKnownTarget(candidate)) {
        subcommand = candidate;
        consumed = len;
        break;
      }
    }
    if (consumed === 0) {
      // No match — use first positional (will fail in resolveSubcommand)
      subcommand = positionals[0];
      consumed = 1;
    }
    // Push unconsumed positionals to rest
    for (let j = consumed; j < positionals.length; j++) {
      rest.push(positionals[j]);
    }
  }

  // Parse remaining flags
  for (; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else {
      rest.push(arg);
    }
  }

  return { subcommand, help, rest };
}

/** Resolve a subcommand string to a menu item target */
export function resolveSubcommand(
  sub: string,
): { type: "item"; itemId: string } | undefined {
  if (menuItemsById.has(sub)) return { type: "item", itemId: sub };
  if (submenus.has(sub)) return { type: "item", itemId: sub };
  return undefined;
}

/** Print help text */
export function printHelp(): void {
  console.log(`Usage: home-assistant-tui [subcommand...] [options]

Launch the Home Assistant TUI. Without a subcommand, opens the main menu.

Subcommands can be specified as space-separated paths that resolve
against the menu registry:

  home-assistant-tui settings             Open the settings submenu
  home-assistant-tui settings connection  Open connection settings
  home-assistant-tui dashboard            Open the dashboard

Options:
  --help, -h  Show this help message

Examples:
  home-assistant-tui                      Main menu
  home-assistant-tui settings             Settings submenu`);
}
