import { type CliRenderer, BoxRenderable, TextRenderable } from "@opentui/core";
import type { MenuItem } from "../types.js";
import type { ConnectionInfo } from "../types.js";
import type { Theme } from "../theme.js";
import type { Locale } from "../i18n/index.js";
import { formatHelpBar, globalHelp, type HelpEntry } from "./helpBar.js";
import { formatFilterBar } from "./filterBar.js";
import { MenuList } from "./MenuList.js";
import { HeaderBlock } from "./HeaderBlock.js";

const log = (msg: string) => console.error(`[ha-tui:MainMenu] ${msg}`);

/** Configuration callbacks for the main menu */
export interface MainMenuOptions {
  /** Menu items to display */
  readonly items: readonly MenuItem[];
  /** Called when the user selects a menu item */
  readonly onSelect: (item: MenuItem) => void;
  /** If set, pre-select the item with this ID on startup */
  readonly initialSelectedId?: string;
  /** Title displayed at the top of the menu */
  readonly title?: string;
}

/** Top-level menu rendered as a {@link MenuList} with type-to-filter */
export class MainMenu {
  private renderer: CliRenderer;
  private theme: Theme;
  private strings: Locale;
  private root: BoxRenderable;
  private header: HeaderBlock;
  private menuList: MenuList;
  private filterBar: TextRenderable;
  private helpBar: TextRenderable;
  private callbacks: MainMenuOptions;
  private help: readonly HelpEntry[];

  constructor(
    renderer: CliRenderer,
    theme: Theme,
    strings: Locale,
    options: MainMenuOptions,
  ) {
    this.renderer = renderer;
    this.theme = theme;
    this.strings = strings;
    this.callbacks = options;

    this.help = [
      { key: strings.keys.arrowsUD, action: strings.help.navigate },
      { key: strings.keys.enter, action: strings.help.select },
      { key: strings.keys.typeInput, action: strings.help.filter },
      ...globalHelp(strings),
    ];

    this.root = new BoxRenderable(renderer, {
      id: "main-menu-root",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      padding: 1,
    });

    // Header block — ASCII art + connection state breadcrumb
    this.header = new HeaderBlock(renderer, theme, strings, this.root, {
      id: "main-menu",
      titleParts: ["⌂"],
      info: { status: "disconnected", url: "" },
    });

    // Filter bar — always visible to avoid layout shifts
    this.filterBar = new TextRenderable(renderer, {
      id: "main-menu-filter",
      content: formatFilterBar(theme, ""),
      marginTop: 1,
      marginBottom: 1,
    });
    this.root.add(this.filterBar);

    // Menu list
    const initialIdx = options.initialSelectedId
      ? Math.max(
          0,
          options.items.findIndex((m) => m.id === options.initialSelectedId),
        )
      : 0;

    this.menuList = new MenuList(renderer, {
      id: "main-menu-list",
      items: options.items,
      theme,
      onSelect: (item) => {
        this.callbacks.onSelect(item);
      },
      onFilterChange: (filter) => this.updateFilterBar(filter),
      onEscape: () => {
        // No-op on main menu with empty filter — quit via Ctrl+C
      },
      initialSelectedIndex: initialIdx,
      wrapSelection: true,
    });
    this.root.add(this.menuList);

    // Help bar
    this.helpBar = new TextRenderable(renderer, {
      id: "main-menu-help",
      content: formatHelpBar(theme, this.help),
      marginTop: 1,
    });
    this.root.add(this.helpBar);

    renderer.root.add(this.root);

    // Re-wrap bars on terminal resize
    renderer.on("resize", () => {
      this.helpBar.content = formatHelpBar(this.theme, this.help);
    });
  }

  /** Push a live connection info update to the header bar. */
  updateConnectionInfo(info: ConnectionInfo): void {
    this.header.updateConnectionInfo(info);
  }

  /** Show or hide the main menu view */
  setVisible(visible: boolean): void {
    this.root.visible = visible;
    if (!visible) {
      this.blur();
    }
  }

  /** Give keyboard focus to the menu list */
  focus(): void {
    this.menuList.focus();
  }

  /** Reset filter state and give keyboard focus to the menu list */
  resetAndFocus(): void {
    this.menuList.resetFilter();
    this.menuList.resetSelection();
    this.menuList.focus();
  }

  /** Remove keyboard focus from the menu list */
  blur(): void {
    this.menuList.blur();
  }

  /** Remove the main menu from the render tree */
  destroy(): void {
    this.renderer.root.remove(this.root.id);
  }

  /** Update the filter bar display based on current filter text */
  private updateFilterBar(filter: string): void {
    this.filterBar.content = formatFilterBar(this.theme, filter);
  }
}
