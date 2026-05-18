import type { MenuItem, MenuVariant, NotifyConfig, ViewId } from "./types.js";
import { en } from "./i18n/en.js";

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

function submenu(menuId: string): MenuItem["action"] {
  return { type: "submenu", menuId };
}

function noop(): MenuItem["action"] {
  return { type: "noop" };
}

// --- Main menu ---

const mainItems: readonly MenuItem[] = [
  item(
    "dashboard",
    "󰋜",
    en.menu.dashboard.title,
    en.menu.dashboard.description,
    noop(),
    undefined,
    ["home", "overview", "main", ":dash", ":home"],
  ),

  item(
    "settings",
    "󰒓",
    en.menu.settings.title,
    en.menu.settings.description,
    submenu("settings"),
    undefined,
    ["config", "preferences", "options", ":set", "prefs", "cfg", "connection"],
  ),

  item("quit", "󰩈", en.menu.quit.title, en.menu.quit.description, { type: "quit" }, undefined, [
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
    "settings.connection",
    "󰌿",
    en.menu.connection.title,
    en.menu.connection.description,
    { type: "view", viewId: "setup" },
    undefined,
    ["url", "token", "auth", "host", ":conn", "ha", "server"],
  ),
];

// --- Registries ---

/** Top-level main menu items */
export const mainMenuItems: readonly MenuItem[] = mainItems;

/** Map of submenu ID → items */
export const submenus: Map<string, readonly MenuItem[]> = new Map([
  ["settings", settingsItems],
]);

/** Display titles for submenu breadcrumbs */
export const submenuTitles: Map<string, string> = new Map([
  ["settings", en.menu.settingsTitle],
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
