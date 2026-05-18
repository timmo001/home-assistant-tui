import {
  type CliRenderer,
  BoxRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  type KeyEvent,
  t,
  fg,
} from "@opentui/core";
import Fuse from "fuse.js";
import type { MenuItem } from "../types.js";
import type { Theme } from "../theme.js";

/** Width of the left icon column in characters */
const ICON_COLUMN_WIDTH = 4;

/** Sentinel item ID prefix for pagination rows */
const SENTINEL_NEXT = "__page_next__";
const SENTINEL_PREV = "__page_prev__";

/** Internal state for a single rendered menu row */
interface MenuRow {
  readonly container: BoxRenderable;
  readonly iconCol: BoxRenderable;
  readonly iconText: TextRenderable;
  readonly titleText: TextRenderable;
  readonly descText: TextRenderable;
  /** Mutable so in-place patches can keep the stored item in sync with the rendered content */
  item: MenuItem;
  /** Whether this row is a pagination sentinel */
  readonly isSentinel: boolean;
}

/** Configuration for the {@link MenuList} component */
export interface MenuListOptions {
  /** Unique renderable ID */
  readonly id: string;
  /** Menu items to display */
  readonly items: readonly MenuItem[];
  /** Active colour theme */
  readonly theme: Theme;
  /** Called when the user presses Enter on an item */
  readonly onSelect: (item: MenuItem) => void;
  /** Called when the highlighted item changes */
  readonly onSelectionChanged?: (item: MenuItem) => void;
  /** Called when filter text changes (for external display) */
  readonly onFilterChange?: (filter: string) => void;
  /** Called when Escape is pressed with an empty filter */
  readonly onEscape?: () => void;
  /** Called when Backspace is pressed with an empty filter */
  readonly onBack?: () => void;
  /** Index of the initially selected item */
  readonly initialSelectedIndex?: number;
  /** Whether navigation wraps around (default: true) */
  readonly wrapSelection?: boolean;
  /**
   * Maximum items to render per page. When the filtered list exceeds this
   * threshold, pagination sentinels ("Next page →" / "← Previous page")
   * are appended/prepended. PgUp/PgDn also navigate pages.
   * Default: undefined (no pagination).
   */
  readonly pageSize?: number;
  /** Called when the current page changes (for external page indicators) */
  readonly onPageChange?: (page: number, totalPages: number) => void;
  /**
   * When true, the MenuList does NOT run its internal Fuse.js filter.
   * Instead it only accumulates filter text and emits `onFilterChange`.
   * The consumer is responsible for calling `setFilteredItems()` with
   * externally-filtered results.
   * Default: false.
   */
  readonly externalFilter?: boolean;
}

/**
 * Custom menu list with left-aligned full-height icons, vertical scrolling,
 * and walker-style fuzzy type-to-filter.
 *
 * Each item renders as a two-line row:
 * - Line 1: icon character + title text
 * - Line 2: blank icon column + description text
 *
 * Typing any printable character accumulates a fuzzy filter query
 * (powered by Fuse.js with weighted keys). Escape clears the filter;
 * Backspace removes the last character.
 *
 * When `pageSize` is set, large lists are paginated: at most `pageSize`
 * items are rendered at a time, with sentinel rows for page navigation.
 */
export class MenuList extends ScrollBoxRenderable {
  private _allItems: readonly MenuItem[];
  private _items: readonly MenuItem[];
  private _selectedIndex: number;
  private readonly _wrapSelection: boolean;
  private _rows: MenuRow[] = [];
  private readonly _selectCb: (item: MenuItem) => void;
  private readonly _selectionChangedCb?: (item: MenuItem) => void;
  private readonly _onFilterChange?: (filter: string) => void;
  private readonly _onEscape?: () => void;
  private readonly _onBack?: () => void;
  private readonly _onPageChange?: (page: number, totalPages: number) => void;
  private readonly _renderer: CliRenderer;
  private readonly _theme: Theme;
  private readonly _externalFilter: boolean;

  private _filterText = "";
  private _fuse: Fuse<MenuItem>;

  // Pagination state
  private readonly _pageSize: number | undefined;
  private _currentPage = 0;

