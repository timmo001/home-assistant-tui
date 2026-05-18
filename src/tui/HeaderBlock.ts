import {
  type CliRenderer,
  ASCIIFontRenderable,
  BoxRenderable,
  TextRenderable,
} from "@opentui/core";
import type { ConnectionInfo } from "../types.js";
import type { Theme } from "../theme.js";
import type { Locale } from "../i18n/index.js";
import { formatHeaderBar } from "./headerBar.js";

const MIN_WIDTH_FOR_BLOCK = 160;
const MIN_HEIGHT_FOR_ASCII = 24;

/**
 * Shared header block used across all views.
 *
 * Adds directly to a parent container (no intermediate wrapper) so that
 * ASCIIFontRenderable participates correctly in the flex layout.
 *
 * Contains:
 * - ASCII art "Home Assistant" logo (conditionally visible based on terminal size)
 * - Single-line header bar with breadcrumb + connection status
 */
export class HeaderBlock {
  private renderer: CliRenderer;
  private theme: Theme;
  private strings: Locale;
  private asciiArt: ASCIIFontRenderable;
  private headerBar: TextRenderable;
  private titleParts: readonly string[];

  constructor(
    renderer: CliRenderer,
    theme: Theme,
    strings: Locale,
    parent: BoxRenderable,
    options: {
      /** Renderable ID prefix to avoid collisions */
      readonly id: string;
      /** Initial breadcrumb parts */
      readonly titleParts: readonly string[];
      /** Initial connection info */
      readonly info: ConnectionInfo;
    },
  ) {
    this.renderer = renderer;
    this.theme = theme;
    this.strings = strings;
    this.titleParts = options.titleParts;

    // ASCII art logo — added directly to parent flex container
    this.asciiArt = new ASCIIFontRenderable(renderer, {
      id: `${options.id}-ascii`,
      text: "Home Assistant",
      font: this.pickFont(),
      color: theme.accent,
      alignSelf: "center",
    });
    this.asciiArt.visible = this.hasRoom();
    parent.add(this.asciiArt);

    // Text header bar — breadcrumb + connection status
    this.headerBar = new TextRenderable(renderer, {
      id: `${options.id}-header`,
      content: formatHeaderBar(
        theme,
        strings,
        options.info,
        options.titleParts,
      ),
      marginTop: 1,
      marginBottom: 1,
    });
    parent.add(this.headerBar);

    renderer.on("resize", () => {
      this.asciiArt.visible = this.hasRoom();
      this.asciiArt.font = this.pickFont();
    });
  }

  /** Update connection info displayed in the header bar */
  updateConnectionInfo(info: ConnectionInfo): void {
    this.headerBar.content = formatHeaderBar(
      this.theme,
      this.strings,
      info,
      this.titleParts,
    );
  }

  /** Update breadcrumb title parts */
  setTitleParts(parts: readonly string[]): void {
    this.titleParts = parts;
  }

  /** Update both title parts and connection info in one call */
  update(info: ConnectionInfo, titleParts?: readonly string[]): void {
    if (titleParts) this.titleParts = titleParts;
    this.headerBar.content = formatHeaderBar(
      this.theme,
      this.strings,
      info,
      this.titleParts,
    );
  }

  private hasRoom(): boolean {
    return this.renderer.height >= MIN_HEIGHT_FOR_ASCII;
  }

  private pickFont(): "block" | "tiny" {
    return this.renderer.width >= MIN_WIDTH_FOR_BLOCK ? "block" : "tiny";
  }
}
