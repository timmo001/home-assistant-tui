import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  StyledText,
  t,
  fg,
} from "@opentui/core";
import type { TextChunk } from "@opentui/core";
import type { Theme } from "../theme.js";

export type TileOptions = {
  /** Renderable ID prefix */
  readonly id: string;
  /** Primary text */
  readonly primary: string;
  /** Secondary text */
  readonly secondary?: string | readonly string[];
  /** Nerd Font MDI glyph shown before the primary text */
  readonly icon?: string;
  /** Width */
  readonly width?: number;
  /** Height */
  readonly height?: number;
};

function formatSecondary(
  theme: Theme,
  secondary: string | readonly string[],
): StyledText {
  if (typeof secondary === "string") {
    return t`${fg(theme.fgMuted)(secondary)}`;
  }

  const chunks: Array<TextChunk> = [];
  for (let index = 0; index < secondary.length; index++) {
    if (index > 0) {
      chunks.push(fg(theme.fgSubtle)(" • "));
    }
    chunks.push(fg(theme.fgMuted)(secondary[index]));
  }
  return new StyledText(chunks);
}

function formatPrimary(
  theme: Theme,
  primary: string,
  icon: string | undefined,
  selected: boolean,
): StyledText {
  const color = selected ? theme.accent : theme.fg;
  if (icon) {
    return t`${fg(color)(icon)} ${fg(color)(primary)}`;
  }
  return t`${fg(color)(primary)}`;
}

/**
 * Compact bordered card with a primary title and optional secondary line.
 */
export class Tile {
  private theme: Theme;
  private root: BoxRenderable;
  private primaryText: TextRenderable;
  private secondaryText?: TextRenderable;
  private primary: string;
  private secondary: string | readonly string[] | undefined;
  private icon: string | undefined;
  private isSelected = false;

  constructor(renderer: CliRenderer, theme: Theme, options: TileOptions) {
    this.theme = theme;
    this.primary = options.primary;
    this.secondary = options.secondary;
    this.icon = options.icon;

    this.root = new BoxRenderable(renderer, {
      id: options.id,
      flexDirection: "column",
      flexShrink: 0,
      width: options.width ?? 28,
      height: options.height ?? undefined,
      paddingX: 1,
      borderStyle: "rounded",
      borderColor: theme.accent,
      shouldFill: false,
    });

    this.primaryText = new TextRenderable(renderer, {
      id: `${options.id}-primary`,
      content: formatPrimary(theme, options.primary, options.icon, false),
      flexGrow: 1,
    });
    if (!options.secondary) {
      this.primaryText.marginTop = 1;
      this.primaryText.marginBottom = 1;
    }
    this.root.add(this.primaryText);

    if (options.secondary) {
      this.secondaryText = new TextRenderable(renderer, {
        id: `${options.id}-secondary`,
        content: formatSecondary(theme, options.secondary),
        marginTop: 1,
      });
      this.root.add(this.secondaryText);
    }
  }

  get box(): BoxRenderable {
    return this.root;
  }

  setPrimary(primary: string): void {
    this.primary = primary;
    this.applyContentStyles();
  }

  setSecondary(secondary: string | readonly string[] | undefined): void {
    if (!secondary || !this.secondaryText) {
      return;
    }

    this.secondary = secondary;
    this.secondaryText.visible = true;
    this.applyContentStyles();
  }

  setSelected(selected: boolean): void {
    this.isSelected = selected;
    if (selected) {
      this.root.shouldFill = true;
      this.root.backgroundColor = this.theme.bgSelected;
    } else {
      this.root.shouldFill = false;
      this.root.backgroundColor = undefined;
    }
    this.applyContentStyles();
  }

  private applyContentStyles(): void {
    this.primaryText.content = formatPrimary(
      this.theme,
      this.primary,
      this.icon,
      this.isSelected,
    );

    if (this.secondaryText && this.secondary !== undefined) {
      this.secondaryText.content = formatSecondary(this.theme, this.secondary);
    }
  }
}