  constructor(renderer: CliRenderer, options: MenuListOptions) {
    super(renderer, {
      id: options.id,
      flexGrow: 1,
      width: "100%",
      scrollY: true,
      scrollX: false,
      viewportCulling: true,
      backgroundColor: options.theme.bgElevated,
      focusable: true,
    });

    this._renderer = renderer;
    this._theme = options.theme;
    this._allItems = options.items;
    this._items = options.items;
    this._selectedIndex = options.initialSelectedIndex ?? 0;
    this._wrapSelection = options.wrapSelection ?? true;
    this._selectCb = options.onSelect;
    this._selectionChangedCb = options.onSelectionChanged;
    this._onFilterChange = options.onFilterChange;
    this._onEscape = options.onEscape;
    this._onBack = options.onBack;
    this._pageSize = options.pageSize;
    this._onPageChange = options.onPageChange;
    this._externalFilter = options.externalFilter ?? false;

    this._fuse = this._createFuse(options.items);
    this._buildRows();
  }

  /** Replace displayed items and reset selection and filter to the top */
  setItems(items: readonly MenuItem[]): void {
    this._clearRows();
    this._allItems = items;
    this._items = items;
    this._filterText = "";
    this._currentPage = 0;
    this._fuse = this._createFuse(items);
    this._selectedIndex = 0;
    this._buildRows();
    this._onFilterChange?.("");
    this._emitPageChange();
  }

  /**
   * Replace displayed items without resetting filter text or page.
   * Used when filtering is managed externally (`externalFilter: true`).
   * Resets selection to top and rebuilds rows for the new item set.
   */
  setFilteredItems(items: readonly MenuItem[]): void {
    // Preserve selection: remember the currently selected item's ID and position
    const prevSelected = this.getSelectedItem();
    const prevId = prevSelected?.id;
    const prevPage = this._currentPage;
    const prevIndex = this._selectedIndex;

    this._clearRows();
    this._items = items;

    // Try to restore page and selection position
    if (prevId && items.length > 0) {
      const globalIndex = items.findIndex((item) => item.id === prevId);
      if (globalIndex >= 0 && this._isPaginated()) {
        // Item still exists — restore to its page and position
        this._currentPage = Math.floor(globalIndex / this._pageSize!);
        const pageStart = this._currentPage * this._pageSize!;
        const indexInPage = globalIndex - pageStart;
        this._selectedIndex =
          (this._hasPrevSentinel() ? 1 : 0) + indexInPage;
      } else if (globalIndex >= 0) {
        // No pagination — just set the index
        this._currentPage = 0;
        this._selectedIndex = globalIndex;
      } else {
        // Item gone — jump to top
        this._currentPage = 0;
        this._selectedIndex = this._hasPrevSentinel() ? 1 : 0;
      }
    } else {
      this._currentPage = 0;
      this._selectedIndex = this._hasPrevSentinel() ? 1 : 0;
    }

    this._buildRows();
    this._emitPageChange();
  }

  /** Programmatically select an item by index */
  setSelectedIndex(index: number): void {
    if (
      index < 0 ||
      index >= this._pageItems().length ||
      index === this._selectedIndex
    )
      return;
    this._applySelection(index);
  }

  /** Return the currently highlighted item */
  getSelectedItem(): MenuItem | undefined {
    const pageItems = this._pageItems();
    return pageItems[this._selectedIndex];
  }

  /** Clear the filter and restore the full item list */
  resetFilter(): void {
    if (this._filterText.length === 0) return;
    this._filterText = "";
    this._currentPage = 0;
    this._applyFilter();
  }

  /** Current page index (0-based) */
  get currentPage(): number {
    return this._currentPage;
  }

  /** Total number of pages (1 when no pagination) */
  get totalPages(): number {
    return this._computeTotalPages();
  }

  /** Total item count (after filtering) */
  get filteredCount(): number {
    return this._items.length;
  }

