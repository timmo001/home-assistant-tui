import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  t,
  fg,
} from "@opentui/core";
import type { Connection } from "home-assistant-js-websocket";
import type { ConnectionInfo } from "../types.js";
import type { Theme } from "../theme.js";
import type { Locale } from "../i18n/index.js";
import type { Toast } from "./Toast.js";
import { formatHelpBar, type HelpEntry } from "./helpBar.js";
import { formatFilterBar } from "./filterBar.js";
import { MenuList } from "./MenuList.js";
import { HeaderBlock } from "./HeaderBlock.js";

// ---------------------------------------------------------------------------

export interface ConnectedViewOptions {
  /** Called when the user navigates back */
  readonly onBack: () => void;
  /** Root title for the breadcrumb (e.g. the app name) */
  readonly rootTitle?: string;
  /** Called when the title changes so the terminal tab can be updated */
  readonly onTitleChange?: (titleParts: readonly string[]) => void;
  /** Base URL for the Home Assistant instance (for opening in browser) */
  readonly baseUrl?: string;
  /** Toast instance for showing notifications */
  readonly toast?: Toast;
}

/**
 * Abstract base for views that subscribe to a live HA WebSocket connection.
 *
 * Provides the shared scaffolding: root box, header bar, filter bar, status
 * text, help bar, resize wiring, connection lifecycle management, and the
 * standard view API (setVisible, focus, blur, resetAndFocus, destroy).
 *
 * Subclasses implement:
 *   - `buildHelp()` — return help entries for the view
 *   - `createMenuList()` — build the initial (empty) MenuList
 *   - `doInitialize(conn)` — fetch domain data and subscribe (called once per connection)
 *   - `doCleanup()` — tear down subscriptions and reset domain state
 */
export abstract class ConnectedView {
  protected renderer: CliRenderer;
  protected theme: Theme;
  protected strings: Locale;
  protected callbacks: ConnectedViewOptions;
  protected titleParts: readonly string[];
  protected baseUrl: string;
  protected toast: Toast | null;

  protected root: BoxRenderable;
  protected header: HeaderBlock;
  protected filterBar: TextRenderable;
  protected statusText: TextRenderable;
  protected menuList: MenuList;
  protected helpBar: TextRenderable;
  protected help: readonly HelpEntry[];

  // Connection state
  protected conn: Connection | null = null;
  protected initializationInProgress = false;

  // Visibility
  protected isVisible = false;

  // Whether the status text line is currently in the flex tree
  protected statusVisible = true;

  // Current connection info for header rebuilds
  protected currentInfo: ConnectionInfo;

  constructor(
    renderer: CliRenderer,
    theme: Theme,
    strings: Locale,
    options: ConnectedViewOptions,
    config: {
      /** Unique ID prefix for renderables (e.g. "dashboard", "entities") */
      readonly idPrefix: string;
      /** View title for the breadcrumb second segment */
      readonly viewTitle: string;
      /** Initial status message shown while loading */
      readonly initialStatus: string;
    },
  ) {
    this.renderer = renderer;
    this.theme = theme;
    this.strings = strings;
    this.callbacks = options;
    this.baseUrl = options.baseUrl ?? "";
    this.toast = options.toast ?? null;
    this.titleParts = [options.rootTitle ?? strings.app.name, config.viewTitle];

    this.help = this.buildHelp();

    this.root = new BoxRenderable(renderer, {
      id: `${config.idPrefix}-root`,
      flexDirection: "column",
      width: "100%",
      height: "100%",
      padding: 1,
    });

    this.currentInfo = { status: "disconnected", url: "" };
    this.header = new HeaderBlock(renderer, theme, strings, this.root, {
      id: config.idPrefix,
      titleParts: this.titleParts,
      info: this.currentInfo,
    });

    this.filterBar = new TextRenderable(renderer, {
      id: `${config.idPrefix}-filter`,
      content: formatFilterBar(theme, ""),
      marginTop: 1,
      marginBottom: 1,
    });
    this.root.add(this.filterBar);

    // Status text — shown while loading/disconnected/empty
    this.statusText = new TextRenderable(renderer, {
      id: `${config.idPrefix}-status`,
      content: t`${fg(theme.fgMuted)(config.initialStatus)}`,
      marginBottom: 1,
    });
    this.root.add(this.statusText);

    // Menu list — subclass decides the configuration
    this.menuList = this.createMenuList();
    this.root.add(this.menuList);

    this.helpBar = new TextRenderable(renderer, {
      id: `${config.idPrefix}-help`,
      content: formatHelpBar(theme, this.help),
      marginTop: 1,
    });
    this.root.add(this.helpBar);

    renderer.root.add(this.root);

    renderer.on("resize", () => {
      this.helpBar.content = formatHelpBar(this.theme, this.help);
    });

    options.onTitleChange?.(this.titleParts);
  }

  // ── Abstract hooks ────────────────────────────────────────────────────────

  /** Return the help bar entries for this view. */
  protected abstract buildHelp(): readonly HelpEntry[];

  /** Create the initial (empty) MenuList renderable. */
  protected abstract createMenuList(): MenuList;

  /**
   * Perform domain-specific initialization after a connection is established.
   * Called with the initialization guard already set. Must handle its own
   * `finally` block to reset `initializationInProgress`.
   */
  protected abstract doInitialize(conn: Connection): Promise<void>;

  /** Clean up domain-specific subscriptions and state. */
  protected abstract doCleanup(): void;

  // ── Public API ────────────────────────────────────────────────────────────

  /** Push a live connection info update to the header bar. */
  updateConnectionInfo(info: ConnectionInfo): void {
    this.currentInfo = info;
    this.header.update(info, this.titleParts);
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
      this.onBecameVisible();
    } else {
      this.onBecameHidden();
    }
  }

  focus(): void {
    this.menuList.focus();
  }

  resetAndFocus(): void {
    this.menuList.resetFilter();
    this.menuList.resetSelection();
    this.menuList.focus();
  }

  blur(): void {
    this.menuList.blur();
  }

  destroy(): void {
    this.cleanup();
    this.renderer.root.remove(this.root.id);
  }

  // ── Protected helpers ─────────────────────────────────────────────────────

  /** Called when the view becomes visible. Override for refresh timers, etc. */
  protected onBecameVisible(): void {}

  /** Called when the view becomes hidden. Override for stopping timers, etc. */
  protected onBecameHidden(): void {}

  /** Show a status message above the empty menu list. */
  protected showStatus(message: string): void {
    if (!this.statusVisible) {
      this.root.insertBefore(this.statusText, this.menuList);
      this.statusVisible = true;
    }
    this.statusText.content = t`${fg(this.theme.fgMuted)(message)}`;
    this.menuList.setItems([]);
  }

  /** Hide the status text (call when populating the menu list with real items). */
  protected hideStatus(): void {
    if (this.statusVisible) {
      this.root.remove(this.statusText.id);
      this.statusVisible = false;
    }
  }

  // ── Private lifecycle ─────────────────────────────────────────────────────

  private async initialize(conn: Connection): Promise<void> {
    if (this.initializationInProgress) return;
    this.initializationInProgress = true;

    this.cleanup();
    this.conn = conn;

    await this.doInitialize(conn);
  }

  private cleanup(): void {
    this.doCleanup();
  }
}
