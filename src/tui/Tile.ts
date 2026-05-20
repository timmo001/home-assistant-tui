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
  private isSelected = false;

  constructor(renderer: CliRenderer, theme: Theme, options: TileOptions) {
    this.theme = theme;
    this.primary = options.primary;
    this.secondary = options.secondary;

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
      content: t`${fg(theme.fg)(options.primary)}`,
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
    const primaryColor = this.isSelected ? this.theme.accent : this.theme.fg;
    this.primaryText.content = t`${fg(primaryColor)(this.primary)}`;

    if (this.secondaryText && this.secondary !== undefined) {
      this.secondaryText.content = formatSecondary(this.theme, this.secondary);
    }
  }
}
