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

  dashboard: {
    /** Group header for the favorites section in the dashboard */
    readonly favoritesGroup: string;
    /** Group header for the areas section in the dashboard */
    readonly areasGroup: string;
    /** Group header for areas not assigned to a floor */
    readonly otherAreasGroup: string;
    /** Loading message while fetching areas */
    readonly loadingAreas: string;
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

  todo: {
    readonly actionFailed: (error: string) => string;
    readonly addItem: string;
    readonly completedHidden: string;
    readonly completedPrefix: string;
    readonly completedVisible: string;
    readonly confirmDelete: (summary: string) => string;
    readonly created: string;
    readonly deleted: string;
    readonly deleteItem: string;
    readonly descriptionLabel: string;
    readonly descriptionPlaceholder: string;
    readonly due: (due: string) => string;
    readonly editItem: string;
    readonly emptyActive: string;
    readonly emptyAll: string;
    readonly emptyFiltered: string;
    readonly emptyLists: string;
    readonly entityNotFound: (entityId: string) => string;
    readonly help: {
      readonly add: string;
      readonly completed: string;
      readonly delete: string;
      readonly edit: string;
      readonly mark: string;
      readonly openWeb: string;
    };
    readonly loadingItems: string;
    readonly loadingLists: string;
    readonly loadFailed: (error: string) => string;
    readonly noDescription: string;
    readonly pickList: string;
    readonly requiredFields: string;
    readonly taskNameLabel: string;
    readonly totalCount: (n: number) => string;
    readonly unsupported: string;
    readonly updated: string;
    readonly openedWeb: string;
  };

  areaEntities: {
    readonly loading: string;
    readonly empty: string;
    /** Label for entities without a device in area view */
    readonly noDevice: string;
  };

  entityActions: {
    /** Toast shown when entity ID is copied to clipboard */
    readonly copied: (entityId: string) => string;
    /** Toast shown when browser is opened */
    readonly openedWeb: string;
    /** Toast shown after a service is successfully called */
    readonly serviceCalled: (service: string) => string;
    /** Toast shown when a service call fails */
    readonly serviceError: (error: string) => string;
    /** Toast shown when no services are available */
    readonly noActions: string;
    /** Toast shown when clipboard command is unavailable */
    readonly clipboardUnavailable: string;
    /** Title shown on the services popup */
    readonly menuTitle: string;
    /** Label for the toggle action in the services menu */
    readonly toggle: string;
    /** Label for unsupported selectors in service forms */
    readonly unsupportedSelector: string;
    /** Submit button label in service forms */
    readonly submit: string;
    /** Cancel label for service form */
    readonly cancel: string;
  };

  errors: {
    readonly unknownSubcommand: (cmd: string) => string;
  };

  help: {
    readonly actions: string;
    readonly back: string;
    readonly cancel: string;
    readonly copyId: string;
    readonly filter: string;
    readonly groupBy: string;
    readonly navigate: string;
    readonly nextPage: string;
    readonly openDetails: string;
    readonly openHistory: string;
    readonly openInfo: string;
    readonly openRelated: string;
    readonly openSettings: string;
    readonly prevPage: string;
    readonly quit: string;
    readonly select: string;
    readonly toggle: string;
  };

  /** Key names as displayed in help bars */
  keys: {
    readonly arrowsUD: string;
    readonly backspace: string;
    ctrl: {
      readonly c: string;
      readonly d: string;
      readonly g: string;
      readonly h: string;
      readonly r: string;
      readonly s: string;
      readonly w: string;
      readonly y: string;
    };
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
    readonly todo: { readonly description: string; readonly title: string };
    readonly quit: { readonly description: string; readonly title: string };
    readonly settings: { readonly description: string; readonly title: string };
    /** Display title for the settings submenu breadcrumb */
    readonly settingsTitle: string;
  };

  testView: {
    readonly description: string;
    readonly heading: string;
    readonly title: string;
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
