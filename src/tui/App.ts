import { Effect } from "effect";
import type { CliRenderer } from "@opentui/core";
import type { Connection } from "home-assistant-js-websocket";
import type { ViewId, MenuItem, MenuAction } from "../types.js";
import type { ConnectionInfo } from "../types.js";
import type { Theme } from "../theme.js";
import type { Locale } from "../i18n/index.js";
import { menuItemsById, submenus } from "../menu.js";
import type { CommandRunnerService } from "../services/CommandRunner.js";
import { MainMenu } from "./MainMenu.js";
import { SubmenuView } from "./SubmenuView.js";
import { DashboardView } from "./DashboardView.js";
import { VariantPopup } from "./VariantPopup.js";
import { ConnectionForm } from "./ConnectionForm.js";
import type { ConnectionFormValues } from "./ConnectionForm.js";

const log = (msg: string) => console.error(`[ha-tui:App] ${msg}`);

/** Set the terminal tab/window title via an OSC escape sequence */
const setTerminalTitle = (title: string): void => {
  process.stdout.write(`\x1b]0;${title}\x07`);
};

export interface AppOptions {
  /** Which view to start on (default: "main") */
  readonly initialView?: ViewId;
  /** If set, execute this menu item immediately on startup and pre-select it */
  readonly executeItemId?: string;
  /** Title displayed at the top of the main menu */
  readonly title?: string;
  /** Pre-fill the connection form with these values (Settings > Connection re-edit flow) */
  readonly initialConnectionValues?: Partial<ConnectionFormValues>;
}

/** Dependencies injected into the App at construction time */
export interface AppDeps {
  /** The OpenTUI CLI renderer instance */
  readonly renderer: CliRenderer;
  /** Active colour theme */
  readonly theme: Theme;
  /** Active locale */
  readonly strings: Locale;
  /** Service for running shell commands with suspend/resume */
  readonly commandRunner: CommandRunnerService;
}

/**
 * Called when the user saves the connection form.
 * Allows the entry point to persist config and (re)connect.
 */
export type OnConnectionSaved = (values: ConnectionFormValues) => void;

/** Top-level TUI application shell managing a view stack and global keyboard */
export class App {
  private renderer: CliRenderer;
  private commandRunner: CommandRunnerService;
  private mainMenu: MainMenu;
  private submenuView: SubmenuView;
  private dashboardView: DashboardView;
  private variantPopup: VariantPopup;
  private connectionForm: ConnectionForm;
  private activeView: ViewId = "main";
  private viewStack: ViewId[] = [];
  private appTitle: string;
  private strings: Locale;
  private connectionValues: Partial<ConnectionFormValues>;

  constructor(
    deps: AppDeps,
    options: AppOptions = {},
    onConnectionSaved?: OnConnectionSaved,
  ) {
    this.renderer = deps.renderer;
    this.commandRunner = deps.commandRunner;
    this.strings = deps.strings;
    this.appTitle = options.title ?? deps.strings.app.name;
    this.connectionValues = options.initialConnectionValues ?? {};

    // --- Create views ---

    this.mainMenu = new MainMenu(deps.renderer, deps.theme, deps.strings, {
      onSelect: (item) => this.handleMenuAction(item),
      initialSelectedId: options.executeItemId,
      title: options.title,
    });

    this.submenuView = new SubmenuView(deps.renderer, deps.theme, deps.strings, {
      onAction: (item) => this.handleMenuAction(item),
      onBack: () => this.popView(),
      rootTitle: options.title ?? deps.strings.app.name,
      onTitleChange: (parts) => {
        const suffix = parts.slice(1).join(" \u203A ");
        setTerminalTitle(`${this.appTitle} \u203A ${suffix}`);
      },
    });

    this.dashboardView = new DashboardView(deps.renderer, deps.theme, deps.strings, {
      onBack: () => this.popView(),
      rootTitle: options.title ?? deps.strings.app.name,
      onTitleChange: (parts) => {
        const suffix = parts.slice(1).join(" \u203A ");
        setTerminalTitle(`${this.appTitle} \u203A ${suffix}`);
      },
    });

    this.variantPopup = new VariantPopup(deps.renderer, deps.theme, deps.strings, {
      onSelect: (action) => {
        queueMicrotask(() => this.focusActiveView());
        this.dispatchAction(action);
      },
      onDismiss: () => {
        queueMicrotask(() => this.focusActiveView());
      },
    });

    this.connectionForm = new ConnectionForm(deps.renderer, deps.theme, deps.strings, {
      onSubmit: (values) => {
        log("Connection form submitted — saving config");
        this.connectionValues = values;
        onConnectionSaved?.(values);
        this.popView();
      },
      onCancel: () => {
        log("Connection form cancelled");
        this.popView();
      },
    });

    // --- Hide all views initially ---
    this.mainMenu.setVisible(false);
    this.submenuView.setVisible(false);
    this.dashboardView.setVisible(false);
    this.connectionForm.setVisible(false);

    // --- Global keyboard ---
    deps.renderer.keyInput.on("keypress", (key) => {
      if (this.variantPopup.visible) {
        this.variantPopup.handleKeyPress(key);
        return;
      }

      if (this.activeView === "setup") {
        this.connectionForm.handleKeyPress(key);
        return;
      }
    });

    // --- Determine initial view ---
    const startView = options.initialView ?? "main";

    if (startView !== "main") {
      this.viewStack.push("main");
    }

    if (options.executeItemId) {
      const item = menuItemsById.get(options.executeItemId);
      if (item) {
        this.showView("main");
        const { action } = item;
        if (
          action.type === "command" ||
          action.type === "silent" ||
          action.type === "notify"
        ) {
          setTimeout(() => {
            Effect.runPromise(
              this.commandRunner.runSuspended(action.cmd, true),
            )
              .then(() => deps.renderer.destroy())
              .catch((err: unknown) => {
                log(`Execute error: ${err}`);
                deps.renderer.destroy();
              });
          }, 50);
        } else {
          setTimeout(() => this.handleMenuAction(item), 50);
        }
        return;
      }
    }

    this.showView(startView);
  }

