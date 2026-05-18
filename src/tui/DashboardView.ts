import type { CliRenderer } from "@opentui/core";
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
import { formatFilterBar } from "./filterBar.js";
import { MenuList } from "./MenuList.js";
import { ConnectedView, type ConnectedViewOptions } from "./ConnectedView.js";
import { fetchFrontendHomeData } from "../data/frontend.js";
import { getCommonControlsUsagePrediction } from "../data/usagePrediction.js";
import {
  fetchStateTranslations,
  translateEntityState,
  type LocalizeFunc,
} from "../data/stateTranslation.js";
import { resolveEntityIcon } from "../data/iconResolver.js";
import { mdiToNerdFont, DEFAULT_ICON } from "../data/iconResolver.js";
import {
  fetchAreaRegistry,
  type AreaRegistryEntry,
} from "../data/areaRegistry.js";
import {
  fetchEntityRegistry,
  type EntityRegistryEntry,
} from "../data/entityRegistry.js";
import {
  fetchDeviceRegistry,
  type DeviceRegistryEntry,
} from "../data/deviceRegistry.js";

const log = (msg: string) => console.error(`[ha-tui:DashboardView] ${msg}`);

/** Maximum entities to show; expands to accommodate more favorites. */
const DEFAULT_LIMIT = 8;

// ---------------------------------------------------------------------------

export interface DashboardViewOptions extends ConnectedViewOptions {
  /** Called when the user selects an area from the areas section */
  readonly onAreaSelect?: (areaId: string, areaName: string) => void;
}

/**
 * Dashboard view — shows favorites + usage-predicted entities with live state updates.
 *
 * Entity list is built from:
 *   1. `favorite_entities` stored in the HA frontend system data (key "home")
 *   2. Server-side usage-predicted common controls (usage_prediction/common_control)
 *
 * State updates are driven by a single shared `subscribeEntities` subscription
 * (via home-assistant-js-websocket's collection cache). The callback is memoised:
 * only entities in our display set are examined, and only rows whose `state`,
 * `last_changed`, or `friendly_name` actually changed are patched in-place via
 * `MenuList.patchItemById` — preserving selection and scroll position.
 *
 * Relative timestamps are refreshed every 60 s via a setInterval that only runs
 * while the view is visible.
 */
export class DashboardView extends ConnectedView {
  // Domain-specific state
  private localize: LocalizeFunc | null = null;
  private unsubEntities: UnsubscribeFunc | null = null;
  private entityIds: readonly string[] = [];
  /** Memoised per-entity state — used to skip unchanged entities on each callback. */
  private entityCache = new Map<string, HassEntity>();
  private isFirstEntityUpdate = true;

  // Area section state
  private areas: AreaRegistryEntry[] = [];
  private entityRegistry: EntityRegistryEntry[] = [];
  private deviceMap: Map<string, DeviceRegistryEntry> = new Map();
  private onAreaSelect:
    | ((areaId: string, areaName: string) => void)
    | undefined;

