import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  type KeyEvent,
  t,
  fg,
  dim,
} from "@opentui/core";
import {
  subscribeEntities,
  type UnsubscribeFunc,
} from "home-assistant-js-websocket";
import type {
  Connection,
  HassEntity,
  HassEntities,
} from "home-assistant-js-websocket";
import type { MenuItem } from "../types.js";
import type { ConnectionInfo } from "../types.js";
import type { Theme } from "../theme.js";
import type { Locale } from "../i18n/index.js";
import { formatHelpBar, globalHelp, type HelpEntry } from "./helpBar.js";
import { formatHeaderBar } from "./headerBar.js";
import { MenuList } from "./MenuList.js";
import {
  fetchEntityRegistry,
  subscribeEntityRegistryUpdates,
  type EntityRegistryEntry,
} from "../data/entityRegistry.js";
import {
  fetchStateTranslations,
  translateEntityState,
  type LocalizeFunc,
} from "../data/stateTranslation.js";
import { resolveEntityIcon } from "../data/iconResolver.js";
import { twoPhaseSearch } from "../search.js";
import type { FuseOptionKey } from "fuse.js";

const log = (msg: string) => console.error(`[ha-tui:EntitiesView] ${msg}`);

/** Maximum items rendered per page */
const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------

export interface EntitiesViewOptions {
  /** Called when the user navigates back */
  readonly onBack: () => void;
  /** Root title for the breadcrumb */
  readonly rootTitle?: string;
  /** Called when the title changes so the terminal tab can be updated */
  readonly onTitleChange?: (titleParts: readonly string[]) => void;
}

/** Combined entity data: registry metadata + live state */
interface EntityItem {
  readonly registryEntry: EntityRegistryEntry;
  readonly entity: HassEntity | undefined;
}

/** MenuItem augmented with searchable fields for the two-phase algorithm */
interface SearchableMenuItem extends MenuItem {
  readonly searchFields: readonly string[];
}

/** Fuse.js key definitions for the fuzzy fallback */
const FUSE_KEYS: ReadonlyArray<FuseOptionKey<SearchableMenuItem>> = [
  { name: "title", weight: 4 },
  { name: "keywords", weight: 2 },
  { name: "description", weight: 1 },
];

/**
 * Entities view — browse and search all Home Assistant entities.
 *
 * Data sources:
 *   - Entity registry (`config/entity_registry/list`) for metadata
 *   - `subscribeEntities` for live state values
 *
 * Search algorithm matches the HA frontend `/config/entities` page:
 *   1. Exact substring match (diacritics-stripped, multi-term AND)
 *   2. Fuse.js fuzzy fallback (threshold 0.2) if exact yields nothing
 *
 * The list is paginated at 100 items per page with sentinel rows for
 * page navigation and PgUp/PgDn keyboard support.
 */
export class EntitiesView {
  private renderer: CliRenderer;
  private theme: Theme;
  private strings: Locale;
  private callbacks: EntitiesViewOptions;
  private titleParts: readonly string[];

  private root: BoxRenderable;
  private headerBar: TextRenderable;
  private filterBar: TextRenderable;
  private pageIndicator: TextRenderable;
  private statusText: TextRenderable;
  private menuList: MenuList;
  private helpBar: TextRenderable;
  private help: readonly HelpEntry[];

  // Connection / subscription state
  private conn: Connection | null = null;
  private localize: LocalizeFunc | null = null;
  private unsubEntities: UnsubscribeFunc | null = null;
  private unsubRegistry: (() => void) | null = null;
  private registryEntries: EntityRegistryEntry[] = [];
  private entityStates: HassEntities = {};
  private isFirstEntityUpdate = true;
  private initializationInProgress = false;

  // Full merged item list (all entities)
  private allMenuItems: SearchableMenuItem[] = [];
  // Current filtered subset (what's passed to the paginated MenuList)
  private filteredItems: readonly SearchableMenuItem[] = [];
  private filterText = "";

  // Whether the status text line is currently in the flex tree
  private statusVisible = true;
  private pageIndicatorVisible = false;

  // Current connection info for header rebuilds
  private currentInfo: ConnectionInfo;
  private isVisible = false;

