import type { CliRenderer, KeyEvent } from "@opentui/core";
import { callService } from "home-assistant-js-websocket";
import type { Connection, HassEntity } from "home-assistant-js-websocket";
import type { MenuItem } from "../types.js";
import type { Theme } from "../theme.js";
import type { Locale } from "../i18n/index.js";
import type { Toast } from "./Toast.js";
import type { MenuList } from "./MenuList.js";
import {
  fetchAllServices,
  canToggleEntityState,
  getToggleAction,
} from "../data/services.js";

const log = (msg: string) => console.error(`[ha-tui:entityActions] ${msg}`);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Dependencies required by the entity action handler */
export interface EntityActionContext {
  readonly getConn: () => Connection | null;
  readonly getEntityState?: (entityId: string) => HassEntity | undefined;
  /** When set, used instead of the menu list selection for entity keybinds */
  readonly getSelectedEntityId?: () => string | undefined;
  readonly baseUrl: string;
  readonly renderer: CliRenderer;
  readonly theme: Theme;
  readonly strings: Locale;
  readonly toast: Toast | null;
  readonly menuList: MenuList;
}

// ---------------------------------------------------------------------------
// EntityActionHandler
// ---------------------------------------------------------------------------

/**
 * Shared entity keybind handler.
 *
 * Instantiated once per view and shared across the view's lifetime.
 */
export class EntityActionHandler {
  private ctx: EntityActionContext;

  constructor(ctx: EntityActionContext) {
    this.ctx = ctx;
  }

  /** No popup overlays remain for entity actions. */
  get hasPopup(): boolean {
    return false;
  }

  /**
   * Handle key events for entity actions.
   * Returns `true` if the key was consumed.
   *
   * @param key - The key event from the MenuList
   * @param isEntityItem - Predicate: does the selected item represent an entity?
   *   Return false for area items, group headers, etc.
   */
  handleKeyPress(
    key: KeyEvent,
    isEntityItem?: (item: MenuItem) => boolean,
  ): boolean {
    const overrideId = this.ctx.getSelectedEntityId?.();
    const entityId =
      overrideId ?? this.ctx.menuList.getSelectedItem()?.id;
    if (!entityId) return false;

    if (!overrideId) {
      const menuItem = this.ctx.menuList.getSelectedItem();
      if (menuItem && isEntityItem && !isEntityItem(menuItem)) return false;
    }

    // Ctrl+Y: copy entity ID
    if (key.name === "y" && key.ctrl) {
      void this.copyEntityId(entityId);
      return true;
    }

    // Ctrl+W: open in browser (info view)
    if (key.name === "w" && key.ctrl) {
      this.openInBrowser(entityId, "info");
      return true;
    }

    // Ctrl+S: open in browser (settings view)
    if (key.name === "s" && key.ctrl) {
      this.openInBrowser(entityId, "settings");
      return true;
    }

    // Ctrl+D: open in browser (details/YAML view)
    if (key.name === "d" && key.ctrl) {
      this.openInBrowser(entityId, "details");
      return true;
    }

    // Ctrl+H: open in browser (history view)
    if (key.name === "h" && key.ctrl) {
      this.openInBrowser(entityId, "history");
      return true;
    }

    // Ctrl+R: open in browser (related view)
    if (key.name === "r" && key.ctrl) {
      this.openInBrowser(entityId, "related");
      return true;
    }

    // Enter: toggle only when the entity matches the HA entities-card toggle rules.
    if (key.name === "return") {
      void this.toggleEntity(entityId);
      return true;
    }

    return false;
  }

  /** Clean up popup renderables */
  destroy(): void {
    // No-op.
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private async copyEntityId(entityId: string): Promise<void> {
    const s = this.ctx.strings.entityActions;
    try {
      const proc = Bun.spawn(
        [
          "bash",
          "-c",
          `echo -n "${entityId}" | wl-copy 2>/dev/null || echo -n "${entityId}" | xclip -selection clipboard 2>/dev/null`,
        ],
        {
          stdout: "ignore",
          stderr: "ignore",
        },
      );
      await proc.exited;
      if (proc.exitCode !== 0) {
        throw new Error("clipboard unavailable");
      }
      this.ctx.toast?.show("entity-copy", s.copied(entityId), "success");
    } catch {
      this.ctx.toast?.show("entity-copy", s.clipboardUnavailable, "error");
    }
  }

  private openInBrowser(entityId: string, view: string): void {
    const { baseUrl, toast, strings } = this.ctx;
    if (!baseUrl) return;

    const url = `${baseUrl}/home/overview?more-info-entity-id=${encodeURIComponent(entityId)}&more-info-view=${view}`;
    Bun.spawn(["xdg-open", url], { stdout: "ignore", stderr: "ignore" });
    toast?.show("entity-web", strings.entityActions.openedWeb, "info");
  }

  private async toggleEntity(entityId: string): Promise<void> {
    const conn = this.ctx.getConn();
    const { toast, strings } = this.ctx;
    if (!conn) return;

    const entity = this.ctx.getEntityState?.(entityId);
    if (!entity) {
      return;
    }

    try {
      const allServices = await fetchAllServices(conn);
      if (!canToggleEntityState(allServices, entity, this.ctx.getEntityState)) {
        return;
      }

      const action = getToggleAction(entity);
      if (!action) {
        return;
      }

      await callService(conn, action.domain, action.service, {
        entity_id: entity.entity_id,
      });

      toast?.show(
        "entity-action",
        strings.entityActions.serviceCalled(action.service),
        "success",
      );
    } catch (err) {
      log(`Failed to toggle entity: ${String(err)}`);
      toast?.show(
        "entity-action",
        strings.entityActions.serviceError(String(err)),
        "error",
      );
    }
  }
}
