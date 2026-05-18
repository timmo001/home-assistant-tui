/** All user-facing strings for the TUI application. */
export interface Locale {
  app: {
    /** Fallback root title for the submenu breadcrumb when no title is provided */
    readonly menuFallbackTitle: string;
    /** Application name shown in the header and terminal title */
    readonly name: string;
    /** Terminal title suffix on the setup view — e.g. "Setup" → "App — Setup" */
    readonly setupSuffix: string;
  };

  commands: {
    readonly commandFailed: string;
    readonly pressAnyKey: string;
    readonly reconnectionFailed: string;
  };

  connectionForm: {
    help: {
      readonly cancel: string;
      readonly nextField: string;
      readonly save: string;
    };
    readonly connecting: string;
    readonly saveFailed: string;
    readonly subtitle: string;
    readonly title: string;
    readonly tokenLabel: string;
    readonly tokenPlaceholder: string;
    readonly urlLabel: string;
  };

  entities: {
    readonly empty: string;
    /** Group mode labels */
    groupBy: {
      readonly area: string;
      readonly device: string;
      readonly domain: string;
      readonly integration: string;
    };
    readonly loading: string;
    readonly nextPage: string;
    readonly pageOf: (page: number, total: number) => string;
    readonly prevPage: string;
    readonly searchPrompt: (count: number) => string;
    readonly totalCount: (n: number) => string;
    ungrouped: {
      /** Label for entities without an area */
      readonly area: string;
      /** Label for entities without a device */
      readonly device: string;
      /** Label for entities without a domain (shouldn't happen, but fallback) */
      readonly domain: string;
      /** Label for entities without an integration (shouldn't happen, but fallback) */
      readonly integration: string;
    };
  };

  errors: {
    readonly unknownSubcommand: (cmd: string) => string;
  };

  help: {
    readonly back: string;
    readonly cancel: string;
    readonly filter: string;
    readonly groupBy: string;
    readonly navigate: string;
    readonly nextPage: string;
    readonly prevPage: string;
    readonly quit: string;
    readonly select: string;
  };

  /** Key names as displayed in help bars */
  keys: {
    readonly arrowsUD: string;
    readonly backspace: string;
    readonly ctrlC: string;
    readonly ctrlG: string;
    readonly enter: string;
    readonly esc: string;
    readonly pgUpDn: string;
    readonly tab: string;
    /** Label for "type characters to filter" */
    readonly typeInput: string;
  };

  menu: {
    readonly connection: {
      readonly description: string;
      readonly title: string;
    };
    readonly dashboard: {
      readonly description: string;
      readonly title: string;
    };
    readonly entities: { readonly description: string; readonly title: string };
    readonly quit: { readonly description: string; readonly title: string };
    readonly settings: { readonly description: string; readonly title: string };
    /** Display title for the settings submenu breadcrumb */
    readonly settingsTitle: string;
  };

  status: {
    ago: {
      readonly hours: (h: number) => string;
      readonly minutes: (m: number) => string;
      readonly seconds: (s: number) => string;
    };
    readonly connected: string;
    readonly connecting: string;
    readonly disconnected: string;
    readonly error: string;
    readonly justNow: string;
    readonly updatedAgo: (ago: string) => string;
  };
}