  /** Push a live connection state update to all persistent views. */
  updateConnectionInfo(info: ConnectionInfo): void {
    this.mainMenu.updateConnectionInfo(info);
    this.submenuView.updateConnectionInfo(info);
    this.dashboardView.updateConnectionInfo(info);
  }

  /** Provide or clear the active WebSocket connection for views that need it. */
  updateConnection(conn: Connection | null): void {
    this.dashboardView.setConnection(conn);
  }

  /**
   * Open the connection form pre-filled with the given values.
   * Used by Settings > Connection to edit the existing config.
   */
  openConnectionForm(
    initialValues: ConnectionFormValues,
    onSaved: OnConnectionSaved,
  ): void {
    void initialValues;
    void onSaved;
    this.pushView("setup");
  }

  /** Navigate to a view, pushing the current one onto the stack */
  pushView(viewId: ViewId): void {
    if (this.activeView !== viewId) {
      this.viewStack.push(this.activeView);
    }
    this.showView(viewId);
  }

  /** Return to the previous view on the stack */
  popView(): void {
    const prev = this.viewStack.pop();
    if (prev) {
      this.showView(prev);
    }
  }

  private showView(viewId: ViewId): void {
    log(`Switching to view: ${viewId}`);

    this.mainMenu.setVisible(false);
    this.submenuView.setVisible(false);
    this.dashboardView.setVisible(false);
    this.connectionForm.setVisible(false);

    this.activeView = viewId;

    switch (viewId) {
      case "main":
        setTerminalTitle(this.appTitle);
        this.mainMenu.setVisible(true);
        this.mainMenu.resetAndFocus();
        break;
      case "submenu":
        this.submenuView.setVisible(true);
        this.submenuView.resetAndFocus();
        break;
      case "dashboard":
        this.dashboardView.setVisible(true);
        this.dashboardView.resetAndFocus();
        break;
      case "setup":
        setTerminalTitle(
          `${this.appTitle} \u2014 ${this.strings.app.setupSuffix}`,
        );
        this.connectionForm.setValues(this.connectionValues);
        this.connectionForm.setVisible(true);
        this.connectionForm.resetAndFocus();
        break;
    }
  }

  private handleMenuAction(item: MenuItem): void {
    if (item.variants && item.variants.length > 0) {
      log(`Opening variant popup for item ${item.id}`);
      this.blurActiveView();
      this.variantPopup.show(item);
      return;
    }

    this.dispatchAction(item.action);
  }

  private dispatchAction(action: MenuAction): void {
    log(`Dispatching action: ${action.type}`);

    switch (action.type) {
      case "noop":
        // Intentional no-op — placeholder items
        break;

      case "command":
        Effect.runPromise(
          this.commandRunner.runSuspended(action.cmd, action.wait),
        ).catch((err: unknown) => log(`Command error: ${err}`));
        break;

      case "silent":
        Effect.runPromise(this.commandRunner.runSilent(action.cmd)).catch(
          (err: unknown) => log(`Silent command error: ${err}`),
        );
        break;

      case "notify":
        Effect.runPromise(
          this.commandRunner.runNotify(action.cmd, action.notify),
        ).catch((err: unknown) => log(`Notify command error: ${err}`));
        break;

      case "view":
        this.pushView(action.viewId);
        break;

      case "submenu": {
        if (this.activeView === "submenu") {
          this.submenuView.pushSubmenu(action.menuId);
        } else {
          this.submenuView.openSubmenu(action.menuId);
          this.pushView("submenu");
        }
        break;
      }

      case "quit":
        this.renderer.destroy();
        break;
    }
  }

  private focusActiveView(): void {
    switch (this.activeView) {
      case "main":
        this.mainMenu.focus();
        break;
      case "submenu":
        this.submenuView.focus();
        break;
      case "dashboard":
        this.dashboardView.focus();
        break;
      case "setup":
        this.connectionForm.focus();
        break;
    }
  }

  private blurActiveView(): void {
    switch (this.activeView) {
      case "main":
        this.mainMenu.blur();
        break;
      case "submenu":
        this.submenuView.blur();
        break;
      case "dashboard":
        this.dashboardView.blur();
        break;
      case "setup":
        this.connectionForm.blur();
        break;
    }
  }
}