  /**
   * Update a single item's title and/or description in-place.
   *
   * Does not reset selection, scroll position, or the filter query.
   * If the item is currently filtered out it is still updated in `_allItems`
   * so the next filter pass reflects the new content.
   */
  patchItemById(
    id: string,
    patch: Partial<Pick<MenuItem, "title" | "description">>,
  ): void {
    // Update in _allItems (always, so Fuse and future filter passes see fresh data)
    const allIdx = this._allItems.findIndex((i) => i.id === id);
    if (allIdx === -1) return;

    const updatedItem: MenuItem = { ...this._allItems[allIdx], ...patch };
    this._allItems = [
      ...this._allItems.slice(0, allIdx),
      updatedItem,
      ...this._allItems.slice(allIdx + 1),
    ];
    this._fuse = this._createFuse(this._allItems);

    // Update in the current filtered view if the item is visible
    const itemIdx = this._items.findIndex((i) => i.id === id);
    if (itemIdx === -1) return;

    this._items = [
      ...this._items.slice(0, itemIdx),
      updatedItem,
      ...this._items.slice(itemIdx + 1),
    ];

    // Check if this item is on the current page
    const pageItems = this._pageItems();
    const pageIdx = pageItems.findIndex((i) => i.id === id);
    if (pageIdx === -1) return;

    // Account for the "prev page" sentinel offset
    const rowOffset = this._hasPrevSentinel() ? 1 : 0;
    const row = this._rows[pageIdx + rowOffset];
    if (!row || row.isSentinel) return;

    row.item = updatedItem;

    const isSelected = pageIdx + rowOffset === this._selectedIndex;
    const th = this._theme;
    const textColor = isSelected ? th.accent : th.fg;

    if (patch.title !== undefined) {
      row.titleText.content = t`${fg(textColor)(updatedItem.title)}`;
    }
    if (patch.description !== undefined) {
      row.descText.content = t`${fg(th.fgMuted)(updatedItem.description)}`;
    }
  }

  /** Whether a filter query is currently active */
  get hasFilter(): boolean {
    return this._filterText.length > 0;
  }

  // -- Keyboard handling ------------------------------------------------

  handleKeyPress(key: KeyEvent): boolean {
    // Escape: clear filter → or fire onEscape callback
    if (key.name === "escape") {
      if (this._filterText.length > 0) {
        this._filterText = "";
        this._currentPage = 0;
        this._applyFilter();
        return true;
      }
      if (this._onEscape) {
        this._onEscape();
        return true;
      }
      return false;
    }

    // Backspace: remove last filter char → or fire onBack callback
    if (key.name === "backspace") {
      if (this._filterText.length > 0) {
        this._filterText = this._filterText.slice(0, -1);
        this._currentPage = 0;
        this._applyFilter();
        return true;
      }
      if (this._onBack) {
        this._onBack();
        return true;
      }
      return false;
    }

    // Page navigation
    if (key.name === "pagedown") {
      this._nextPage();
      return true;
    }
    if (key.name === "pageup") {
      this._prevPage();
      return true;
    }

    // Arrow navigation
    if (key.name === "up") {
      this._moveSelection(-1);
      return true;
    }
    if (key.name === "down") {
      this._moveSelection(1);
      return true;
    }

    // Enter: select highlighted item or handle sentinel
    if (key.name === "return") {
      const row = this._rows[this._selectedIndex];
      if (row?.isSentinel) {
        if (row.item.id === SENTINEL_NEXT) {
          this._nextPage();
        } else if (row.item.id === SENTINEL_PREV) {
          this._prevPage();
        }
        return true;
      }
      const pageItems = this._pageItems();
      const offset = this._hasPrevSentinel() ? 1 : 0;
      const item = pageItems[this._selectedIndex - offset];
      if (item) this._selectCb(item);
      return true;
    }

    // Printable character → fuzzy filter
    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
      const ch = key.sequence;
      if (ch >= " ") {
        this._filterText += ch;
        this._currentPage = 0;
        this._applyFilter();
        return true;
      }
    }

