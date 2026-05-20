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
    connecting: "Connecting…",
    help: {
      cancel: "cancel",
      nextField: "next field",
      save: "save",
    },
    saveFailed: "Connection failed — check URL and token",
    subtitle: " — enter your Home Assistant URL and access token",
    title: "Connection Setup",
    tokenLabel: "Token",
    tokenPlaceholder:
      "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    urlLabel: "URL",
  },

  dashboard: {
    favoritesGroup: "Favorites",
    areasGroup: "Areas",
    otherAreasGroup: "Other areas",
    loadingAreas: "Loading areas\u2026",
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

  areaEntities: {
    loading: "Loading entities\u2026",
    empty: "No entities in this area",
    noDevice: "No device",
  },

  entityActions: {
    copied: (entityId) => `Copied: ${entityId}`,
    openedWeb: "Opened in browser",
    serviceCalled: (service) => `Called ${service}`,
    serviceError: (error) => `Failed: ${error}`,
    noActions: "No actions available",
    clipboardUnavailable: "Clipboard unavailable",
    menuTitle: "Actions",
    toggle: "Toggle",
    unsupportedSelector: "not supported in TUI",
    submit: "Submit",
    cancel: "Cancel",
  },

  errors: {
    unknownSubcommand: (cmd) => `Unknown subcommand: ${cmd}`,
  },

  help: {
    actions: "actions",
    back: "back",
    cancel: "cancel",
    copyId: "copy id",
    filter: "filter",
    groupBy: "group by",
    navigate: "navigate",
    nextPage: "next page",
    openDetails: "open details",
    openHistory: "open history",
    openInfo: "open info",
    openRelated: "open related",
    openSettings: "open settings",
    prevPage: "prev page",
    quit: "quit",
    select: "select",
    toggle: "toggle",
  },

  keys: {
    arrowsUD: "↑↓",
    backspace: "Backspace",
    ctrl: {
      c: "Ctrl+C",
      d: "Ctrl+D",
      g: "Ctrl+G",
      h: "Ctrl+H",
      r: "Ctrl+R",
      s: "Ctrl+S",
      w: "Ctrl+W",
      y: "Ctrl+Y",
    },
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
    entities: {
      description: "Browse and search all entities",
      title: "Entities",
    },
    quit: { description: "Exit the application", title: "Quit" },
    settings: {
      description: "Configure connection and preferences",
      title: "Settings",
    },
    settingsTitle: "Settings",
  },

  testView: {
    description: "Sandbox view for exercising TUI scaffolding.",
    heading: "Test View",
    title: "Test",
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
