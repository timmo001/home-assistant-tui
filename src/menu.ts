import type { MenuItem, MenuVariant, NotifyConfig, ViewId } from "./types.js";

// --- Helpers ---

function item(
  id: string,
  icon: string,
  title: string,
  description: string,
  action: MenuItem["action"],
  variants?: readonly MenuVariant[],
  keywords?: readonly string[],
): MenuItem {
  return {
    id,
    icon,
    title,
    description,
    action,
    ...(variants && { variants }),
    ...(keywords && { keywords }),
  };
}

function cmd(command: string, wait = true): MenuItem["action"] {
  return { type: "command", cmd: command, wait };
}

function silent(command: string): MenuItem["action"] {
  return { type: "silent", cmd: command };
}

function notify(command: string, config: NotifyConfig): MenuItem["action"] {
  return { type: "notify", cmd: command, notify: config };
}

function view(viewId: ViewId): MenuItem["action"] {
  return { type: "view", viewId };
}

function submenu(menuId: string): MenuItem["action"] {
  return { type: "submenu", menuId };
}

// --- Main menu ---

const mainItems: readonly MenuItem[] = [
  item(
    "greet",
    "󰱫",
    "Greet",
    "Say hello in different ways",
    cmd("echo '👋 Hello!' && sleep 1"),
    [
      {
        label: "Hello",
        description: "Classic English greeting",
        action: cmd("echo '👋 Hello!' && sleep 1"),
      },
      {
        label: "Howdy",
        description: "Southern charm",
        action: cmd("echo '🤠 Howdy partner!' && sleep 1"),
      },
      {
        label: "G'day",
        description: "Australian style",
        action: cmd("echo '🦘 G'\\''day mate!' && sleep 1"),
      },
    ],
    ["hello", "hi", "welcome", ":hi", "hey", "wave"],
  ),

  item(
    "system-info",
    "󰒋",
    "System Info",
    "Display system information",
    cmd("uname -a"),
    undefined,
    ["uname", "os", "kernel", "sys", "sysinfo", ":si"],
  ),

  item(
    "processes",
    "󱡠",
    "Top Processes",
    "Show the top 10 processes by CPU",
    cmd("ps aux --sort=-%cpu | head -11"),
    [
      {
        label: "By CPU",
        description: "Sort by CPU usage",
        action: cmd("ps aux --sort=-%cpu | head -11"),
      },
      {
        label: "By Memory",
        description: "Sort by memory usage",
        action: cmd("ps aux --sort=-%mem | head -11"),
      },
    ],
    ["ps", "cpu", "memory", "top", "htop", "proc", ":ps", ":top"],
  ),

  item(
    "settings",
    "",
    "Settings",
    "Configuration and preferences",
    submenu("settings"),
    undefined,
    ["config", "preferences", "options", ":set", "prefs", "opts", "cfg"],
  ),

  item(
    "notify-example",
    "󰍡",
    "Notify Example",
    "Demonstrate toast notifications",
    notify("sleep 2", {
      id: "example",
      progress: "Working on it...",
      success: "All done!",
    }),
    undefined,
    ["toast", "notification", "notify", ":notify", "alert"],
  ),

  item("quit", "󰩈", "Quit", "Exit the application", { type: "quit" }, undefined, [
    ":q",
    ":wq",
    ":qa",
    "exit",
    "quit",
    "close",
    "bye",
  ]),
];

// --- Settings submenu ---

const settingsItems: readonly MenuItem[] = [
  item(
    "settings.display",
    "󰍹",
    "Display",
    "Terminal display settings",
    submenu("settings.display"),
    undefined,
    ["screen", "terminal", "monitor", "disp", ":disp", "term"],
  ),

  item(
    "settings.editor",
    "",
    "Editor",
    "Show configured editor or shell",
    cmd('echo "Editor: ${EDITOR:-not set}"'),
    [
      {
        label: "Show Editor",
        description: "Print the configured $EDITOR",
        action: cmd('echo "Editor: ${EDITOR:-not set}"'),
      },
      {
        label: "Show Shell",
        description: "Print the current $SHELL",
        action: cmd('echo "Shell: $SHELL"'),
      },
      {
        label: "Show Both",
        description: "Print editor and shell",
        action: cmd('echo "Editor: ${EDITOR:-not set}" && echo "Shell: $SHELL"'),
      },
    ],
    ["vim", "nvim", "shell", "bash", "zsh", ":e", "ed", "$EDITOR"],
  ),

  item(
    "settings.env",
    "󰒓",
    "Environment",
    "Show key environment variables",
    cmd('echo "HOME=$HOME" && echo "USER=$USER" && echo "TERM=$TERM"'),
    undefined,
    ["env", "variables", "path", "vars", ":env", "$HOME", "$USER"],
  ),

  item(
    "settings.reset",
    "󰑙",
    "Reset Demo",
    "Simulated reset with notification",
    notify("sleep 1", {
      id: "reset",
      progress: "Resetting...",
      success: "Settings reset to defaults",
    }),
    undefined,
    ["reset", ":reset", "defaults", "restore"],
  ),
];

// --- Settings > Display submenu ---

const displayItems: readonly MenuItem[] = [
  item(
    "settings.display.colors",
    "󰏘",
    "Colors",
    "Show terminal colour support",
    cmd("tput colors && echo 'colours supported'"),
    undefined,
    ["colour", "palette", "colors", ":colors", "rgb"],
  ),

  item(
    "settings.display.size",
    "󰩨",
    "Terminal Size",
    "Print current terminal dimensions",
    cmd('echo "${COLUMNS:-?}x${LINES:-?}"'),
    undefined,
    ["columns", "rows", "dimensions", "cols", "size", ":size", "resize"],
  ),

  item(
    "settings.display.test",
    "󰸞",
    "Test Pattern",
    "Print a colour test pattern",
    cmd(
      "for i in $(seq 0 7); do printf '\\e[48;5;%dm  \\e[0m' $i; done && echo && for i in $(seq 8 15); do printf '\\e[48;5;%dm  \\e[0m' $i; done && echo",
    ),
    [
      {
        label: "16 Colors",
        description: "Basic terminal palette",
        action: cmd(
          "for i in $(seq 0 7); do printf '\\e[48;5;%dm  \\e[0m' $i; done && echo && for i in $(seq 8 15); do printf '\\e[48;5;%dm  \\e[0m' $i; done && echo",
        ),
      },
      {
        label: "256 Colors",
        description: "Extended colour range",
        action: cmd(
          "for i in $(seq 0 255); do printf '\\e[48;5;%dm  \\e[0m' $i; [ $(( (i+1) % 16 )) -eq 0 ] && echo; done",
        ),
      },
    ],
    ["colour", "ansi", "palette", "test", ":test", "256", "swatches"],
  ),
];

// --- Registries ---

/** Top-level main menu items */
export const mainMenuItems: readonly MenuItem[] = mainItems;

/** Map of submenu ID → items */
export const submenus: Map<string, readonly MenuItem[]> = new Map([
  ["settings", settingsItems],
  ["settings.display", displayItems],
]);

/** Display titles for submenu breadcrumbs */
export const submenuTitles: Map<string, string> = new Map([
  ["settings", "Settings"],
  ["settings.display", "Display"],
]);

/** Flat map of every menu item by its ID (main items + all submenu items) */
export const menuItemsById: Map<string, MenuItem> = new Map();

function registerItems(items: readonly MenuItem[]): void {
  for (const m of items) {
    menuItemsById.set(m.id, m);
  }
}

registerItems(mainItems);
registerItems(settingsItems);
registerItems(displayItems);
