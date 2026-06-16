import {
  type CliRenderer,
  type KeyEvent,
  ScrollBoxRenderable,
  t,
  fg,
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
import type { Theme } from "../theme.js";
import type { Locale } from "../i18n/index.js";
import { globalHelp, type HelpEntry } from "./helpBar.js";
import { MenuList } from "./MenuList.js";
import {
  MenuGrid,
  type MenuGridItem,
  type MenuGridSection,
} from "./MenuGrid.js";
import { ConnectedView, type ConnectedViewOptions } from "./ConnectedView.js";
import { EntityActionHandler } from "./entityActions.js";
import {
  areaDefaultMdi,
  DEFAULT_ICON,
  resolveAreaIcon,
  resolveEntityIcon,
  resolveFloorIcon,
  resolveMdiIcon,
} from "../data/iconResolver.js";
import { fetchFrontendHomeData } from "../data/frontend.js";
import { getCommonControlsUsagePrediction } from "../data/usagePrediction.js";
import {
  fetchStateTranslations,
  translateEntityState,
  type LocalizeFunc,
} from "../data/stateTranslation.js";
import { getAreasFloorHierarchy } from "../data/areasFloorHierarchy.js";
import {
  fetchAreaRegistry,
  type AreaRegistryEntry,
} from "../data/areaRegistry.js";
import {
  fetchFloorRegistry,
  type FloorRegistryEntry,
} from "../data/floorRegistry.js";
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
  /** Called when the user selects an area tile */
  readonly onAreaSelect?: (areaId: string, areaName: string) => void;
}

/**
 * Dashboard view — favorites, predicted entities, and areas as tile grids.
 *
 * A single view-level scroll box contains all sections; each section starts
 * with a full-width heading row, then wrapping tiles.
 */
export class DashboardView extends ConnectedView {
  private localize: LocalizeFunc | null = null;
  private unsubEntities: UnsubscribeFunc | null = null;
  private entityIds: readonly string[] = [];
  private entityCache = new Map<string, HassEntity>();
  private isFirstEntityUpdate = true;

  private scroll: ScrollBoxRenderable;
  private grid: MenuGrid;
  private areaNames = new Map<string, string>();

  private areas: AreaRegistryEntry[] = [];
  private floors: FloorRegistryEntry[] = [];
  private entityRegistry: EntityRegistryEntry[] = [];
  private deviceMap = new Map<string, DeviceRegistryEntry>();
  private onAreaSelect:
    | ((areaId: string, areaName: string) => void)
    | undefined;

  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private entityActions: EntityActionHandler;

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

    this.root.remove(this.filterBar.id);
    this.root.remove(this.menuList.id);

