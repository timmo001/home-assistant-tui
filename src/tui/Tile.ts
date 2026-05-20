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
  private secondaryText: TextRenderable;

  constructor(renderer: CliRenderer, theme: Theme, options: TileOptions) {
    this.theme = theme;

    this.root = new BoxRenderable(renderer, {
      id: options.id,
      flexDirection: "column",
      flexShrink: 0,
      width: options.width ?? 28,
      height: options.height ?? undefined,
      paddingX: 1,
      borderStyle: "rounded",
      borderColor: theme.accent,
    });

    this.primaryText = new TextRenderable(renderer, {
      id: `${options.id}-primary`,
      content: t`${fg(theme.fg)(options.primary)}`,
      flexGrow: 1,
    });
    this.root.add(this.primaryText);

    this.secondaryText = new TextRenderable(renderer, {
      id: `${options.id}-secondary`,
      content: options.secondary
        ? formatSecondary(theme, options.secondary)
        : t``,
      marginTop: 1,
      visible: options.secondary !== undefined,
    });
    this.root.add(this.secondaryText);
  }

  get box(): BoxRenderable {
    return this.root;
  }

  setPrimary(primary: string): void {
    this.primaryText.content = t`${fg(this.theme.fg)(primary)}`;
  }

  setSecondary(secondary: string | readonly string[] | undefined): void {
    if (secondary === undefined) {
      this.secondaryText.visible = false;
      this.secondaryText.content = t``;
      return;
    }

    this.secondaryText.visible = true;
    this.secondaryText.content = formatSecondary(this.theme, secondary);
  }
}