  // Relative-time refresh timer (only runs when visible)
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    renderer: CliRenderer,
    theme: Theme,
    strings: Locale,
    options: DashboardViewOptions,
  ) {
    super(renderer, theme, strings, options, {
      idPrefix: "dashboard",
      viewTitle: strings.menu.dashboard.title,
      initialStatus: "Connecting\u2026",
    });

    this.onAreaSelect = options.onAreaSelect;
  }

  // ── ConnectedView hooks ───────────────────────────────────────────────────

  protected buildHelp(): readonly HelpEntry[] {
    return [
      { key: this.strings.keys.arrowsUD, action: this.strings.help.navigate },
      { key: this.strings.keys.enter, action: this.strings.help.select },
      { key: this.strings.keys.typeInput, action: this.strings.help.filter },
      { key: this.strings.keys.esc, action: this.strings.help.back },
      { key: this.strings.keys.backspace, action: this.strings.help.back },
      ...globalHelp(this.strings),
    ];
  }

  protected createMenuList(): MenuList {
    return new MenuList(this.renderer, {
      id: "dashboard-list",
      items: [],
      theme: this.theme,
      onSelect: (item) => {
        // Check if this is an area item (prefixed with "area:")
        if (item.id.startsWith("area:") && this.onAreaSelect) {
          const areaId = item.id.slice(5); // Remove "area:" prefix
          this.onAreaSelect(areaId, item.title);
        }
      },
      onFilterChange: (filter) => this.updateFilterBar(filter),
      onEscape: () => this.callbacks.onBack(),
      onBack: () => this.callbacks.onBack(),
      wrapSelection: true,
    });
  }

  protected async doInitialize(conn: Connection): Promise<void> {
    log("Fetching favorites, usage prediction, and areas");
    this.showStatus("Loading\u2026");

    try {
      const [
        homeResult,
        predictedResult,
        localizeResult,
        areasResult,
        entityRegistryResult,
        deviceRegistryResult,
      ] = await Promise.allSettled([
        fetchFrontendHomeData(conn),
        getCommonControlsUsagePrediction(conn),
        fetchStateTranslations(conn),
        fetchAreaRegistry(conn),
        fetchEntityRegistry(conn),
        fetchDeviceRegistry(conn),
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

      if (areasResult.status === "fulfilled") {
        this.areas = areasResult.value;
        log(`Areas loaded: ${this.areas.length}`);
      } else {
        log(`Failed to fetch areas: ${String(areasResult.reason)}`);
      }

      if (entityRegistryResult.status === "fulfilled") {
        this.entityRegistry = entityRegistryResult.value;
      } else {
        log(
          `Failed to fetch entity registry: ${String(entityRegistryResult.reason)}`,
        );
      }

      if (deviceRegistryResult.status === "fulfilled") {
        this.deviceMap = new Map(
          deviceRegistryResult.value.map((d) => [d.id, d]),
        );
      } else {
        log(
          `Failed to fetch device registry: ${String(deviceRegistryResult.reason)}`,
        );
      }

      const favorites =
        homeResult.status === "fulfilled"
          ? (homeResult.value?.favorite_entities ?? [])
          : [];

      if (homeResult.status === "rejected") {
        log(`Failed to fetch home data: ${String(homeResult.reason)}`);
      }
      if (predictedResult.status === "rejected") {
        log(`Usage prediction unavailable: ${String(predictedResult.reason)}`);
      }

      const predicted =
        predictedResult.status === "fulfilled"
          ? predictedResult.value.entities
          : [];

      // Merge: favorites first, then predicted, dedup, cap at limit
      const limit = Math.max(DEFAULT_LIMIT, favorites.length);
      const seen = new Set<string>(favorites);
      const merged = [...favorites];
      for (const id of predicted) {
        if (!seen.has(id) && merged.length < limit) {
          seen.add(id);
          merged.push(id);
        }
      }

      log(`Entity list (${merged.length}): ${merged.join(", ")}`);
      this.entityIds = merged;

      if (merged.length === 0 && this.areas.length === 0) {
        this.showStatus("No entities — add favorites in Home Assistant");
        return;
      }

      // Subscribe to entity states — first callback populates the list,
      // subsequent callbacks patch only changed rows in-place.
      this.isFirstEntityUpdate = true;
      this.unsubEntities = subscribeEntities(conn, (entities) => {
        if (this.conn !== conn) return; // stale subscription guard
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
    this.entityCache.clear();
    this.entityIds = [];
    this.areas = [];
    this.entityRegistry = [];
    this.deviceMap = new Map();
    this.isFirstEntityUpdate = true;
    this.stopRefreshTimer();
  }

  protected override onBecameVisible(): void {
    this.startRefreshTimer();
    this.refreshTimestamps();
  }

  protected override onBecameHidden(): void {
    this.stopRefreshTimer();
  }

  // ── Entity state handling ─────────────────────────────────────────────────

  private handleEntityUpdate(allEntities: HassEntities): void {
    if (this.entityIds.length === 0) return;

    if (this.isFirstEntityUpdate) {
      this.isFirstEntityUpdate = false;
      this.populateInitialItems(allEntities);
      return;
    }

    this.applyIncrementalUpdates(allEntities);
  }

  /**
   * First entities snapshot: build the full item list preserving display order.
   * Includes entity favorites/predicted items followed by the areas section.
   */
  private populateInitialItems(allEntities: HassEntities): void {
    const items: MenuItem[] = [];
    for (const entityId of this.entityIds) {
      const entity = allEntities[entityId];
      if (!entity) continue;
      this.entityCache.set(entityId, entity);
      items.push(this.entityToMenuItem(entity));
    }

    // Append visible areas (areas that have at least one entity)
    const areaItems = this.buildAreaItems(allEntities);
    items.push(...areaItems);

    this.hideStatus();
    this.menuList.setItems(items);
  }

  /**
   * Subsequent entity callbacks: only patch rows whose state, last_changed,
   * or friendly_name actually changed — preserving selection and scroll.
   */
  private applyIncrementalUpdates(allEntities: HassEntities): void {
    for (const entityId of this.entityIds) {
      const entity = allEntities[entityId];
      if (!entity) continue;

      const cached = this.entityCache.get(entityId);
      if (!cached) continue; // not yet in cache — will be handled on next full pass

      const stateChanged =
        cached.state !== entity.state ||
        cached.last_changed !== entity.last_changed;
      const nameChanged =
        cached.attributes.friendly_name !== entity.attributes.friendly_name;

      if (!stateChanged && !nameChanged) continue;

      this.entityCache.set(entityId, entity);

      const patch: { title?: string; description?: string } = {};
      if (nameChanged) {
        patch.title = entity.attributes.friendly_name ?? entity.entity_id;
      }
      patch.description = this.formatDescription(entity);
      this.menuList.patchItemById(entityId, patch);
    }
  }

  /**
   * Refresh relative timestamps for all cached entities.
   * Called on visibility, and every 60 s by the refresh timer.
   */
  private refreshTimestamps(): void {
    for (const entityId of this.entityIds) {
      const entity = this.entityCache.get(entityId);
      if (!entity) continue;
      this.menuList.patchItemById(entityId, {
        description: this.formatDescription(entity),
      });
    }
  }

  // ── Timer ─────────────────────────────────────────────────────────────────

  private startRefreshTimer(): void {
    if (this.refreshTimer !== null) return;
    this.refreshTimer = setInterval(() => {
      this.refreshTimestamps();
    }, 60_000);
  }

  private stopRefreshTimer(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Build area menu items for the "Areas" group section.
   * Only includes areas that have at least one non-disabled, non-unavailable entity.
   */
  private buildAreaItems(allEntities: HassEntities): MenuItem[] {
    if (this.areas.length === 0) return [];

    // Build a set of area IDs that have visible entities
    const visibleAreaIds = new Set<string>();
    for (const entry of this.entityRegistry) {
      if (entry.disabled_by != null) continue;
      const entity = allEntities[entry.entity_id];
      if (!entity || entity.state === "unavailable") continue;

      // Determine entity's area: direct assignment or via device
      const device = entry.device_id
        ? this.deviceMap.get(entry.device_id)
        : undefined;
      const areaId = entry.area_id ?? device?.area_id ?? null;
      if (areaId) visibleAreaIds.add(areaId);
    }

    const groupLabel = this.strings.dashboard.areasGroup;
    const items: MenuItem[] = [];

    // Sort areas alphabetically by name
    const sortedAreas = [...this.areas]
      .filter((a) => visibleAreaIds.has(a.area_id))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const area of sortedAreas) {
      const icon = area.icon
        ? (mdiToNerdFont(area.icon) ?? DEFAULT_ICON)
        : DEFAULT_ICON;
      items.push({
        id: `area:${area.area_id}`,
        icon,
        title: area.name,
        description: "",
        action: { type: "noop" },
        group: groupLabel,
      });
    }

    return items;
  }

  private entityToMenuItem(entity: HassEntity): MenuItem {
    return {
      id: entity.entity_id,
      icon: resolveEntityIcon(entity),
      title: entity.attributes.friendly_name ?? entity.entity_id,
      description: this.formatDescription(entity),
      action: { type: "noop" },
      group: this.strings.dashboard.favoritesGroup,
    };
  }

  private formatDescription(entity: HassEntity): string {
    const stateDisplay = this.localize
      ? translateEntityState(entity, this.localize)
      : entity.state;
    const rel = this.formatRelativeTime(entity.last_changed);
    return rel ? `${stateDisplay} · ${rel}` : stateDisplay;
  }

  private formatRelativeTime(isoString: string): string {
    const secs = Math.floor((Date.now() - Date.parse(isoString)) / 1000);
    if (secs < 5) return this.strings.status.justNow;
    if (secs < 60) return this.strings.status.ago.seconds(secs);
    const mins = Math.floor(secs / 60);
    if (mins < 60) return this.strings.status.ago.minutes(mins);
    return this.strings.status.ago.hours(Math.floor(mins / 60));
  }

  private updateFilterBar(filter: string): void {
    this.filterBar.content = formatFilterBar(this.theme, filter);
  }
}