  constructor(
    renderer: CliRenderer,
    theme: Theme,
    strings: Locale,
    options: EntitiesViewOptions,
  ) {
    this.renderer = renderer;
    this.theme = theme;
    this.strings = strings;
    this.callbacks = options;
    this.titleParts = [
      options.rootTitle ?? strings.app.name,
      strings.menu.entities.title,
    ];

    this.help = [
      { key: strings.keys.arrowsUD, action: strings.help.navigate },
      { key: strings.keys.enter, action: strings.help.select },
      { key: strings.keys.typeInput, action: strings.help.filter },
      { key: strings.keys.pgUpDn, action: strings.help.nextPage },
      { key: strings.keys.esc, action: strings.help.back },
      ...globalHelp(strings),
    ];

    this.root = new BoxRenderable(renderer, {
      id: "entities-root",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      padding: 1,
    });

    this.currentInfo = { status: "disconnected", url: "" };
    this.headerBar = new TextRenderable(renderer, {
      id: "entities-header",
      content: formatHeaderBar(
        theme,
        strings,
        this.currentInfo,
        this.titleParts,
      ),
      marginBottom: 1,
    });
    this.root.add(this.headerBar);

    this.filterBar = new TextRenderable(renderer, {
      id: "entities-filter",
      content: t`${fg(theme.fgSubtle)("/")}`,
      marginBottom: 1,
    });
    this.root.add(this.filterBar);

    // Page indicator — shown when paginated
    this.pageIndicator = new TextRenderable(renderer, {
      id: "entities-page-indicator",
      content: t``,
      marginBottom: 1,
    });
    // Not added initially — inserted when pagination is active

    // Status text — shown while loading/disconnected/empty
    this.statusText = new TextRenderable(renderer, {
      id: "entities-status",
      content: t`${fg(theme.fgMuted)(strings.entities.loading)}`,
      marginBottom: 1,
    });
    this.root.add(this.statusText);

    // Menu list with pagination
    this.menuList = this.createMenuList([]);
    this.root.add(this.menuList);

    this.helpBar = new TextRenderable(renderer, {
      id: "entities-help",
      content: formatHelpBar(theme, this.help),
      marginTop: 1,
    });
    this.root.add(this.helpBar);

    renderer.root.add(this.root);

    renderer.on("resize", () => {
      this.helpBar.content = formatHelpBar(this.theme, this.help);
      this.headerBar.content = formatHeaderBar(
        this.theme,
        this.strings,
        this.currentInfo,
        this.titleParts,
      );
    });

    options.onTitleChange?.(this.titleParts);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Push a live connection info update to the header bar. */
  updateConnectionInfo(info: ConnectionInfo): void {
    this.currentInfo = info;
    this.headerBar.content = formatHeaderBar(
      this.theme,
      this.strings,
      info,
      this.titleParts,
    );
  }

  /**
   * Provide the active WebSocket connection.
   * Pass `null` to clean up subscriptions on disconnect.
   */
  setConnection(conn: Connection | null): void {
    if (conn === this.conn) return;

    if (!conn) {
      this.cleanup();
      this.conn = null;
      this.showStatus("Disconnected");
      return;
    }

    this.conn = conn;
    void this.initialize(conn);
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
    this.isVisible = visible;
    if (visible) {
      this.callbacks.onTitleChange?.(this.titleParts);
    }
  }

  focus(): void {
    this.menuList.focus();
  }

  resetAndFocus(): void {
    this.filterText = "";
    this.filteredItems = this.allMenuItems;
    this.menuList.setItems(this.allMenuItems);
    this.updateFilterBar("");
    this.updatePageIndicator();
    this.menuList.focus();
  }

  blur(): void {
    this.menuList.blur();
  }

  destroy(): void {
    this.cleanup();
    this.renderer.root.remove(this.root.id);
  }

  // ── Initialization ────────────────────────────────────────────────────────

  private async initialize(conn: Connection): Promise<void> {
    if (this.initializationInProgress) return;
    this.initializationInProgress = true;

    this.cleanup();
    this.conn = conn;

    log("Fetching entity registry and translations");
    this.showStatus(this.strings.entities.loading);

    try {
      const [registryResult, localizeResult] = await Promise.allSettled([
        fetchEntityRegistry(conn),
        fetchStateTranslations(conn),
      ]);

      // Guard: connection may have changed during async fetches
      if (this.conn !== conn) {
        log("Connection changed during initialization — aborting");
        return;
      }

      if (localizeResult.status === "fulfilled") {
        this.localize = localizeResult.value;
      } else {
        log(
          `Failed to fetch state translations: ${String(localizeResult.reason)}`,
        );
      }

      if (registryResult.status === "rejected") {
        log(
          `Failed to fetch entity registry: ${String(registryResult.reason)}`,
        );
        this.showStatus("Failed to load entity registry");
        return;
      }

      this.registryEntries = registryResult.value;
      log(`Entity registry loaded: ${this.registryEntries.length} entries`);

      // Subscribe to live entity states
      this.isFirstEntityUpdate = true;
      this.unsubEntities = subscribeEntities(conn, (entities) => {
        if (this.conn !== conn) return;
        this.handleEntityUpdate(entities);
      });

      // Subscribe to registry updates to refetch on changes
      this.unsubRegistry = subscribeEntityRegistryUpdates(conn, () => {
        if (this.conn !== conn) return;
        void this.refetchRegistry(conn);
      });
    } finally {
      this.initializationInProgress = false;
    }
  }

  private async refetchRegistry(conn: Connection): Promise<void> {
    try {
      const entries = await fetchEntityRegistry(conn);
      if (this.conn !== conn) return;
      this.registryEntries = entries;
      // Rebuild the full list with current states
      this.buildAllMenuItems();
      this.applyCurrentFilter();
    } catch (err) {
      log(`Failed to refetch entity registry: ${String(err)}`);
    }
  }

  // ── Entity state handling ─────────────────────────────────────────────────

  private handleEntityUpdate(allEntities: HassEntities): void {
    this.entityStates = allEntities;

    if (this.isFirstEntityUpdate) {
      this.isFirstEntityUpdate = false;
      this.buildAllMenuItems();
      // Don't show the full list — wait for the user to type a search query
      this.filteredItems = [];
      this.showSearchPrompt();
      return;
    }

    // Incremental updates — rebuild items but only update view if filtering
    this.buildAllMenuItems();
    if (this.filterText.length > 0) {
      this.applyCurrentFilter();
    }
  }

  private buildAllMenuItems(): void {
    const items: SearchableMenuItem[] = [];

    for (const entry of this.registryEntries) {
      // Filter out disabled entities (same as HA entities config default)
      if (entry.disabled_by != null) continue;

      const entity = this.entityStates[entry.entity_id];

      // Filter out unavailable entities (same as HA entities config default)
      if (!entity || entity.state === "unavailable") continue;

      items.push(this.buildMenuItem(entry, entity));
    }

    // Sort: entities with a device first, then alphabetically by title
    const hasDevice = new Set<string>();
    for (const entry of this.registryEntries) {
      if (entry.device_id != null) hasDevice.add(entry.entity_id);
    }
    items.sort((a, b) => {
      const aHas = hasDevice.has(a.id) ? 0 : 1;
      const bHas = hasDevice.has(b.id) ? 0 : 1;
      if (aHas !== bHas) return aHas - bHas;
      return a.title.localeCompare(b.title);
    });
    this.allMenuItems = items;
  }

  private buildMenuItem(
    entry: EntityRegistryEntry,
    entity: HassEntity | undefined,
  ): SearchableMenuItem {
    const domain = entry.entity_id.split(".")[0] ?? "";
    const name =
      entry.name ??
      entity?.attributes.friendly_name ??
      entry.original_name ??
      entry.entity_id;

    const stateDisplay = entity
      ? this.localize
        ? translateEntityState(entity, this.localize)
        : entity.state
      : "unavailable";

    const descParts = [stateDisplay, entry.platform, domain].filter(Boolean);
    const description = descParts.join(" · ");

    // Searchable fields for the two-phase algorithm
    const searchFields: string[] = [
      name,
      entry.entity_id,
      entry.platform,
      domain,
      stateDisplay,
    ];
    if (entry.area_id) searchFields.push(entry.area_id);

    // Compute icon from entity state if available, fallback to domain
    const icon = entity ? resolveEntityIcon(entity) : "󰋙";

    return {
      id: entry.entity_id,
      icon,
      title: name,
      description,
      action: { type: "noop" },
      keywords: [entry.entity_id, entry.platform, domain],
      searchFields,
    };
  }

  // ── Search / Filter ───────────────────────────────────────────────────────

  private applyCurrentFilter(): void {
    if (this.filterText.length === 0) {
      this.filteredItems = [];
      this.menuList.setFilteredItems([]);
      this.showSearchPrompt();
      return;
    }

    this.filteredItems = twoPhaseSearch(
      this.allMenuItems,
      this.filterText,
      (item) => item.searchFields,
      FUSE_KEYS,
    );

    if (this.statusVisible) {
      this.root.remove(this.statusText.id);
      this.statusVisible = false;
    }
    this.menuList.setFilteredItems(this.filteredItems);
    this.updatePageIndicator();
  }

  private handleFilterChange(filter: string): void {
    this.filterText = filter;
    this.updateFilterBar(filter);

    if (filter.trim().length < 2) {
      this.filteredItems = [];
      this.menuList.setFilteredItems([]);
      this.showSearchPrompt();
      return;
    }

    this.filteredItems = twoPhaseSearch(
      this.allMenuItems,
      filter,
      (item) => item.searchFields,
      FUSE_KEYS,
    );

    if (this.statusVisible) {
      this.root.remove(this.statusText.id);
      this.statusVisible = false;
    }
    this.menuList.setFilteredItems(this.filteredItems);
    this.updatePageIndicator();
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  private cleanup(): void {
    this.unsubEntities?.();
    this.unsubEntities = null;
    this.unsubRegistry?.();
    this.unsubRegistry = null;
    this.localize = null;
    this.registryEntries = [];
    this.entityStates = {};
    this.allMenuItems = [];
    this.filteredItems = [];
    this.filterText = "";
    this.isFirstEntityUpdate = true;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private updateFilterBar(filter: string): void {
    if (filter.length === 0) {
      this.filterBar.content = t`${fg(this.theme.fgSubtle)("/")}`;
    } else {
      this.filterBar.content = t`${fg(this.theme.accent)("/")} ${fg(this.theme.fg)(filter)}`;
    }
  }

  private updatePageIndicator(): void {
    const total = this.filteredItems.length;
    const totalPages = this.menuList.totalPages;

    if (totalPages <= 1) {
      // Hide page indicator, show count only if meaningful
      if (this.pageIndicatorVisible) {
        this.root.remove(this.pageIndicator.id);
        this.pageIndicatorVisible = false;
      }
      return;
    }

    const page = this.menuList.currentPage + 1;
    const pageText = this.strings.entities.pageOf(page, totalPages);
    const countText = this.strings.entities.totalCount(total);
    this.pageIndicator.content = t`${dim(fg(this.theme.fgMuted)(`${pageText} · ${countText}`))}`;

    if (!this.pageIndicatorVisible) {
      this.root.insertBefore(this.pageIndicator, this.menuList);
      this.pageIndicatorVisible = true;
    }
  }

  /** Show a status message above the empty menu list. */
  private showStatus(message: string): void {
    if (!this.statusVisible) {
      this.root.insertBefore(this.statusText, this.menuList);
      this.statusVisible = true;
    }
    this.statusText.content = t`${fg(this.theme.fgMuted)(message)}`;
    this.menuList.setItems([]);
    if (this.pageIndicatorVisible) {
      this.root.remove(this.pageIndicator.id);
      this.pageIndicatorVisible = false;
    }
  }

  /** Show a search prompt when no query is active. */
  private showSearchPrompt(): void {
    const count = this.allMenuItems.length;
    const message =
      count > 0
        ? this.strings.entities.searchPrompt(count)
        : this.strings.entities.loading;
    if (!this.statusVisible) {
      this.root.insertBefore(this.statusText, this.menuList);
      this.statusVisible = true;
    }
    this.statusText.content = t`${fg(this.theme.fgMuted)(message)}`;
    if (this.pageIndicatorVisible) {
      this.root.remove(this.pageIndicator.id);
      this.pageIndicatorVisible = false;
    }
  }

  private createMenuList(items: readonly MenuItem[]): MenuList {
    return new MenuList(this.renderer, {
      id: "entities-list",
      items,
      theme: this.theme,
      pageSize: PAGE_SIZE,
      externalFilter: true,
      onSelect: (_item) => {
        // Entity actions not yet implemented
      },
      onFilterChange: (filter) => this.handleFilterChange(filter),
      onPageChange: () => this.updatePageIndicator(),
      onEscape: () => this.callbacks.onBack(),
      onBack: () => this.callbacks.onBack(),
      wrapSelection: false,
    });
  }
}
