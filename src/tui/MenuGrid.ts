import {
  type CliRenderer,
  type KeyEvent,
  ScrollBoxRenderable,
} from "@opentui/core";
import type { Theme } from "../theme.js";
import { SectionHeading } from "./SectionHeading.js";
import { Tile } from "./Tile.js";

export type MenuGridItem = {
  readonly id: string;
  readonly primary: string;
  readonly secondary?: string | readonly string[];
  readonly icon?: string;
};

export type MenuGridSection = {
  readonly id: string;
  readonly title: string;
  readonly icon?: string;
  readonly items: readonly MenuGridItem[];
};

export type MenuGridOptions = {
  readonly id: string;
  /** View-level scroll container; grid children are added to its content */
  readonly scroll: ScrollBoxRenderable;
  readonly tileWidth?: number;
  readonly gap?: number;
};

type GridSectionState = {
  readonly id: string;
  readonly title: string;
  readonly icon: string | undefined;
  readonly items: readonly MenuGridItem[];
  readonly heading: SectionHeading | null;
};

type TileLayout = {
  readonly id: string;
  readonly sectionIndex: number;
  readonly tileIndex: number;
  readonly centerX: number;
  readonly centerY: number;
};

type MoveDirection = "left" | "right" | "up" | "down";

/**
 * Tile grid content for a parent-owned {@link ScrollBoxRenderable}.
 *
 * Sections render as a full-width {@link SectionHeading} row plus wrapping
 * tiles. Arrow keys move selection within and across sections.
 */
export class MenuGrid {
  private renderer: CliRenderer;
  private theme: Theme;
  private scroll: ScrollBoxRenderable;
  private tileWidth: number;
  private gap: number;

  private sections: Array<GridSectionState> = [];
  private tiles = new Map<string, Tile>();
  private entryIds: Array<string> = [];
  private sectionIndex = 0;
  private tileIndex = 0;
  private isFocused = false;

  constructor(renderer: CliRenderer, theme: Theme, options: MenuGridOptions) {
    this.renderer = renderer;
    this.theme = theme;
    this.scroll = options.scroll;
    this.tileWidth = options.tileWidth ?? 28;
    this.gap = options.gap ?? 1;

    renderer.on("resize", () => {
      if (this.isFocused) {
        this.applySelection();
      }
    });
  }

  get scrollBox(): ScrollBoxRenderable {
    return this.scroll;
  }

  hasEntries(): boolean {
    return this.entryIds.length > 0;
  }

  isGridFocused(): boolean {
    return this.isFocused;
  }

  getSelectedId(): string | undefined {
    const section = this.sections[this.sectionIndex];
    return section?.items[this.tileIndex]?.id;
  }

  setSections(sections: readonly MenuGridSection[]): void {
    this.clearContent();
    this.sections = [];
    this.entryIds = [];
    this.sectionIndex = 0;
    this.tileIndex = 0;

    let isFirstSection = true;
    for (const section of sections) {
      if (section.items.length === 0) continue;

      const heading =
        section.title.length > 0
          ? new SectionHeading(this.renderer, this.theme, {
              id: `${this.scroll.id}-heading-${section.id}`,
              title: section.title,
              icon: section.icon,
              marginTop: isFirstSection ? 0 : 1,
            })
          : null;

      if (heading) {
        this.scroll.add(heading.box);
      }

      const state: GridSectionState = {
        id: section.id,
        title: section.title,
        icon: section.icon,
        items: section.items,
        heading,
      };
      this.sections.push(state);

      for (const item of section.items) {
        const tile = new Tile(this.renderer, this.theme, {
          id: `${this.scroll.id}-tile-${item.id}`,
          primary: item.primary,
          secondary: item.secondary,
          icon: item.icon,
          width: this.tileWidth,
        });
        this.tiles.set(item.id, tile);
        this.entryIds.push(item.id);
        this.scroll.add(tile.box);
      }

      isFirstSection = false;
    }

    if (this.isFocused) {
      this.applySelection();
    }
  }

