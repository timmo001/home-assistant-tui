import type { MenuItem, MenuVariant, NotifyConfig, ViewId } from "./types.js";
import type { Locale } from "./i18n/index.js";

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

/** Built menu registries returned by {@link buildMenu} */
export interface MenuRegistry {
  /** Top-level main menu items */
  readonly mainMenuItems: readonly MenuItem[];
  /** Map of submenu ID → items */
  readonly submenus: Map<string, readonly MenuItem[]>;
  /** Display titles for submenu breadcrumbs */
  readonly submenuTitles: Map<string, string>;
  /** Flat map of every menu item by its ID (main items + all submenu items) */
  readonly menuItemsById: Map<string, MenuItem>;
}

/** Build the full menu registry from the given locale. */
export function buildMenu(locale: Locale): MenuRegistry {
  const mainMenuItems: readonly MenuItem[] = [
    item(
      "dashboard",
      "󰋜",
      locale.menu.dashboard.title,
      locale.menu.dashboard.description,
      { type: "view", viewId: "dashboard" },
      undefined,
      ["home", "overview", "main", ":dash", ":home"],
    ),

    item(
      "entities",
      "󰋙",
      locale.menu.entities.title,
      locale.menu.entities.description,
      { type: "view", viewId: "entities" },
      undefined,
      ["entity", "devices", "config", "registry", "browse", "search", ":ent"],
    ),

    item(
      "settings",
      "󰒓",
      locale.menu.settings.title,
      locale.menu.settings.description,
      submenu("settings"),
      undefined,
      ["config", "preferences", "options", ":set", "prefs", "cfg", "connection"],
    ),

    item(
      "quit",
      "󰩈",
      locale.menu.quit.title,
      locale.menu.quit.description,
      { type: "quit" },
      undefined,
      [":q", ":wq", ":qa", "exit", "quit", "close", "bye"],
    ),
  ];

  const settingsItems: readonly MenuItem[] = [
    item(
      "settings.connection",
      "󰌿",
      locale.menu.connection.title,
      locale.menu.connection.description,
      { type: "view", viewId: "setup" },
      undefined,
      ["url", "token", "auth", "host", ":conn", "ha", "server"],
    ),
  ];

  const submenus: Map<string, readonly MenuItem[]> = new Map([
    ["settings", settingsItems],
  ]);

  const submenuTitles: Map<string, string> = new Map([
    ["settings", locale.menu.settingsTitle],
  ]);

  const menuItemsById: Map<string, MenuItem> = new Map();
  for (const m of mainMenuItems) menuItemsById.set(m.id, m);
  for (const m of settingsItems) menuItemsById.set(m.id, m);

  return { mainMenuItems, submenus, submenuTitles, menuItemsById };
}
