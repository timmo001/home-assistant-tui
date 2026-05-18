import type { Locale } from "./types.js";

export const en: Locale = {
  app: {
    menuFallbackTitle: "Menu",
    name: "Home Assistant TUI",
    setupSuffix: "Setup",
  },

  commands: {
    commandFailed: "Command failed",
    pressAnyKey: "Press any key to continue...",
    reconnectionFailed: "Reconnection failed",
  },

  connectionForm: {
    help: {
      cancel: "cancel",
      nextField: "next field",
      save: "save",
    },
    subtitle: " — enter your Home Assistant URL and access token",
    title: "Connection Setup",
    tokenLabel: "Token",
    tokenPlaceholder:
      "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    urlLabel: "URL",
  },

  entities: {
    empty: "No entities found",
    groupBy: {
      area: "Area",
      device: "Device",
      domain: "Domain",
      integration: "Integration",
    },
    loading: "Loading entities\u2026",
    nextPage: "Next page →",
    pageOf: (page, total) => `Page ${page} of ${total}`,
    prevPage: "← Previous page",
    searchPrompt: (count) =>
      `Type to search ${count.toLocaleString()} entities`,
    totalCount: (n) => `${n.toLocaleString()} entities`,
    ungrouped: {
      area: "No area",
      device: "No device",
      domain: "Other",
      integration: "Unknown",
    },
  },

  errors: {
    unknownSubcommand: (cmd) => `Unknown subcommand: ${cmd}`,
  },

  help: {
    back: "back",
    cancel: "cancel",
    filter: "filter",
    groupBy: "group by",
    navigate: "navigate",
    nextPage: "next page",
    prevPage: "prev page",
    quit: "quit",
    select: "select",
  },

  keys: {
    arrowsUD: "↑↓",
    backspace: "Backspace",
    ctrlC: "Ctrl+C",
    ctrlG: "Ctrl+G",
    enter: "Enter",
    esc: "Esc",
    pgUpDn: "PgUp/PgDn",
    tab: "Tab",
    typeInput: "type",
  },

  menu: {
    connection: {
      description: "Change Home Assistant URL or access token",
      title: "Connection",
    },
    dashboard: {
      description: "Overview of your Home Assistant instance",
      title: "Dashboard",
    },
    entities: { description: "Browse and search all entities", title: "Entities" },
    quit: { description: "Exit the application", title: "Quit" },
    settings: { description: "Configure connection and preferences", title: "Settings" },
    settingsTitle: "Settings",
  },

  status: {
    ago: {
      hours: (h) => `${h}h ago`,
      minutes: (m) => `${m}m ago`,
      seconds: (s) => `${s}s ago`,
    },
    connected: "Connected",
    connecting: "Connecting",
    disconnected: "Disconnected",
    error: "Error",
    justNow: "just now",
    updatedAgo: (ago) => `Updated ${ago}`,
  },
};