    this.scroll = new ScrollBoxRenderable(renderer, {
      id: "dashboard-scroll",
      flexGrow: 1,
      width: "100%",
      scrollY: true,
      scrollX: false,
      focusable: false,
      contentOptions: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 1,
      },
    });

    this.grid = new MenuGrid(renderer, theme, {
      id: "dashboard-grid",
      scroll: this.scroll,
    });

    this.root.insertBefore(this.scroll, this.helpBar);

    this.entityActions = new EntityActionHandler({
      getConn: () => this.conn,
      getEntityState: (entityId) => this.entityCache.get(entityId),
      getSelectedEntityId: () =>
        this.grid.hasEntries() ? this.getSelectedEntityId() : undefined,
      baseUrl: this.baseUrl,
      renderer: this.renderer,
      theme: this.theme,
      strings: this.strings,
      toast: this.toast,
      menuList: this.menuList,
    });
  }

  handleKeyPress(key: KeyEvent): boolean {
    if (key.name === "escape" || key.name === "backspace") {
      this.callbacks.onBack();
      return true;
    }

    if (this.entityActions.hasPopup) {
      return this.entityActions.handleKeyPress(key);
    }

    if (this.grid.handleKeyPress(key)) {
      return true;
    }

    if (key.name === "return") {
      const selectedId = this.grid.getSelectedId();
      if (selectedId?.startsWith("area:")) {
        const areaId = selectedId.slice(5);
        const areaName = this.areaNames.get(areaId) ?? areaId;
        this.onAreaSelect?.(areaId, areaName);
        return true;
      }
      return this.entityActions.handleKeyPress(key);
    }

    return this.entityActions.handleKeyPress(key);
  }

  override focus(): void {
    if (!this.isVisible) return;
    this.grid.focus();
  }

  override blur(): void {
    this.grid.blur();
  }

  override resetAndFocus(): void {
    this.grid.resetSelection();
    if (this.isVisible) {
      this.focus();
    }
  }

  protected buildHelp(): readonly HelpEntry[] {
    return [
      { key: "←→↑↓", action: this.strings.help.navigate },
      { key: this.strings.keys.enter, action: this.strings.help.toggle },
      { key: this.strings.keys.ctrl.y, action: this.strings.help.copyId },
      { key: this.strings.keys.ctrl.w, action: this.strings.help.openInfo },
      { key: this.strings.keys.ctrl.s, action: this.strings.help.openSettings },
      { key: this.strings.keys.ctrl.d, action: this.strings.help.openDetails },
      { key: this.strings.keys.ctrl.h, action: this.strings.help.openHistory },
      { key: this.strings.keys.ctrl.r, action: this.strings.help.openRelated },
      { key: this.strings.keys.esc, action: this.strings.help.back },
      ...globalHelp(this.strings),
    ];
  }

  /** Stub list — keyboard is routed via {@link handleKeyPress} instead. */
  protected createMenuList(): MenuList {
    return new MenuList(this.renderer, {
      id: "dashboard-list-stub",
      items: [],
      theme: this.theme,
      onSelect: () => {},
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
        floorsResult,
        entityRegistryResult,
        deviceRegistryResult,
      ] = await Promise.allSettled([
        fetchFrontendHomeData(conn),
        getCommonControlsUsagePrediction(conn),
        fetchStateTranslations(conn),
        fetchAreaRegistry(conn),
        fetchFloorRegistry(conn),
        fetchEntityRegistry(conn),
        fetchDeviceRegistry(conn),
      ]);

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

      if (floorsResult.status === "fulfilled") {
        this.floors = floorsResult.value;
        log(`Floors loaded: ${this.floors.length}`);
      } else {
        log(`Failed to fetch floors: ${String(floorsResult.reason)}`);
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
    this.entityCache.clear();
    this.entityIds = [];
    this.grid.clear();
    this.areaNames.clear();
    this.areas = [];
    this.floors = [];
    this.entityRegistry = [];
    this.deviceMap = new Map();
    this.isFirstEntityUpdate = true;
    this.stopRefreshTimer();
  }

  protected override showStatus(message: string): void {
    this.grid.clear();
    this.scroll.visible = false;
    if (!this.statusVisible) {
      this.root.insertBefore(this.statusText, this.scroll);
      this.statusVisible = true;
    }
    this.statusText.content = t`${fg(this.theme.fgMuted)(message)}`;
  }

  protected override onBecameVisible(): void {
    this.startRefreshTimer();
    this.refreshTimestamps();
    if (this.grid.hasEntries()) {
      this.grid.focus();
    }
  }

  protected override onBecameHidden(): void {
    this.stopRefreshTimer();
  }

  private handleEntityUpdate(allEntities: HassEntities): void {
    if (this.isFirstEntityUpdate) {
      this.isFirstEntityUpdate = false;
      this.populateGrids(allEntities);
      return;
    }

    if (this.entityIds.length > 0) {
      this.applyIncrementalUpdates(allEntities);
    }
  }

  private populateGrids(allEntities: HassEntities): void {
    const favoriteItems: Array<MenuGridItem> = [];

    for (const entityId of this.entityIds) {
      const entity = allEntities[entityId];
      if (!entity) continue;
      this.entityCache.set(entityId, entity);
      favoriteItems.push(this.entityToGridItem(entity));
    }

    const areaSections = this.buildAreaSections(allEntities);
    const sections: Array<MenuGridSection> = [];

    if (favoriteItems.length > 0) {
      sections.push({
        id: "favorites",
        title: this.strings.dashboard.favoritesGroup,
        items: favoriteItems,
      });
    }

    sections.push(...areaSections);

    if (sections.length === 0) {
      this.showStatus("No entities — add favorites in Home Assistant");
      return;
    }

    this.grid.setSections(sections);
    this.scroll.visible = true;
    this.hideStatus();
    if (this.isVisible) {
      this.focus();
    }
  }

  private applyIncrementalUpdates(allEntities: HassEntities): void {
    for (const entityId of this.entityIds) {
      const entity = allEntities[entityId];
      if (!entity) continue;

      const cached = this.entityCache.get(entityId);
      if (!cached) continue;

      const stateChanged =
        cached.state !== entity.state ||
        cached.last_changed !== entity.last_changed;
      const nameChanged =
        cached.attributes.friendly_name !== entity.attributes.friendly_name;

      if (!stateChanged && !nameChanged) continue;

      this.entityCache.set(entityId, entity);
      this.grid.updateItem(entityId, {
        primary: entity.attributes.friendly_name ?? entity.entity_id,
        secondary: this.entityTileSecondary(entity),
      });
    }
  }

  private refreshTimestamps(): void {
    for (const entityId of this.entityIds) {
      const entity = this.entityCache.get(entityId);
      if (!entity) continue;
      this.grid.updateItem(entityId, {
        secondary: this.entityTileSecondary(entity),
      });
    }
  }

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

  private buildAreaSections(allEntities: HassEntities): Array<MenuGridSection> {
    this.areaNames.clear();
    if (this.areas.length === 0) return [];

    const visibleAreaIds = this.getVisibleAreaIds(allEntities);
    if (visibleAreaIds.size === 0) return [];

    const areaById = new Map(
      this.areas.map((area) => [area.area_id, area] as const),
    );
    const floorById = new Map(
      this.floors.map((floor) => [floor.floor_id, floor] as const),
    );
    const home = getAreasFloorHierarchy(this.floors, this.areas);
    const floorCount = home.floors.length + (home.areas.length > 0 ? 1 : 0);
    const sections: Array<MenuGridSection> = [];

    for (const floorStructure of home.floors) {
      const items = this.visibleAreasToGridItems(
        floorStructure.areas,
        visibleAreaIds,
        areaById,
      );
      if (items.length === 0) continue;

      const floor = floorById.get(floorStructure.id);
      const title =
        floorCount > 1 && floor
          ? floor.name
          : this.strings.dashboard.areasGroup;
      const icon = floor ? resolveFloorIcon(floor) : undefined;

      sections.push({
        id: `floor:${floorStructure.id}`,
        title,
        icon,
        items,
      });
    }

    const otherItems = this.visibleAreasToGridItems(
      home.areas,
      visibleAreaIds,
      areaById,
    );
    if (otherItems.length > 0) {
      const title =
        floorCount > 1
          ? this.strings.dashboard.otherAreasGroup
          : this.strings.dashboard.areasGroup;

      sections.push({
        id: "areas-other",
        title,
        icon:
          floorCount > 1
            ? resolveMdiIcon(areaDefaultMdi(), DEFAULT_ICON)
            : undefined,
        items: otherItems,
      });
    }

    return sections;
  }

  private getVisibleAreaIds(allEntities: HassEntities): Set<string> {
    const visibleAreaIds = new Set<string>();
    for (const entry of this.entityRegistry) {
      if (entry.disabled_by != null) continue;
      const entity = allEntities[entry.entity_id];
      if (!entity || entity.state === "unavailable") continue;

      const device = entry.device_id
        ? this.deviceMap.get(entry.device_id)
        : undefined;
      const areaId = entry.area_id ?? device?.area_id ?? null;
      if (areaId) visibleAreaIds.add(areaId);
    }
    return visibleAreaIds;
  }

  private visibleAreasToGridItems(
    areaIds: ReadonlyArray<string>,
    visibleAreaIds: Set<string>,
    areaById: ReadonlyMap<string, AreaRegistryEntry>,
  ): Array<MenuGridItem> {
    const items: Array<MenuGridItem> = [];

    for (const areaId of areaIds) {
      if (!visibleAreaIds.has(areaId)) continue;
      const area = areaById.get(areaId);
      if (!area) continue;

      this.areaNames.set(area.area_id, area.name);
      items.push({
        id: `area:${area.area_id}`,
        primary: area.name,
        icon: resolveAreaIcon(area),
      });
    }

    return items.sort((a, b) => a.primary.localeCompare(b.primary));
  }

  private entityToGridItem(entity: HassEntity): MenuGridItem {
    return {
      id: entity.entity_id,
      primary: entity.attributes.friendly_name ?? entity.entity_id,
      secondary: this.entityTileSecondary(entity),
      icon: resolveEntityIcon(entity),
    };
  }

  private entityTileSecondary(entity: HassEntity): readonly string[] {
    const stateDisplay = this.localize
      ? translateEntityState(entity, this.localize)
      : entity.state;
    const rel = this.formatRelativeTime(entity.last_changed);
    return rel ? [stateDisplay, rel] : [stateDisplay];
  }

  private formatRelativeTime(isoString: string): string {
    const secs = Math.floor((Date.now() - Date.parse(isoString)) / 1000);
    if (secs < 5) return this.strings.status.justNow;
    if (secs < 60) return this.strings.status.ago.seconds(secs);
    const mins = Math.floor(secs / 60);
    if (mins < 60) return this.strings.status.ago.minutes(mins);
    return this.strings.status.ago.hours(Math.floor(mins / 60));
  }

  private getSelectedEntityId(): string | undefined {
    const id = this.grid.getSelectedId();
    if (!id || id.startsWith("area:")) {
      return undefined;
    }
    return id;
  }
}
