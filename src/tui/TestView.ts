import {
  type CliRenderer,
  type KeyEvent,
  BoxRenderable,
  TextRenderable,
  ScrollBoxRenderable,
  t,
  fg,
  bold,
} from "@opentui/core";
import type { ConnectionInfo } from "../types.js";
import type { Theme } from "../theme.js";
import type { Locale } from "../i18n/index.js";
import { formatHelpBar, globalHelp, type HelpEntry } from "./helpBar.js";
import { HeaderBlock } from "./HeaderBlock.js";
import { MenuGrid } from "./MenuGrid.js";

function randomTemperature(): number {
  return +(Math.random() * 8 + 18).toFixed(1);
}

function randomMinutes(): number {
  return Math.floor(Math.random() * 60);
}

export interface TestViewOptions {
  readonly onBack: () => void;
  readonly rootTitle?: string;
  readonly onTitleChange?: (titleParts: readonly string[]) => void;
}

/**
 * Minimal sandbox view for exercising TUI scaffolding during development.
 *
 * Provides header, body text, and help bar without requiring a live
 * Home Assistant connection.
 */
export class TestView {
  private renderer: CliRenderer;
  private theme: Theme;
  private strings: Locale;
  private callbacks: TestViewOptions;

  private root: BoxRenderable;
  private header: HeaderBlock;
  private bodyText: TextRenderable;
  private scroll: ScrollBoxRenderable;
  private tileGrid: MenuGrid;
  private helpBar: TextRenderable;
  private help: readonly HelpEntry[];
  private titleParts: readonly string[];
  private currentInfo: ConnectionInfo;

  constructor(
    renderer: CliRenderer,
    theme: Theme,
    strings: Locale,
    options: TestViewOptions,
  ) {
    this.renderer = renderer;
    this.theme = theme;
    this.strings = strings;
    this.callbacks = options;
    this.titleParts = [
      options.rootTitle ?? strings.app.name,
      strings.testView.title,
    ];
    this.currentInfo = { status: "disconnected", url: "" };

    this.help = [
      { key: strings.keys.esc, action: strings.help.back },
      { key: strings.keys.backspace, action: strings.help.back },
      ...globalHelp(strings),
    ];

    this.root = new BoxRenderable(renderer, {
      id: "test-root",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      padding: 1,
    });

    this.header = new HeaderBlock(renderer, theme, strings, this.root, {
      id: "test",
      titleParts: this.titleParts,
      info: this.currentInfo,
    });

    this.bodyText = new TextRenderable(renderer, {
      id: "test-body",
      content: t`${bold(fg(theme.accent)(strings.testView.heading))}\n${fg(theme.fgMuted)(strings.testView.description)}`,
      marginTop: 1,
    });
    this.root.add(this.bodyText);

    this.scroll = new ScrollBoxRenderable(renderer, {
      id: "test-scroll",
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
    this.root.add(this.scroll);

    this.tileGrid = new MenuGrid(renderer, theme, {
      id: "test-grid",
      scroll: this.scroll,
    });

    this.tileGrid.setItems(
      Array.from({ length: 10 }, (_, idx) => ({
        id: `test-tile-${idx}`,
        primary: `Primary Title ${idx + 1}`,
        secondary: [
          `${randomTemperature()}°C`,
          `${randomMinutes()} minutes ago`,
        ],
      })),
    );

    this.helpBar = new TextRenderable(renderer, {
      id: "test-help",
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

  updateConnectionInfo(info: ConnectionInfo): void {
    this.currentInfo = info;
    this.header.update(info, this.titleParts);
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
    if (visible) {
      this.callbacks.onTitleChange?.(this.titleParts);
    } else {
      this.blur();
    }
  }

  focus(): void {
    this.tileGrid.focus();
  }

  resetAndFocus(): void {
    this.tileGrid.resetSelection();
    this.focus();
  }

  blur(): void {
    this.tileGrid.blur();
  }

  handleKeyPress(key: KeyEvent): boolean {
    if (key.name === "escape" || key.name === "backspace") {
      this.callbacks.onBack();
      return true;
    }
    return this.tileGrid.handleKeyPress(key);
  }

  destroy(): void {
    this.renderer.root.remove(this.root.id);
  }
}
