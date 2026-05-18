/** All user-facing strings for the TUI application. */
export interface Locale {
  app: {
    /** Application name shown in the header and terminal title */
    readonly name: string;
    /** Terminal title suffix on the setup view — e.g. "Setup" → "App — Setup" */
    readonly setupSuffix: string;
    /** Fallback root title for the submenu breadcrumb when no title is provided */
    readonly menuFallbackTitle: string;
  };

  menu: {
    readonly dashboard: {
      readonly title: string;
      readonly description: string;
    };
    readonly entities: { readonly title: string; readonly description: string };
    readonly settings: { readonly title: string; readonly description: string };
    readonly quit: { readonly title: string; readonly description: string };
    readonly connection: {
      readonly title: string;
      readonly description: string;
    };
    /** Display title for the settings submenu breadcrumb */
    readonly settingsTitle: string;
  };

  status: {
    readonly connected: string;
    readonly connecting: string;
    readonly disconnected: string;
    readonly error: string;
    readonly updatedAgo: (ago: string) => string;
    readonly justNow: string;
    readonly secondsAgo: (s: number) => string;
    readonly minutesAgo: (m: number) => string;
    readonly hoursAgo: (h: number) => string;
  };

  connectionForm: {
    readonly title: string;
    readonly subtitle: string;
    readonly urlLabel: string;
    readonly tokenLabel: string;
    readonly tokenPlaceholder: string;
    readonly helpNextField: string;
    readonly helpSave: string;
    readonly helpCancel: string;
  };

  help: {
    readonly navigate: string;
    readonly select: string;
    readonly filter: string;
    readonly back: string;
    readonly quit: string;
    readonly cancel: string;
    readonly nextPage: string;
    readonly prevPage: string;
    readonly groupBy: string;
  };

  /** Key names as displayed in help bars */
  keys: {
    readonly ctrlC: string;
    readonly ctrlG: string;
    readonly arrowsUD: string;
    readonly enter: string;
    readonly esc: string;
    readonly tab: string;
    readonly backspace: string;
    /** Label for "type characters to filter" */
    readonly typeInput: string;
    readonly pgUpDn: string;
  };

  commands: {
    readonly pressAnyKey: string;
    readonly commandFailed: string;
    readonly reconnectionFailed: string;
  };

  entities: {
    readonly pageOf: (page: number, total: number) => string;
    readonly totalCount: (n: number) => string;
    readonly nextPage: string;
    readonly prevPage: string;
    readonly loading: string;
    readonly empty: string;
    readonly searchPrompt: (count: number) => string;
    /** Group mode labels */
    readonly groupByDevice: string;
    readonly groupByDomain: string;
    readonly groupByArea: string;
    readonly groupByIntegration: string;
    /** Label for entities without a device */
    readonly ungroupedDevice: string;
    /** Label for entities without a domain (shouldn't happen, but fallback) */
    readonly ungroupedDomain: string;
    /** Label for entities without an area */
    readonly ungroupedArea: string;
    /** Label for entities without an integration (shouldn't happen, but fallback) */
    readonly ungroupedIntegration: string;
  };

  errors: {
    readonly unknownSubcommand: (cmd: string) => string;
  };
}