    return super.handleKeyPress(key);
  }

  // -- Pagination -------------------------------------------------------

  private _isPaginated(): boolean {
    return this._pageSize !== undefined && this._items.length > this._pageSize;
  }

  private _computeTotalPages(): number {
    if (!this._pageSize || this._items.length <= this._pageSize) return 1;
    return Math.ceil(this._items.length / this._pageSize);
  }

  private _pageItems(): readonly MenuItem[] {
    if (!this._isPaginated()) return this._items;
    const start = this._currentPage * this._pageSize!;
    const end = start + this._pageSize!;
    return this._items.slice(start, end);
  }

  private _hasPrevSentinel(): boolean {
    return this._isPaginated() && this._currentPage > 0;
  }

  private _hasNextSentinel(): boolean {
    return (
      this._isPaginated() && this._currentPage < this._computeTotalPages() - 1
    );
  }

  private _nextPage(): void {
    if (!this._isPaginated()) return;
    const total = this._computeTotalPages();
    if (this._currentPage >= total - 1) return;
    this._currentPage++;
    this._clearRows();
    this._selectedIndex = this._hasPrevSentinel() ? 1 : 0;
    this._buildRows();
    this._emitPageChange();
  }

  private _prevPage(): void {
    if (!this._isPaginated()) return;
    if (this._currentPage <= 0) return;
    this._currentPage--;
    this._clearRows();
    // Select last real item on the page (before next sentinel)
    const pageItems = this._pageItems();
    const offset = this._hasPrevSentinel() ? 1 : 0;
    this._selectedIndex = offset + pageItems.length - 1;
    this._buildRows();
    this._emitPageChange();
  }

  private _emitPageChange(): void {
    if (this._onPageChange && this._isPaginated()) {
      this._onPageChange(this._currentPage, this._computeTotalPages());
    }
  }

  // -- Private helpers --------------------------------------------------

  /** Create a Fuse.js instance for the given item set */
  private _createFuse(items: readonly MenuItem[]): Fuse<MenuItem> {
    return new Fuse([...items], {
      keys: [
        { name: "title", weight: 4 },
        { name: "keywords", weight: 1.5 },
        { name: "description", weight: 1 },
      ],
      threshold: 0.4,
      ignoreLocation: true,
    });
  }

  /** Re-filter visible items from the full set using current filter text */
  private _applyFilter(): void {
    if (this._externalFilter) {
      // External filter mode: just emit the callback, don't touch items/rows.
      // The consumer will call setFilteredItems() with new results.
      this._onFilterChange?.(this._filterText);
      return;
    }

    this._clearRows();
    if (this._filterText.length === 0) {
      // Restoring full list — preserve selected item position
      const currentItem = this._items[this._selectedIndex];
      this._items = this._allItems;
      const preservedIndex = currentItem
        ? this._items.indexOf(currentItem)
        : -1;
      this._selectedIndex = preservedIndex >= 0 ? preservedIndex : 0;
    } else {
      // Filtering — always select top result
      this._items = this._fuse.search(this._filterText).map((r) => r.item);
      this._selectedIndex = this._hasPrevSentinel() ? 1 : 0;
    }
    this._buildRows();
    this._onFilterChange?.(this._filterText);
    this._emitPageChange();
  }

  private _moveSelection(delta: number): void {
    const len = this._rows.length;
    if (len === 0) return;

    let next = this._selectedIndex + delta;
    if (this._wrapSelection) {
      if (next < 0) next = len - 1;
      else if (next >= len) next = 0;
    } else {
      next = Math.max(0, Math.min(len - 1, next));
    }
    if (next !== this._selectedIndex) this._applySelection(next);
  }

  private _applySelection(newIndex: number): void {
    const oldRow = this._rows[this._selectedIndex];
    const newRow = this._rows[newIndex];
    if (oldRow) this._styleRow(oldRow, false);
    if (newRow) this._styleRow(newRow, true);
    this._selectedIndex = newIndex;
    // Scroll the selected item into view
    if (newRow) this.scrollChildIntoView(newRow.container.id);
    // Emit selection changed for non-sentinel rows
    if (newRow && !newRow.isSentinel) {
      this._selectionChangedCb?.(newRow.item);
    }
  }

  private _clearRows(): void {
    for (const row of this._rows) {
      this.remove(row.container.id);
    }
    this._rows = [];
  }

  private _buildRows(): void {
    // Prepend "← Previous page" sentinel if not on first page
    if (this._hasPrevSentinel()) {
      const sentinel = this._createSentinelRow(
        SENTINEL_PREV,
        "←",
        "Previous page",
        0 === this._selectedIndex,
      );
      this._rows.push(sentinel);
      this.add(sentinel.container);
    }

    // Render page items
    const pageItems = this._pageItems();
    const offset = this._hasPrevSentinel() ? 1 : 0;
    for (let i = 0; i < pageItems.length; i++) {
      const item = pageItems[i];
      const isSelected = i + offset === this._selectedIndex;
      const row = this._createRow(item, i + offset, isSelected);
      this._rows.push(row);
      this.add(row.container);
    }

    // Append "Next page →" sentinel if not on last page
    if (this._hasNextSentinel()) {
      const sentinelIdx = offset + pageItems.length;
      const sentinel = this._createSentinelRow(
        SENTINEL_NEXT,
        "→",
        "Next page",
        sentinelIdx === this._selectedIndex,
      );
      this._rows.push(sentinel);
      this.add(sentinel.container);
    }
  }

  private _createSentinelRow(
    id: string,
    icon: string,
    title: string,
    isSelected: boolean,
  ): MenuRow {
    const th = this._theme;
    const bgColor = isSelected ? th.bgSelected : th.bgElevated;
    const textColor = isSelected ? th.accent : th.fgSubtle;

    const container = new BoxRenderable(this._renderer, {
      id: `${this.id}-${id}`,
      flexDirection: "row",
      width: "100%",
      flexShrink: 0,
      backgroundColor: bgColor,
    });

    const iconCol = new BoxRenderable(this._renderer, {
      id: `${this.id}-${id}-icol`,
      width: ICON_COLUMN_WIDTH,
      paddingLeft: 1,
    });
    const iconText = new TextRenderable(this._renderer, {
      id: `${this.id}-${id}-icon`,
      content: t`${fg(textColor)(icon)}`,
    });
    iconCol.add(iconText);
    container.add(iconCol);

    const textCol = new BoxRenderable(this._renderer, {
      id: `${this.id}-${id}-tcol`,
      flexGrow: 1,
      flexDirection: "column",
    });
    const titleText = new TextRenderable(this._renderer, {
      id: `${this.id}-${id}-title`,
      content: t`${fg(textColor)(title)}`,
    });
    const descText = new TextRenderable(this._renderer, {
      id: `${this.id}-${id}-desc`,
      content: t``,
    });
    textCol.add(titleText);
    textCol.add(descText);
    container.add(textCol);

    const sentinelItem: MenuItem = {
      id,
      icon,
      title,
      description: "",
      action: { type: "noop" },
    };

    return {
      container,
      iconCol,
      iconText,
      titleText,
      descText,
      item: sentinelItem,
      isSentinel: true,
    };
  }

  private _createRow(
    item: MenuItem,
    index: number,
    isSelected: boolean,
  ): MenuRow {
    const th = this._theme;
    const id = `${this.id}-row-${index}`;
    const bgColor = isSelected ? th.bgSelected : th.bgElevated;
    const textColor = isSelected ? th.accent : th.fg;
    const descColor = isSelected ? th.fgMuted : th.fgMuted;

    // Row container — horizontal layout, full width
    const container = new BoxRenderable(this._renderer, {
      id,
      flexDirection: "row",
      width: "100%",
      flexShrink: 0,
      backgroundColor: bgColor,
    });

    // Icon column — fixed width, icon on the top row spanning full height
    const iconCol = new BoxRenderable(this._renderer, {
      id: `${id}-icol`,
      width: ICON_COLUMN_WIDTH,
      paddingLeft: 1,
    });
    const iconText = new TextRenderable(this._renderer, {
      id: `${id}-icon`,
      content: t`${fg(textColor)(item.icon)}`,
    });
    iconCol.add(iconText);
    container.add(iconCol);

    // Text column — title + description stacked vertically
    const textCol = new BoxRenderable(this._renderer, {
      id: `${id}-tcol`,
      flexGrow: 1,
      flexDirection: "column",
    });
    const titleText = new TextRenderable(this._renderer, {
      id: `${id}-title`,
      content: t`${fg(textColor)(item.title)}`,
    });
    const descText = new TextRenderable(this._renderer, {
      id: `${id}-desc`,
      content: t`${fg(descColor)(item.description)}`,
    });
    textCol.add(titleText);
    textCol.add(descText);
    container.add(textCol);

    return {
      container,
      iconCol,
      iconText,
      titleText,
      descText,
      item,
      isSentinel: false,
    };
  }

  private _styleRow(row: MenuRow, selected: boolean): void {
    const th = this._theme;
    const bg = selected ? th.bgSelected : th.bgElevated;
    const textColor = row.isSentinel
      ? selected
        ? th.accent
        : th.fgSubtle
      : selected
        ? th.accent
        : th.fg;
    const descColor = selected ? th.fgMuted : th.fgMuted;

    row.container.backgroundColor = bg;
    row.iconText.content = t`${fg(textColor)(row.item.icon)}`;
    row.titleText.content = t`${fg(textColor)(row.item.title)}`;
    if (!row.isSentinel) {
      row.descText.content = t`${fg(descColor)(row.item.description)}`;
    }
  }
}
