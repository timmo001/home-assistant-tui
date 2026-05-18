import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  t,
  fg,
} from "@opentui/core";
import type { MenuItem } from "../types.js";
import type { ConnectionInfo } from "../types.js";
import type { Theme } from "../theme.js";
import type { Locale } from "../i18n/index.js";
import { submenus, submenuTitles } from "../menu.js";
import { formatHelpBar, globalHelp, type HelpEntry } from "./helpBar.js";
import { formatHeaderBar } from "./headerBar.js";
import { MenuList } from "./MenuList.js";

/** Configuration callbacks for the submenu view */
export interface SubmenuViewOptions {
  /** Called when the user selects a non-submenu action item */
  readonly onAction: (item: MenuItem) => void;
  /** Called when the user navigates back from the root submenu level */
  readonly onBack: () => void;
  /** Root title for the breadcrumb trail (e.g. the app name) */
  readonly rootTitle?: string;
  /** Called when the submenu changes so the terminal title can be updated */
  readonly onTitleChange?: (titleParts: readonly string[]) => void;
}

/**
 * Generic submenu view with breadcrumb navigation, nested levels, and type-to-filter.
 *
 * Supports arbitrarily deep submenu nesting by looking up menu IDs in the
 * global {@link submenus} registry. Escape/Backspace with an empty filter
 * pops up one level; at the root it calls `onBack`.
 */
export class SubmenuView {
  private renderer: CliRenderer;
  private theme: Theme;
  private strings: Locale;
  private callbacks: SubmenuViewOptions;

  private root: BoxRenderable;
  private headerBar: TextRenderable;
  private filterBar: TextRenderable;
  private menuList: MenuList;
  private helpBar: TextRenderable;
  private help: readonly HelpEntry[];

  /** Stack of submenu IDs for nested navigation */
  private menuStack: string[] = [];
  private currentMenuId = "";
  private rootTitle: string;
  private currentInfo: ConnectionInfo;

  constructor(
    renderer: CliRenderer,
    theme: Theme,
    strings: Locale,
    options: SubmenuViewOptions,
  ) {
    this.renderer = renderer;
    this.theme = theme;
    this.strings = strings;
    this.callbacks = options;
    this.rootTitle = options.rootTitle ?? strings.app.name;
    this.currentInfo = { status: "disconnected", url: "" };

    this.help = [
      { key: strings.keys.arrowsUD, action: strings.help.navigate },
      { key: strings.keys.enter, action: strings.help.select },
      { key: strings.keys.typeInput, action: strings.help.filter },
      { key: strings.keys.esc, action: strings.help.back },
      { key: strings.keys.backspace, action: strings.help.back },
      ...globalHelp(strings),
    ];

    this.root = new BoxRenderable(renderer, {
      id: "submenu-root",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      padding: 1,
    });

    // Header bar — connection state + breadcrumb (kept in sync by App)
    this.headerBar = new TextRenderable(renderer, {
      id: "submenu-header",
      content: formatHeaderBar(theme, strings, this.currentInfo, this.getTitleParts()),
      marginBottom: 1,
    });
    this.root.add(this.headerBar);

    // Filter bar — always visible to avoid layout shifts
    this.filterBar = new TextRenderable(renderer, {
      id: "submenu-filter",
      content: t`${fg(theme.fgSubtle)("/")}`,
      marginBottom: 1,
    });
    this.root.add(this.filterBar);

    // Menu list — created fresh on each loadMenu call
    this.menuList = this.createMenuList([]);
    this.root.add(this.menuList);

    // Help bar
    this.helpBar = new TextRenderable(renderer, {
      id: "submenu-help",
      content: formatHelpBar(theme, this.help),
      marginTop: 1,
    });
    this.root.add(this.helpBar);

    renderer.root.add(this.root);

    // Re-wrap help bar on terminal resize
    renderer.on("resize", () => {
      this.helpBar.content = formatHelpBar(this.theme, this.help);
    });
  }

  /** Push a live connection info update to the header bar. */
  updateConnectionInfo(info: ConnectionInfo): void {
    this.currentInfo = info;
    this.rebuildHeader();
  }

  /** Open a submenu as the root level (resets the navigation stack) */
  openSubmenu(menuId: string): void {
    this.menuStack = [];
    this.loadMenu(menuId);
  }

  /** Navigate into a nested submenu, pushing the current level onto the stack */
  pushSubmenu(menuId: string): void {
    this.menuStack.push(this.currentMenuId);
    this.loadMenu(menuId);
  }

  /** Show or hide the submenu view */
  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** Give keyboard focus to the menu list */
  focus(): void {
    this.menuList.focus();
  }

  /** Reset filter state and give keyboard focus to the menu list */
  resetAndFocus(): void {
    this.menuList.resetFilter();
    this.menuList.focus();
  }

  /** Remove keyboard focus from the menu list */
  blur(): void {
    this.menuList.blur();
  }

  private handleBack(): void {
    const prev = this.menuStack.pop();
    if (prev) {
      // Go up one submenu level
      this.loadMenu(prev);
    } else {
      // At the top level — go back to the previous view
      this.callbacks.onBack();
    }
  }

  private loadMenu(menuId: string): void {
    const items = submenus.get(menuId);
    if (!items) return;

    this.currentMenuId = menuId;

    // Update header with new breadcrumb
    this.rebuildHeader();

    // Notify parent of title change for terminal tab title
    this.callbacks.onTitleChange?.(this.getTitleParts());

    // Reset filter bar (new menu = no filter)
    this.filterBar.content = t`${fg(this.theme.fgSubtle)("/")}`;

    // Recreate the menu list with new items
    this.root.remove(this.menuList.id);
    this.menuList = this.createMenuList(items);
    this.root.insertBefore(this.menuList, this.helpBar);
    this.menuList.focus();
  }

  private createMenuList(items: readonly MenuItem[]): MenuList {
    return new MenuList(this.renderer, {
      id: "submenu-list",
      items,
      theme: this.theme,
      onSelect: (item) => {
        if (
          item.action.type === "submenu" &&
          submenus.has(item.action.menuId)
        ) {
          this.pushSubmenu(item.action.menuId);
        } else {
          this.callbacks.onAction(item);
        }
      },
      onFilterChange: (filter) => this.updateFilterBar(filter),
      onEscape: () => this.handleBack(),
      onBack: () => this.handleBack(),
      wrapSelection: true,
    });
  }

  /** Update the filter bar display based on current filter text */
  private updateFilterBar(filter: string): void {
    if (filter.length === 0) {
      this.filterBar.content = t`${fg(this.theme.fgSubtle)("/")}`;
    } else {
      this.filterBar.content = t`${fg(this.theme.accent)("/")} ${fg(this.theme.fg)(filter)}`;
    }
  }

  private rebuildHeader(): void {
    this.headerBar.content = formatHeaderBar(
      this.theme,
      this.strings,
      this.currentInfo,
      this.getTitleParts(),
    );
  }

  /** Build the plain-text breadcrumb segments for the current submenu depth */
  private getTitleParts(): string[] {
    const parts = [this.rootTitle];

    for (const menuId of this.menuStack) {
      const title = submenuTitles.get(menuId) ?? menuId;
      parts.push(title);
    }

    if (this.currentMenuId) {
      const title =
        submenuTitles.get(this.currentMenuId) ?? this.currentMenuId;
      if (parts[parts.length - 1] !== title) {
        parts.push(title);
      }
    }

    return parts;
  }

  /** Remove the submenu view from the render tree */
  destroy(): void {
    this.renderer.root.remove(this.root.id);
  }
}
