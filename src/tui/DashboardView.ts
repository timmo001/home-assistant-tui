import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  t,
  fg,
} from "@opentui/core";
import {
  subscribeEntities,
  type UnsubscribeFunc,
} from "home-assistant-js-websocket";
import type { Connection, HassEntity, HassEntities } from "home-assistant-js-websocket";
import type { MenuItem } from "../types.js";
import type { ConnectionInfo } from "../types.js";
import type { Theme } from "../theme.js";
import type { Locale } from "../i18n/index.js";
import { formatHelpBar, globalHelp, type HelpEntry } from "./helpBar.js";
import { formatHeaderBar } from "./headerBar.js";
import { MenuList } from "./MenuList.js";
import { fetchFrontendHomeData } from "../data/frontend.js";
import { getCommonControlsUsagePrediction } from "../data/usagePrediction.js";

const log = (msg: string) => console.error(`[ha-tui:DashboardView] ${msg}`);

/** Maximum entities to show; expands to accommodate more favorites. */
const DEFAULT_LIMIT = 8;

/**
 * Nerd Font glyph per HA domain.
 * Mirrors the MDI icon mapping in the HA frontend, adapted for terminal rendering.
 */
const DOMAIN_ICONS: Record<string, string> = {
  light: "󰌵",
  switch: "󰔡",
  sensor: "󰓅",
  binary_sensor: "󰝣",
  climate: "󰔏",
  media_player: "󰋹",
  person: "󰀄",
  device_tracker: "󰍎",
  automation: "󱙵",
  script: "󱃺",
  scene: "󰠗",
  input_boolean: "󰔡",
  cover: "󱢐",
  lock: "󰌾",
  fan: "󰈐",
  vacuum: "󱦚",
  weather: "󰖐",
  button: "󰏠",
  update: "󰚰",
  number: "󰛯",
  select: "󰍦",
  input_number: "󰎡",
  input_select: "󰍦",
  input_text: "󰚒",
  timer: "󰔛",
  counter: "󰃬",
  calendar: "󰃰",
  camera: "󱤃",
};

const DEFAULT_ICON = "󰈚";

// ---------------------------------------------------------------------------

export interface DashboardViewOptions {
  /** Called when the user navigates back */
  readonly onBack: () => void;
  /** Root title for the breadcrumb (e.g. the app name) */
  readonly rootTitle?: string;
  /** Called when the title changes so the terminal tab can be updated */
  readonly onTitleChange?: (titleParts: readonly string[]) => void;
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
export class DashboardView {
  private renderer: CliRenderer;
  private theme: Theme;
  private strings: Locale;
  private callbacks: DashboardViewOptions;
  private titleParts: readonly string[];

  private root: BoxRenderable;
  private headerBar: TextRenderable;
  private filterBar: TextRenderable;
  private statusText: TextRenderable;
  private menuList: MenuList;
  private helpBar: TextRenderable;
  private help: readonly HelpEntry[];

  // Connection / subscription state
  private conn: Connection | null = null;
  private unsubEntities: UnsubscribeFunc | null = null;
  private entityIds: readonly string[] = [];
  /** Memoised per-entity state — used to skip unchanged entities on each callback. */
  private entityCache = new Map<string, HassEntity>();
  private isFirstEntityUpdate = true;
  private initializationInProgress = false;

  // Whether the status text line is currently in the flex tree
  private statusVisible = true;

  // Current connection info for header rebuilds
  private currentInfo: ConnectionInfo;

  // Relative-time refresh timer (only runs when visible)
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private isVisible = false;

  constructor(
    renderer: CliRenderer,
    theme: Theme,
    strings: Locale,
    options: DashboardViewOptions,
  ) {
    this.renderer = renderer;
    this.theme = theme;
    this.strings = strings;
    this.callbacks = options;
    this.titleParts = [
      options.rootTitle ?? strings.app.name,
      strings.menu.dashboard.title,
    ];

    this.help = [
      { key: strings.keys.arrowsUD, action: strings.help.navigate },
      { key: strings.keys.enter, action: strings.help.select },
      { key: strings.keys.typeInput, action: strings.help.filter },
      { key: strings.keys.esc, action: strings.help.back },
      { key: strings.keys.backspace, action: strings.help.back },
      ...globalHelp(strings),
    ];

    this.root = new BoxRenderable(renderer, {
      id: "dashboard-root",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      padding: 1,
    });

    this.currentInfo = { status: "disconnected", url: "" };
    this.headerBar = new TextRenderable(renderer, {
      id: "dashboard-header",
      content: formatHeaderBar(theme, strings, this.currentInfo, this.titleParts),
      marginBottom: 1,
    });
    this.root.add(this.headerBar);

    this.filterBar = new TextRenderable(renderer, {
      id: "dashboard-filter",
      content: t`${fg(theme.fgSubtle)("/")}`,
      marginBottom: 1,
    });
    this.root.add(this.filterBar);

    // Status text — shown while loading/disconnected/empty; sits above the menu list.
    // Removed from the flex tree when entities are displayed.
    this.statusText = new TextRenderable(renderer, {
      id: "dashboard-status",
      content: t`${fg(theme.fgMuted)("Connecting\u2026")}`,
      marginBottom: 1,
    });
    this.root.add(this.statusText);

    // Menu list — always in the tree so keyboard handling (Escape → back) and
    // the bgElevated background fill work regardless of loading state.
    this.menuList = this.createMenuList([]);
    this.root.add(this.menuList);

    this.helpBar = new TextRenderable(renderer, {
      id: "dashboard-help",
      content: formatHelpBar(theme, this.help),
      marginTop: 1,
    });
    this.root.add(this.helpBar);

    renderer.root.add(this.root);

    renderer.on("resize", () => {
      this.helpBar.content = formatHelpBar(this.theme, this.help);
      this.headerBar.content = formatHeaderBar(this.theme, this.strings, this.currentInfo, this.titleParts);
    });

    options.onTitleChange?.(this.titleParts);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Push a live connection info update to the header bar. */
  updateConnectionInfo(info: ConnectionInfo): void {
    this.currentInfo = info;
    this.headerBar.content = formatHeaderBar(this.theme, this.strings, info, this.titleParts);
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
      this.startRefreshTimer();
      this.refreshTimestamps();
    } else {
      this.stopRefreshTimer();
    }
  }

