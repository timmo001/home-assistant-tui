import {
  type CliRenderer,
  TextRenderable,
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
import type { Theme } from "../theme.js";
import type { Locale } from "../i18n/index.js";
import { globalHelp, type HelpEntry } from "./helpBar.js";
import { MenuList } from "./MenuList.js";
import { ConnectedView, type ConnectedViewOptions } from "./ConnectedView.js";
import {
  fetchEntityRegistry,
  type EntityRegistryEntry,
} from "../data/entityRegistry.js";
import {
  fetchDeviceRegistry,
  computeDeviceName,
  type DeviceRegistryEntry,
} from "../data/deviceRegistry.js";
import {
  fetchStateTranslations,
  translateEntityState,
  type LocalizeFunc,
} from "../data/stateTranslation.js";
import { resolveEntityIcon } from "../data/iconResolver.js";
import { formatHeaderBar } from "./headerBar.js";
import { twoPhaseSearch } from "../search.js";
import type { FuseOptionKey } from "fuse.js";

const log = (msg: string) => console.error(`[ha-tui:AreaEntitiesView] ${msg}`);

/** Maximum items rendered per page */
const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------

export interface AreaEntitiesViewOptions extends ConnectedViewOptions {
  /** Title of the parent view for breadcrumb (e.g. "Dashboard") */
  readonly parentTitle: string;
}

/** MenuItem augmented with searchable fields and device grouping metadata */
interface SearchableMenuItem extends MenuItem {
  readonly searchFields: readonly string[];
  /** Device display name for grouping */
  readonly deviceName: string;
}

/** Fuse.js key definitions for the fuzzy fallback */
const FUSE_KEYS: ReadonlyArray<FuseOptionKey<SearchableMenuItem>> = [
  { name: "title", weight: 4 },
  { name: "keywords", weight: 2 },
  { name: "description", weight: 1 },
];

/**
 * Area Entities view — shows all entities belonging to a specific area,
 * grouped by device. No group mode cycling.
 *
 * Breadcrumb: App Name › Dashboard › Area Name
 *
 * Uses the same filtering, pagination, and search patterns as EntitiesView:
 *   - Two-phase search (exact substring → Fuse.js fuzzy fallback)
 *   - External filter mode with `setFilteredItems`
 *   - Paginated MenuList with page indicator
 *   - Escape clears filter first, then navigates back
 *
 * The area is set via `setArea(areaId, areaName)` before the view becomes
 * visible. When the area changes, the view re-initializes with the new filter.
 */
export class AreaEntitiesView extends ConnectedView {
  // Area context
  private areaId: string | null = null;
  private areaName: string = "";
  private parentTitle: string;

  // Domain-specific state
  private localize: LocalizeFunc | null = null;
  private unsubEntities: UnsubscribeFunc | null = null;
  private registryEntries: EntityRegistryEntry[] = [];
  private deviceMap: Map<string, DeviceRegistryEntry> = new Map();
  private entityStates: HassEntities = {};
  private isFirstEntityUpdate = true;

  // Full merged item list (all entities in this area)
  private allMenuItems: SearchableMenuItem[] = [];
  // Current filtered subset (what's passed to the paginated MenuList)
  private filteredItems: readonly SearchableMenuItem[] = [];
  private filterText = "";

  // Page indicator
  private pageIndicator: TextRenderable;
  private pageIndicatorVisible = false;

  constructor(
    renderer: CliRenderer,
    theme: Theme,
    strings: Locale,
    options: AreaEntitiesViewOptions,
  ) {
    super(renderer, theme, strings, options, {
      idPrefix: "area-entities",
      viewTitle: "",
      initialStatus: strings.areaEntities.loading,
    });

    this.parentTitle = options.parentTitle;

    // Page indicator — inserted above the menu list when pagination is active
    this.pageIndicator = new TextRenderable(renderer, {
      id: "area-entities-page-indicator",
      content: t``,
      marginBottom: 1,
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Set the area to display. Must be called before the view is shown.
   * Updates the breadcrumb and triggers re-initialization if already connected.
   */
  setArea(areaId: string, areaName: string): void {
    this.areaId = areaId;
    this.areaName = areaName;

    // Update breadcrumb: App Name › Dashboard › Area Name
    this.titleParts = [
      this.callbacks.rootTitle ?? this.strings.app.name,
      this.parentTitle,
      areaName,
    ];
    this.callbacks.onTitleChange?.(this.titleParts);

    // Re-render header with updated breadcrumb
    this.headerBar.content = formatHeaderBar(
      this.theme,
      this.strings,
      this.currentInfo,
      this.titleParts,
    );

    // Re-initialize if we already have a connection
    if (this.conn) {
      this.doCleanup();
      void this.reinitialize();
    }
  }

  override resetAndFocus(): void {
    this.filterText = "";
    this.rebuildAndDisplay({ resetSelection: true });
    this.updateFilterBar("");
    this.menuList.focus();
  }

  override showStatus(message: string): void {
    super.showStatus(message);
    if (this.pageIndicatorVisible) {
      this.root.remove(this.pageIndicator.id);
      this.pageIndicatorVisible = false;
    }
  }

  // ── ConnectedView hooks ───────────────────────────────────────────────────

  protected buildHelp(): readonly HelpEntry[] {
    return [
      { key: this.strings.keys.arrowsUD, action: this.strings.help.navigate },
      { key: this.strings.keys.enter, action: this.strings.help.select },
      { key: this.strings.keys.typeInput, action: this.strings.help.filter },
      { key: this.strings.keys.pgUpDn, action: this.strings.help.nextPage },
      { key: this.strings.keys.esc, action: this.strings.help.back },
      ...globalHelp(this.strings),
    ];
  }

  protected createMenuList(): MenuList {
    return new MenuList(this.renderer, {
      id: "area-entities-list",
      items: [],
      theme: this.theme,
      pageSize: PAGE_SIZE,
      externalFilter: true,
      onSelect: (_item) => {
        // Entity actions not yet implemented
      },
      onFilterChange: (filter) => this.handleFilterChange(filter),
      onPageChange: () => this.updatePageIndicator(),
      onEscape: () => {
        if (this.filterText.length > 0) {
          this.filterText = "";
          this.updateFilterBar("");
          this.rebuildAndDisplay();
          return;
        }
        this.callbacks.onBack();
      },
      onBack: () => this.callbacks.onBack(),
      wrapSelection: false,
    });
  }

  protected async doInitialize(conn: Connection): Promise<void> {
    if (!this.areaId) {
      // No area selected yet — silently skip initialization.
      // The view will re-initialize when setArea() is called.
      this.initializationInProgress = false;
      return;
    }

    log(`Initializing for area: ${this.areaName} (${this.areaId})`);
    this.showStatus(this.strings.areaEntities.loading);

    try {
      const [registryResult, deviceResult, localizeResult] =
        await Promise.allSettled([
          fetchEntityRegistry(conn),
          fetchDeviceRegistry(conn),
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
        log(`Failed to fetch state translations: ${String(localizeResult.reason)}`);
      }

      if (deviceResult.status === "fulfilled") {
        this.deviceMap = new Map(deviceResult.value.map((d) => [d.id, d]));
      } else {
        log(`Failed to fetch device registry: ${String(deviceResult.reason)}`);
      }

      if (registryResult.status === "rejected") {
        log(`Failed to fetch entity registry: ${String(registryResult.reason)}`);
        this.showStatus("Failed to load entities");
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
    } finally {
      this.initializationInProgress = false;
    }
  }

  protected doCleanup(): void {
    this.unsubEntities?.();
    this.unsubEntities = null;
    this.localize = null;
    this.registryEntries = [];
    this.deviceMap = new Map();
    this.entityStates = {};
    this.allMenuItems = [];
    this.filteredItems = [];
    this.filterText = "";
    this.isFirstEntityUpdate = true;
  }

  // ── Private lifecycle ─────────────────────────────────────────────────────

  private async reinitialize(): Promise<void> {
    if (!this.conn || this.initializationInProgress) return;
    this.initializationInProgress = true;
    await this.doInitialize(this.conn);
  }

  // ── Entity state handling ─────────────────────────────────────────────────

  private handleEntityUpdate(allEntities: HassEntities): void {
    this.entityStates = allEntities;
    this.buildAllMenuItems();

    if (this.isFirstEntityUpdate) {
      this.isFirstEntityUpdate = false;
      if (this.allMenuItems.length === 0) {
        this.showStatus(this.strings.areaEntities.empty);
        return;
      }
    }

    this.rebuildAndDisplay();
  }

  // ── Item building ─────────────────────────────────────────────────────────

  private buildAllMenuItems(): void {
    if (!this.areaId) return;

    const items: SearchableMenuItem[] = [];

    for (const entry of this.registryEntries) {
      if (entry.disabled_by != null) continue;

      const entity = this.entityStates[entry.entity_id];
      if (!entity || entity.state === "unavailable") continue;

      // Determine entity's area: direct assignment or via device
      const device = entry.device_id
        ? this.deviceMap.get(entry.device_id)
        : undefined;
      const entityAreaId = entry.area_id ?? device?.area_id ?? null;

      if (entityAreaId !== this.areaId) continue;

      items.push(this.buildMenuItem(entry, entity, device));
    }

    this.allMenuItems = items;
  }

  private buildMenuItem(
    entry: EntityRegistryEntry,
    entity: HassEntity,
    device: DeviceRegistryEntry | undefined,
  ): SearchableMenuItem {
    const domain = entry.entity_id.split(".")[0] ?? "";
    const name =
      entry.name ??
      entity.attributes.friendly_name ??
      entry.original_name ??
      entry.entity_id;

    const stateDisplay = this.localize
      ? translateEntityState(entity, this.localize)
      : entity.state;

    const descParts = [stateDisplay, entry.platform, domain].filter(Boolean);
    const description = descParts.join(" · ");

    const deviceName = device
      ? computeDeviceName(device)
      : this.strings.areaEntities.noDevice;

    // Searchable fields for the two-phase algorithm
    const searchFields: string[] = [
      name,
      entry.entity_id,
      entry.platform,
      domain,
      stateDisplay,
    ];
    if (deviceName) searchFields.push(deviceName);

    const icon = resolveEntityIcon(entity);

    return {
      id: entry.entity_id,
      icon,
      title: name,
      description,
      action: { type: "noop" },
      keywords: [entry.entity_id, entry.platform, domain],
      searchFields,
      deviceName,
      // group is assigned dynamically in applyGrouping()
      group: undefined,
    };
  }

  // ── Grouping & sorting ────────────────────────────────────────────────────

  /**
   * Apply device grouping to items and sort.
   * When `preserveOrder` is true (i.e. search results), items within
   * each group keep their incoming relevance order instead of being
   * re-sorted alphabetically.
   */
  private applyGrouping(
    items: readonly SearchableMenuItem[],
    options?: { preserveOrder?: boolean },
  ): SearchableMenuItem[] {
    const noDeviceLabel = this.strings.areaEntities.noDevice;

    const grouped = items.map((item, index): SearchableMenuItem & { _rank: number } => {
      const group = item.deviceName || noDeviceLabel;
      return { ...item, group, _rank: index };
    });

    // Sort: groups alphabetically, "No device" to bottom
    grouped.sort((a, b) => {
      const aNoDevice = a.group === noDeviceLabel ? 1 : 0;
      const bNoDevice = b.group === noDeviceLabel ? 1 : 0;
      if (aNoDevice !== bNoDevice) return aNoDevice - bNoDevice;

      // Alphabetical group order
      const groupCmp = (a.group ?? "").localeCompare(b.group ?? "");
      if (groupCmp !== 0) return groupCmp;

      // Within group: preserve search relevance order, or sort alphabetically
      if (options?.preserveOrder) return a._rank - b._rank;
      return a.title.localeCompare(b.title);
    });

    return grouped;
  }

  /** Rebuild and display the current item list with grouping applied */
  private rebuildAndDisplay(options?: { resetSelection?: boolean }): void {
    if (!this.areaId) return;

    if (this.filterText.length === 0) {
      // No filter — show all items grouped
      this.filteredItems = this.applyGrouping(this.allMenuItems);
    } else {
      // Filter active — search then group results
      const searchResults = twoPhaseSearch(
        this.allMenuItems,
        this.filterText,
        (item) => item.searchFields,
        FUSE_KEYS,
      );
      this.filteredItems = this.applyGrouping(searchResults, { preserveOrder: true });
    }

    this.hideStatus();
    this.menuList.setFilteredItems(this.filteredItems, options);
    this.updatePageIndicator();
  }

  // ── Search / Filter ───────────────────────────────────────────────────────

  private handleFilterChange(filter: string): void {
    this.filterText = filter;
    this.updateFilterBar(filter);
    this.rebuildAndDisplay();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private updateFilterBar(filter: string): void {
    const groupLabel = this.strings.entities.groupBy.device;
    if (filter.length === 0) {
      this.filterBar.content = t`${fg(this.theme.fgSubtle)("/")} ${dim(fg(this.theme.fgMuted)(groupLabel))}`;
    } else {
      this.filterBar.content = t`${fg(this.theme.accent)("/")} ${fg(this.theme.fg)(filter)} ${dim(fg(this.theme.fgMuted)(groupLabel))}`;
    }
  }

  private updatePageIndicator(): void {
    const total = this.filteredItems.length;
    const totalPages = this.menuList.totalPages;

    if (totalPages <= 1) {
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
}