  /** Single section without a heading row */
  setItems(items: readonly MenuGridItem[]): void {
    this.setSections([{ id: "default", title: "", items }]);
  }

  updateItem(
    id: string,
    patch: { primary?: string; secondary?: string | readonly string[] },
  ): void {
    const tile = this.tiles.get(id);
    if (!tile) return;
    if (patch.primary !== undefined) {
      tile.setPrimary(patch.primary);
    }
    if (patch.secondary !== undefined) {
      tile.setSecondary(patch.secondary);
    }
  }

  clear(): void {
    this.clearContent();
    this.sections = [];
    this.entryIds = [];
    this.sectionIndex = 0;
    this.tileIndex = 0;
    this.isFocused = false;
  }

  focus(): void {
    if (this.entryIds.length === 0) return;
    this.isFocused = true;
    this.applySelection();
  }

  blur(): void {
    this.isFocused = false;
    for (const tile of this.tiles.values()) {
      tile.setSelected(false);
    }
  }

  resetSelection(): void {
    this.sectionIndex = 0;
    this.tileIndex = 0;
    this.scroll.scrollTop = 0;
    this.applySelection();
  }

  handleKeyPress(key: KeyEvent): boolean {
    if (this.entryIds.length === 0) {
      return false;
    }

    const isArrow =
      key.name === "down" ||
      key.name === "up" ||
      key.name === "left" ||
      key.name === "right";

    if (!isArrow) {
      return false;
    }

    if (!this.isFocused) {
      this.focus();
    }

    this.moveInDirection(key.name as MoveDirection);

    return true;
  }

  private clearContent(): void {
    for (const tile of this.tiles.values()) {
      this.scroll.remove(tile.box.id);
    }
    this.tiles.clear();

    for (const section of this.sections) {
      if (section.heading) {
        this.scroll.remove(section.heading.box.id);
      }
    }
  }

  private moveInDirection(direction: MoveDirection): void {
    const layouts = this.getTileLayouts();
    const current = layouts.find(
      (layout) => layout.id === this.getSelectedId(),
    );
    if (!current) return;

    let best: TileLayout | undefined;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const candidate of layouts) {
      if (candidate.id === current.id) continue;

      const dx = candidate.centerX - current.centerX;
      const dy = candidate.centerY - current.centerY;
      let matches = false;
      let score = 0;

      switch (direction) {
        case "right":
          matches = dx > 0;
          score = Math.abs(dy) * 1000 + dx;
          break;
        case "left":
          matches = dx < 0;
          score = Math.abs(dy) * 1000 - dx;
          break;
        case "down":
          matches = dy > 0;
          score = Math.abs(dx) * 1000 + dy;
          break;
        case "up":
          matches = dy < 0;
          score = Math.abs(dx) * 1000 - dy;
          break;
      }

      if (!matches || score >= bestScore) continue;
      bestScore = score;
      best = candidate;
    }

    if (!best) return;

    this.sectionIndex = best.sectionIndex;
    this.tileIndex = best.tileIndex;
    this.applySelection();
  }

  private getTileLayouts(): Array<TileLayout> {
    this.scroll.updateFromLayout();

    const layouts: Array<TileLayout> = [];
    for (
      let sectionIndex = 0;
      sectionIndex < this.sections.length;
      sectionIndex++
    ) {
      const section = this.sections[sectionIndex];
      for (let tileIndex = 0; tileIndex < section.items.length; tileIndex++) {
        const id = section.items[tileIndex].id;
        const tile = this.tiles.get(id);
        if (!tile) continue;

        const box = tile.box;
        layouts.push({
          id,
          sectionIndex,
          tileIndex,
          centerX: box.x + box.width / 2,
          centerY: box.y + box.height / 2,
        });
      }
    }

    return layouts;
  }

  private applySelection(): void {
    const selectedId = this.getSelectedId();

    for (const tile of this.tiles.values()) {
      tile.setSelected(false);
    }

    if (!this.isFocused || !selectedId) return;

    const tile = this.tiles.get(selectedId);
    if (!tile) return;
    tile.setSelected(true);
    this.scroll.scrollChildIntoView(tile.box.id);
  }
}
