import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  t,
  fg,
  bold,
} from "@opentui/core";
import type { Theme } from "../theme.js";

/** Width of the optional left icon column in characters */
const ICON_COLUMN_WIDTH = 4;

export type SectionHeadingOptions = {
  readonly id: string;
  readonly title: string;
  readonly icon?: string;
  readonly marginTop?: number;
  readonly marginBottom?: number;
};

/**
 * Full-width section heading row inside a wrapping tile grid.
 *
 * Uses {@code width: 100%} so flex-wrap places the heading on its own row.
 */
export class SectionHeading {
  private theme: Theme;
  private root: BoxRenderable;
  private iconText: TextRenderable | null = null;
  private titleText: TextRenderable;

  constructor(
    renderer: CliRenderer,
    theme: Theme,
    options: SectionHeadingOptions,
  ) {
    this.theme = theme;

    this.root = new BoxRenderable(renderer, {
      id: options.id,
      flexDirection: "row",
      width: "100%",
      flexShrink: 0,
      alignItems: "center",
      shouldFill: false,
      marginTop: options.marginTop,
      marginBottom: options.marginBottom ?? 1,
    });

    if (options.icon) {
      const iconCol = new BoxRenderable(renderer, {
        id: `${options.id}-icol`,
        width: ICON_COLUMN_WIDTH,
        paddingLeft: 1,
        alignItems: "center",
      });
      this.iconText = new TextRenderable(renderer, {
        id: `${options.id}-icon`,
        content: formatIcon(theme, options.icon),
      });
      iconCol.add(this.iconText);
      this.root.add(iconCol);
    }

    this.titleText = new TextRenderable(renderer, {
      id: `${options.id}-title`,
      content: formatTitle(theme, options.title),
    });
    this.root.add(this.titleText);
  }

  get box(): BoxRenderable {
    return this.root;
  }

  setTitle(title: string): void {
    this.titleText.content = formatTitle(this.theme, title);
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }
}

function formatTitle(theme: Theme, title: string) {
  return t`${bold(fg(theme.fgSubtle)(title))}`;
}

function formatIcon(theme: Theme, icon: string) {
  return t`${fg(theme.fgSubtle)(icon)}`;
}
