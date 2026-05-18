import type { Locale } from "./types.js";

export const en: Locale = {
  app: {
    name: "Home Assistant TUI",
    setupSuffix: "Setup",
    menuFallbackTitle: "Menu",
  },

  menu: {
    dashboard: {
      title: "Dashboard",
      description: "Overview of your Home Assistant instance",
    },
    entities: {
      title: "Entities",
      description: "Browse and search all entities",
    },
    settings: {
      title: "Settings",
      description: "Configure connection and preferences",
    },
    quit: {
      title: "Quit",
      description: "Exit the application",
    },
    connection: {
      title: "Connection",
      description: "Change Home Assistant URL or access token",
    },
    settingsTitle: "Settings",
  },

  status: {
    connected: "Connected",
    connecting: "Connecting",
    disconnected: "Disconnected",
    error: "Error",
    updatedAgo: (ago) => `Updated ${ago}`,
    justNow: "just now",
    secondsAgo: (s) => `${s}s ago`,
    minutesAgo: (m) => `${m}m ago`,
    hoursAgo: (h) => `${h}h ago`,
  },

  connectionForm: {
    title: "Connection Setup",
    subtitle: " — enter your Home Assistant URL and access token",
    urlLabel: "URL",
    tokenLabel: "Token",
    tokenPlaceholder:
      "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    helpNextField: "next field",
    helpSave: "save",
    helpCancel: "cancel",
  },

  help: {
    navigate: "navigate",
    select: "select",
    filter: "filter",
    back: "back",
    quit: "quit",
    cancel: "cancel",
    nextPage: "next page",
    prevPage: "prev page",
  },

  keys: {
    ctrlC: "Ctrl+C",
    arrowsUD: "↑↓",
    enter: "Enter",
    esc: "Esc",
    tab: "Tab",
    backspace: "Backspace",
    typeInput: "type",
    pgUpDn: "PgUp/PgDn",
  },

  commands: {
    pressAnyKey: "Press any key to continue...",
    commandFailed: "Command failed",
    reconnectionFailed: "Reconnection failed",
  },

  entities: {
    pageOf: (page, total) => `Page ${page} of ${total}`,
    totalCount: (n) => `${n.toLocaleString()} entities`,
    nextPage: "Next page →",
    prevPage: "← Previous page",
    loading: "Loading entities\u2026",
    empty: "No entities found",
    searchPrompt: (count) =>
      `Type to search ${count.toLocaleString()} entities`,
  },

  errors: {
    unknownSubcommand: (cmd) => `Unknown subcommand: ${cmd}`,
  },
};
