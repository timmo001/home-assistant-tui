import {
  type CliRenderer,
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
import type { Theme } from "../theme.js";
import type { Locale } from "../i18n/index.js";
import { globalHelp, type HelpEntry } from "./helpBar.js";
import { MenuList } from "./MenuList.js";
import { ConnectedView, type ConnectedViewOptions } from "./ConnectedView.js";
import {
  fetchEntityRegistry,
  subscribeEntityRegistryUpdates,
  type EntityRegistryEntry,
} from "../data/entityRegistry.js";
import {
  fetchDeviceRegistry,
  computeDeviceName,
  type DeviceRegistryEntry,
} from "../data/deviceRegistry.js";
import {
  fetchAreaRegistry,
  type AreaRegistryEntry,
} from "../data/areaRegistry.js";
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
const PAGE_SIZE = 50;

/** Grouping modes for the entity list */
type GroupMode = "area" | "device" | "integration" | "domain";

/** Cycle order for Ctrl+G */
const GROUP_MODES: readonly GroupMode[] = ["area", "device", "integration", "domain"];

// ---------------------------------------------------------------------------

export type EntitiesViewOptions = ConnectedViewOptions;

/** MenuItem augmented with searchable fields and grouping metadata */
interface SearchableMenuItem extends MenuItem {
  readonly searchFields: readonly string[];
  /** Domain for domain grouping */
  readonly domain: string;
  /** Device display name for device grouping */
  readonly deviceName: string;
  /** Area display name for area grouping */
  readonly areaName: string;
  /** Integration (platform) display name for integration grouping */
  readonly integrationName: string;
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
 *   - Device registry (`config/device_registry/list`) for device names
 *   - Area registry (`config/area_registry/list`) for area names
 *   - `subscribeEntities` for live state values
 *
 * Grouping modes (Ctrl+G to cycle):
 *   - Area (default): group by area name, sort area→entity
 *   - Device: group by device name, sort device→entity
 *   - Domain: group by entity domain, sort domain→entity
 *   - Integration: group by platform name
 */
export class EntitiesView extends ConnectedView {
  // Domain-specific state
  private localize: LocalizeFunc | null = null;
  private unsubEntities: UnsubscribeFunc | null = null;
  private unsubRegistry: (() => void) | null = null;
  private registryEntries: EntityRegistryEntry[] = [];
  private deviceMap: Map<string, DeviceRegistryEntry> = new Map();
  private areaMap: Map<string, AreaRegistryEntry> = new Map();
  private entityStates: HassEntities = {};
  private isFirstEntityUpdate = true;

  // Grouping mode
  private groupMode: GroupMode = "area";

  // Full merged item list (all entities)
  private allMenuItems: SearchableMenuItem[] = [];
  // Current filtered subset (what's passed to the paginated MenuList)
  private filteredItems: readonly SearchableMenuItem[] = [];
  private filterText = "";

  // Pagination info text (shown on the filter bar line)
  private pageInfoText = "";

  constructor(
    renderer: CliRenderer,
    theme: Theme,
    strings: Locale,
    options: EntitiesViewOptions,
  ) {
    super(renderer, theme, strings, options, {
      idPrefix: "entities",
      viewTitle: strings.menu.entities.title,
      initialStatus: strings.entities.loading,
    });
  }

  // ── ConnectedView hooks ───────────────────────────────────────────────────

  protected buildHelp(): readonly HelpEntry[] {
    return [
      { key: this.strings.keys.arrowsUD, action: this.strings.help.navigate },
      { key: this.strings.keys.enter, action: this.strings.help.select },
      { key: this.strings.keys.typeInput, action: this.strings.help.filter },
      { key: this.strings.keys.ctrlG, action: this.strings.help.groupBy },
      { key: this.strings.keys.pgUpDn, action: this.strings.help.nextPage },
      { key: this.strings.keys.esc, action: this.strings.help.back },
      ...globalHelp(this.strings),
    ];
  }

  protected createMenuList(): MenuList {
    return new MenuList(this.renderer, {
      id: "entities-list",
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
      onKeyPress: (key) => this.handleKeyPress(key),
      wrapSelection: false,
    });
  }

  protected async doInitialize(conn: Connection): Promise<void> {
    log("Fetching registries and translations");
    this.showStatus(this.strings.entities.loading);

    try {
      const [registryResult, deviceResult, areaResult, localizeResult] =
        await Promise.allSettled([
          fetchEntityRegistry(conn),
          fetchDeviceRegistry(conn),
          fetchAreaRegistry(conn),
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
        log(`Device registry loaded: ${this.deviceMap.size} entries`);
      } else {
        log(`Failed to fetch device registry: ${String(deviceResult.reason)}`);
      }

      if (areaResult.status === "fulfilled") {
        this.areaMap = new Map(areaResult.value.map((a) => [a.area_id, a]));
        log(`Area registry loaded: ${this.areaMap.size} entries`);
      } else {
        log(`Failed to fetch area registry: ${String(areaResult.reason)}`);
      }

      if (registryResult.status === "rejected") {
        log(`Failed to fetch entity registry: ${String(registryResult.reason)}`);
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

  protected doCleanup(): void {
    this.unsubEntities?.();
    this.unsubEntities = null;
    this.unsubRegistry?.();
    this.unsubRegistry = null;
    this.localize = null;
    this.registryEntries = [];
    this.deviceMap = new Map();
    this.areaMap = new Map();
    this.entityStates = {};
    this.allMenuItems = [];
    this.filteredItems = [];
    this.filterText = "";
    this.isFirstEntityUpdate = true;
  }

  // ── Public API overrides ──────────────────────────────────────────────────

  override resetAndFocus(): void {
    this.filterText = "";
    this.rebuildAndDisplay({ resetSelection: true });
    this.updateFilterBar("");
    this.menuList.focus();
  }

  override showStatus(message: string): void {
    super.showStatus(message);
    this.pageInfoText = "";
    this.updateFilterBar(this.filterText);
  }

  // ── Initialization helpers ────────────────────────────────────────────────

  private async refetchRegistry(conn: Connection): Promise<void> {
    try {
      const entries = await fetchEntityRegistry(conn);
      if (this.conn !== conn) return;
      this.registryEntries = entries;
      this.buildAllMenuItems();
      this.rebuildAndDisplay();
    } catch (err) {
      log(`Failed to refetch entity registry: ${String(err)}`);
    }
  }

  // ── Entity state handling ─────────────────────────────────────────────────

  private handleEntityUpdate(allEntities: HassEntities): void {
    this.entityStates = allEntities;
    this.buildAllMenuItems();

    if (this.isFirstEntityUpdate) {
      this.isFirstEntityUpdate = false;
      this.rebuildAndDisplay();
      return;
    }

    // Incremental updates — refresh the displayed list
    this.rebuildAndDisplay();
  }

  // ── Item building ─────────────────────────────────────────────────────────

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

    // Resolve device and area for grouping
    const device = entry.device_id ? this.deviceMap.get(entry.device_id) : undefined;
    const deviceName = device ? computeDeviceName(device) : "";

    // Area: prefer entity's area_id, fall back to device's area_id
    const areaId = entry.area_id ?? device?.area_id ?? null;
    const area = areaId ? this.areaMap.get(areaId) : undefined;
    const areaName = area?.name ?? "";

    // Integration: localized platform name
    const integrationName = entry.platform
      ? entry.platform.charAt(0).toUpperCase() +
        entry.platform.slice(1).replace(/_/g, " ")
      : "";

    // Searchable fields for the two-phase algorithm
    const searchFields: string[] = [
      name,
      entry.entity_id,
      entry.platform,
      domain,
      stateDisplay,
    ];
    if (areaName) searchFields.push(areaName);
    if (deviceName) searchFields.push(deviceName);

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
      domain,
      deviceName,
      areaName,
      integrationName,
      // group is assigned dynamically in applyGrouping()
      group: undefined,
    };
  }

  // ── Grouping & sorting ────────────────────────────────────────────────────

  /**
   * Apply current group mode to items, set group labels, and sort.
   * When `preserveOrder` is true (i.e. search results), items within
   * each group keep their incoming relevance order instead of being
   * re-sorted alphabetically.
   */
  private applyGrouping(
    items: readonly SearchableMenuItem[],
    options?: { preserveOrder?: boolean },
  ): SearchableMenuItem[] {
    const s = this.strings.entities;
    const ungroupedLabels = new Set([
      s.ungrouped.device,
      s.ungrouped.domain,
      s.ungrouped.area,
      s.ungrouped.integration,
    ]);

    const grouped = items.map((item, index): SearchableMenuItem & { _rank: number } => {
      let group: string;
      switch (this.groupMode) {
        case "area":
          group = item.areaName || s.ungrouped.area;
          break;
        case "device":
          group = item.deviceName || s.ungrouped.device;
          break;
        case "integration":
          group = item.integrationName || s.ungrouped.integration;
          break;
        case "domain":
          // Capitalize domain: "light" → "Light", "binary_sensor" → "Binary sensor"
          group = item.domain
            ? item.domain.charAt(0).toUpperCase() +
              item.domain.slice(1).replace(/_/g, " ")
            : s.ungrouped.domain;
          break;
      }
      return { ...item, group, _rank: index };
    });

    // Sort: groups alphabetically, ungrouped to bottom
    grouped.sort((a, b) => {
      const aUngrouped = ungroupedLabels.has(a.group!) ? 1 : 0;
      const bUngrouped = ungroupedLabels.has(b.group!) ? 1 : 0;
      if (aUngrouped !== bUngrouped) return aUngrouped - bUngrouped;

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

  // ── Grouping toggle ───────────────────────────────────────────────────────

  private cycleGroupMode(): void {
    const currentIdx = GROUP_MODES.indexOf(this.groupMode);
    this.groupMode = GROUP_MODES[(currentIdx + 1) % GROUP_MODES.length];
    log(`Group mode changed to: ${this.groupMode}`);
    this.rebuildAndDisplay({ resetSelection: true });
  }

  // ── Search / Filter ───────────────────────────────────────────────────────

  private handleFilterChange(filter: string): void {
    this.filterText = filter;
    this.updateFilterBar(filter);
    this.rebuildAndDisplay();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private updateFilterBar(filter: string): void {
    const modeLabel = this.groupModeLabel();
    const pageInfo = this.pageInfoText;
    const suffix = pageInfo
      ? `${modeLabel}  ${pageInfo}`
      : modeLabel;
    if (filter.length === 0) {
      this.filterBar.content = t`${fg(this.theme.fgSubtle)("/")} ${dim(fg(this.theme.fgMuted)(suffix))}`;
    } else {
      this.filterBar.content = t`${fg(this.theme.accent)("/")} ${fg(this.theme.fg)(filter)} ${dim(fg(this.theme.fgMuted)(suffix))}`;
    }
  }

  private groupModeLabel(): string {
    const s = this.strings.entities;
    switch (this.groupMode) {
      case "device":
        return s.groupBy.device;
      case "domain":
        return s.groupBy.domain;
      case "area":
        return s.groupBy.area;
      case "integration":
        return s.groupBy.integration;
    }
  }

  private updatePageIndicator(): void {
    const total = this.filteredItems.length;
    const totalPages = this.menuList.totalPages;

    if (totalPages <= 1) {
      this.pageInfoText = "";
      this.updateFilterBar(this.filterText);
      return;
    }

    const page = this.menuList.currentPage + 1;
    const pageText = this.strings.entities.pageOf(page, totalPages);
    const countText = this.strings.entities.totalCount(total);
    this.pageInfoText = `${pageText} · ${countText}`;
    this.updateFilterBar(this.filterText);
  }

  /** Handle extra key bindings not consumed by MenuList */
  private handleKeyPress(key: KeyEvent): boolean {
    // Ctrl+G: cycle grouping mode
    if (key.name === "g" && key.ctrl) {
      this.cycleGroupMode();
      this.updateFilterBar(this.filterText);
      return true;
    }
    return false;
  }
}