  focus(): void {
    this.menuList.focus();
  }

  resetAndFocus(): void {
    this.menuList.resetFilter();
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

    log("Fetching favorites and usage prediction");
    this.showStatus("Loading\u2026");

    try {
      const [homeResult, predictedResult] = await Promise.allSettled([
        fetchFrontendHomeData(conn),
        getCommonControlsUsagePrediction(conn),
      ]);

      // Guard: connection may have changed during async fetches
      if (this.conn !== conn) {
        log("Connection changed during initialization — aborting");
        return;
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

      if (merged.length === 0) {
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
   */
  private populateInitialItems(allEntities: HassEntities): void {
    const items: MenuItem[] = [];
    for (const entityId of this.entityIds) {
      const entity = allEntities[entityId];
      if (!entity) continue;
      this.entityCache.set(entityId, entity);
      items.push(this.entityToMenuItem(entity));
    }
    this.showEntityList(items);
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

  // ── Cleanup ───────────────────────────────────────────────────────────────

  private cleanup(): void {
    this.unsubEntities?.();
    this.unsubEntities = null;
    this.entityCache.clear();
    this.entityIds = [];
    this.isFirstEntityUpdate = true;
    this.stopRefreshTimer();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private entityToMenuItem(entity: HassEntity): MenuItem {
    const domain = entity.entity_id.split(".")[0] ?? "";
    return {
      id: entity.entity_id,
      icon: DOMAIN_ICONS[domain] ?? DEFAULT_ICON,
      title: entity.attributes.friendly_name ?? entity.entity_id,
      description: this.formatDescription(entity),
      action: { type: "noop" },
    };
  }

  private formatDescription(entity: HassEntity): string {
    const rel = this.formatRelativeTime(entity.last_changed);
    return rel ? `${entity.state} · ${rel}` : entity.state;
  }

  private formatRelativeTime(isoString: string): string {
    const secs = Math.floor((Date.now() - Date.parse(isoString)) / 1000);
    if (secs < 5) return this.strings.status.justNow;
    if (secs < 60) return this.strings.status.secondsAgo(secs);
    const mins = Math.floor(secs / 60);
    if (mins < 60) return this.strings.status.minutesAgo(mins);
    return this.strings.status.hoursAgo(Math.floor(mins / 60));
  }

  /** Show a status message above the empty menu list. */
  private showStatus(message: string): void {
    if (!this.statusVisible) {
      this.root.insertBefore(this.statusText, this.menuList);
      this.statusVisible = true;
    }
    this.statusText.content = t`${fg(this.theme.fgMuted)(message)}`;
    this.menuList.setItems([]);
  }

  /** Hide the status message and populate the menu list with entities. */
  private showEntityList(items: readonly MenuItem[]): void {
    if (this.statusVisible) {
      this.root.remove(this.statusText.id);
      this.statusVisible = false;
    }
    this.menuList.setItems(items);
  }

  private createMenuList(items: readonly MenuItem[]): MenuList {
    return new MenuList(this.renderer, {
      id: "dashboard-list",
      items,
      theme: this.theme,
      onSelect: (_item) => {
        // Intentional noop — entity actions are not yet implemented
      },
      onFilterChange: (filter) => this.updateFilterBar(filter),
      onEscape: () => this.callbacks.onBack(),
      onBack: () => this.callbacks.onBack(),
      wrapSelection: true,
    });
  }

  private updateFilterBar(filter: string): void {
    if (filter.length === 0) {
      this.filterBar.content = t`${fg(this.theme.fgSubtle)("/")}`;
    } else {
      this.filterBar.content = t`${fg(this.theme.accent)("/")} ${fg(this.theme.fg)(filter)}`;
    }
  }
}
