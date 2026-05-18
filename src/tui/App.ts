import type { CliRenderer } from "@opentui/core";
import type { ViewId, MenuItem, MenuAction } from "../types.js";
import type { Theme } from "../theme.js";
import { menuItemsById, submenus } from "../menu.js";
import type { CommandRunnerService } from "../services/CommandRunner.js";
import { MainMenu } from "./MainMenu.js";
import { SubmenuView } from "./SubmenuView.js";
import { VariantPopup } from "./VariantPopup.js";

const log = (msg: string) => console.error(`[starter-tui:App] ${msg}`);

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
  /** Subtitle displayed after the title in muted text */
  readonly subtitle?: string;
}

/** Dependencies injected into the App at construction time */
export interface AppDeps {
  /** The OpenTUI CLI renderer instance */
  readonly renderer: CliRenderer;
  /** Active colour theme */
  readonly theme: Theme;
  /** Service for running shell commands with suspend/resume */
  readonly commandRunner: CommandRunnerService;
}

/** Top-level TUI application shell managing a view stack and global keyboard */
export class App {
  private renderer: CliRenderer;
  private commandRunner: CommandRunnerService;
  private mainMenu: MainMenu;
  private submenuView: SubmenuView;
  private variantPopup: VariantPopup;
  private activeView: ViewId = "main";
  private viewStack: ViewId[] = [];
  private appTitle: string;

  constructor(deps: AppDeps, options: AppOptions = {}) {
    this.renderer = deps.renderer;
    this.commandRunner = deps.commandRunner;
    this.appTitle = options.title ?? "Starter TUI";

    // --- Create views ---

    this.mainMenu = new MainMenu(deps.renderer, deps.theme, {
      onSelect: (item) => this.handleMenuAction(item),
      initialSelectedId: options.executeItemId,
      title: options.title,
      subtitle: options.subtitle,
    });

    this.submenuView = new SubmenuView(deps.renderer, deps.theme, {
      onAction: (item) => this.handleMenuAction(item),
      onBack: () => this.popView(),
      rootTitle: options.title ?? "Menu",
      onTitleChange: (parts) => {
        const suffix = parts.slice(1).join(" \u203A ");
        setTerminalTitle(`${this.appTitle} \u203A ${suffix}`);
      },
    });

    this.variantPopup = new VariantPopup(deps.renderer, deps.theme, {
      onSelect: (action) => {
        // Defer refocus to avoid the same keypress event hitting the MenuList
        queueMicrotask(() => this.focusActiveView());
        this.dispatchAction(action);
      },
      onDismiss: () => {
        // Defer refocus to avoid the same Escape event hitting the MenuList
        queueMicrotask(() => this.focusActiveView());
      },
    });

    // --- Hide all views initially ---
    this.mainMenu.setVisible(false);
    this.submenuView.setVisible(false);

    // --- Global keyboard ---
    // Ctrl+C is handled by OpenTUI's exitOnCtrlC option which ensures
    // terminal state is fully restored before exiting.
    deps.renderer.keyInput.on("keypress", (key) => {
      // Route keys to the variant popup when it is visible
      if (this.variantPopup.visible) {
        this.variantPopup.handleKeyPress(key);
        return;
      }
    });

    // --- Determine initial view ---
    const startView = options.initialView ?? "main";

    // Ensure back navigation works when starting on a non-main view
    if (startView !== "main") {
      this.viewStack.push("main");
    }

    // If an item should be executed immediately (subcommand mode):
    // always suspend, run with visible output, wait for keypress, then exit.
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
            this.commandRunner
              .runSuspended(action.cmd, true)
              .then(() => deps.renderer.destroy())
              .catch((err) => {
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
    // If stack is empty we're at main — stay there
  }

  private showView(viewId: ViewId): void {
    log(`Switching to view: ${viewId}`);

    // Hide all
    this.mainMenu.setVisible(false);
    this.submenuView.setVisible(false);

    this.activeView = viewId;

    // Show the target and reset filter state (fresh view entry)
    switch (viewId) {
      case "main":
        setTerminalTitle(this.appTitle);
        this.mainMenu.setVisible(true);
        this.mainMenu.resetAndFocus();
        break;
      case "submenu":
        this.submenuView.setVisible(true);
        this.submenuView.resetAndFocus();
        // SubmenuView updates the terminal title itself via onTitleChange
        break;
    }
  }

  private handleMenuAction(item: MenuItem): void {
    // If the item has variants, open the popup instead of dispatching directly
    if (item.variants && item.variants.length > 0) {
      log(`Opening variant popup for item ${item.id}`);
      this.blurActiveView();
      this.variantPopup.show(item);
      return;
    }

    this.dispatchAction(item.action);
  }

  /** Dispatch a menu action (command, silent, notify, view, or submenu) */
  private dispatchAction(action: MenuAction): void {
    log(`Dispatching action: ${action.type}`);

    switch (action.type) {
      case "command":
        this.commandRunner
          .runSuspended(action.cmd, action.wait)
          .catch((err) => {
            log(`Command error: ${err}`);
          });
        break;

      case "silent":
        this.commandRunner.runSilent(action.cmd).catch((err) => {
          log(`Silent command error: ${err}`);
        });
        break;

      case "notify":
        this.commandRunner.runNotify(action.cmd, action.notify).catch((err) => {
          log(`Notify command error: ${err}`);
        });
        break;

      case "view":
        this.pushView(action.viewId);
        break;

      case "submenu": {
        if (this.activeView === "submenu") {
          // Already in submenu view — navigate deeper
          this.submenuView.pushSubmenu(action.menuId);
        } else {
          // Open the submenu view at the target menu
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

  /** Restore keyboard focus to the currently active view */
  private focusActiveView(): void {
    switch (this.activeView) {
      case "main":
        this.mainMenu.focus();
        break;
      case "submenu":
        this.submenuView.focus();
        break;
    }
  }

  /** Remove keyboard focus from the currently active view */
  private blurActiveView(): void {
    switch (this.activeView) {
      case "main":
        this.mainMenu.blur();
        break;
      case "submenu":
        this.submenuView.blur();
        break;
    }
  }
}
