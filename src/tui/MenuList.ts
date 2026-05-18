import {
  type CliRenderer,
  BoxRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  type KeyEvent,
  t,
  fg,
  bold,
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
  /** Whether this row is a non-selectable group header */
  readonly isGroupHeader: boolean;
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
  /**
   * Called for key events before the default MenuList handling.
   * Return `true` to indicate the key was consumed.
   */
  readonly onKeyPress?: (key: KeyEvent) => boolean;
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
  private readonly _onKeyPress?: (key: KeyEvent) => boolean;
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
    this._onKeyPress = options.onKeyPress;
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
   *
   * If the page structure is unchanged (same item IDs, same groups, same page),
   * rows are patched in-place to avoid flicker and scroll position loss.
   * Otherwise, a full rebuild is performed with selection restoration.
   */
  setFilteredItems(items: readonly MenuItem[]): void {
    // Preserve selection: remember the currently selected item's ID
    const prevSelected = this.getSelectedItem();
    const prevId = prevSelected?.id;

    const prevItems = this._items;
    this._items = items;

    // Determine the target page
    let targetPage = this._currentPage;
    if (prevId && items.length > 0 && this._isPaginated()) {
      const globalIndex = items.findIndex((item) => item.id === prevId);
      if (globalIndex >= 0) {
        targetPage = Math.floor(globalIndex / this._pageSize!);
      } else {
        targetPage = 0;
      }
    } else if (items.length === 0) {
      targetPage = 0;
    }

    // Check if we can do an in-place patch (same page, same structure)
    if (
      targetPage === this._currentPage &&
      this._rows.length > 0 &&
      this._canPatchInPlace(prevItems, items, targetPage)
    ) {
      this._patchRowsInPlace();
      this._emitPageChange();
      return;
    }

    // Full rebuild required
    this._clearRows();
    this._currentPage = targetPage;

    // Start at top, _buildRows will ensure it's on a selectable row
    this._selectedIndex = 0;
    this._buildRows();

    // Try to restore selection to the previously selected item's row
    if (prevId) {
      const restoredRowIdx = this._rows.findIndex(
        (r) => !r.isGroupHeader && !r.isSentinel && r.item.id === prevId,
      );
      if (restoredRowIdx >= 0 && restoredRowIdx !== this._selectedIndex) {
        this._applySelection(restoredRowIdx);
      }
    }

    this._emitPageChange();
  }

  /**
   * Check if the current page structure matches the new items so rows
   * can be patched in-place without a full rebuild.
   */
  private _canPatchInPlace(
    _prevItems: readonly MenuItem[],
    newItems: readonly MenuItem[],
    targetPage: number,
  ): boolean {
    // Get new page items
    let newPageItems: readonly MenuItem[];
    if (this._pageSize && newItems.length > this._pageSize) {
      const start = targetPage * this._pageSize;
      const end = start + this._pageSize;
      newPageItems = newItems.slice(start, end);
    } else {
      newPageItems = newItems;
    }

    // Walk current rows and compare against new page items
    let itemIdx = 0;
    for (const row of this._rows) {
      if (row.isSentinel) continue;
      if (row.isGroupHeader) {
        // Check that the next item in the new list starts a group with this name
        const nextItem = newPageItems[itemIdx];
        if (!nextItem || nextItem.group !== row.item.title) return false;
        continue;
      }
      // Regular item row — must match by ID and group
      const newItem = newPageItems[itemIdx];
      if (!newItem) return false;
      if (newItem.id !== row.item.id) return false;
      if (newItem.group !== row.item.group) return false;
      itemIdx++;
    }

    // All items must be accounted for
    return itemIdx === newPageItems.length;
  }

  /**
   * Patch row text content in-place without removing/re-adding DOM nodes.
   * Preserves scroll position and avoids flicker.
   */
  private _patchRowsInPlace(): void {
    const th = this._theme;
    const pageItems = this._pageItems();
    let itemIdx = 0;

    for (let rowIdx = 0; rowIdx < this._rows.length; rowIdx++) {
      const row = this._rows[rowIdx];
      if (row.isSentinel || row.isGroupHeader) continue;

      const newItem = pageItems[itemIdx];
      if (!newItem) break;

      // Update stored item reference
      row.item = newItem;

      // Re-render text with correct selection styling
      const isSelected = rowIdx === this._selectedIndex;
      const textColor = isSelected ? th.accent : th.fg;
      row.iconText.content = t`${fg(textColor)(newItem.icon)}`;
      row.titleText.content = t`${fg(textColor)(newItem.title)}`;
      row.descText.content = t`${fg(th.fgMuted)(newItem.description)}`;

      itemIdx++;
    }
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
    const row = this._rows[this._selectedIndex];
    if (!row || row.isGroupHeader || row.isSentinel) return undefined;
    return row.item;
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

    // Find the matching row (accounts for group headers and sentinels)
    const rowIdx = this._rows.findIndex(
      (r) => !r.isSentinel && !r.isGroupHeader && r.item.id === id,
    );
    if (rowIdx === -1) return;
    const row = this._rows[rowIdx];

    row.item = updatedItem;

    const isSelected = rowIdx === this._selectedIndex;
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
    // Give the consumer a chance to handle the key first
    if (this._onKeyPress?.(key)) return true;

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
      if (!row || row.isGroupHeader) return true;
      if (row.isSentinel) {
        if (row.item.id === SENTINEL_NEXT) {
          this._nextPage();
        } else if (row.item.id === SENTINEL_PREV) {
          this._prevPage();
        }
        return true;
      }
      this._selectCb(row.item);
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
    this._selectedIndex = 0;
    this._buildRows();
    // _buildRows ensures selection lands on a selectable row
    this._emitPageChange();
  }

  private _prevPage(): void {
    if (!this._isPaginated()) return;
    if (this._currentPage <= 0) return;
    this._currentPage--;
    this._clearRows();
    // Select last selectable row on the page (before next sentinel)
    this._selectedIndex = 0;
    this._buildRows();
    // Navigate to last selectable row
    const lastSelectable = this._rows.findLastIndex(
      (r) => !r.isGroupHeader && !r.isSentinel,
    );
    if (lastSelectable >= 0 && lastSelectable !== this._selectedIndex) {
      this._applySelection(lastSelectable);
    }
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

    // Remember currently selected item before clearing
    const currentRow = this._rows[this._selectedIndex];
    const currentItemId =
      currentRow && !currentRow.isGroupHeader && !currentRow.isSentinel
        ? currentRow.item.id
        : undefined;

    this._clearRows();
    if (this._filterText.length === 0) {
      // Restoring full list — try to preserve selected item
      this._items = this._allItems;
      this._selectedIndex = 0;
      this._buildRows();
      // Restore selection if item still exists
      if (currentItemId) {
        const restoredIdx = this._rows.findIndex(
          (r) => !r.isGroupHeader && !r.isSentinel && r.item.id === currentItemId,
        );
        if (restoredIdx >= 0) this._applySelection(restoredIdx);
      }
    } else {
      // Filtering — always select top result
      this._items = this._fuse.search(this._filterText).map((r) => r.item);
      this._selectedIndex = 0;
      this._buildRows();
    }
    this._onFilterChange?.(this._filterText);
    this._emitPageChange();
  }

  private _moveSelection(delta: number): void {
    const len = this._rows.length;
    if (len === 0) return;

    const direction = delta > 0 ? 1 : -1;
    let next = this._selectedIndex;

    // Move in the given direction, skipping group headers
    for (let steps = Math.abs(delta); steps > 0; ) {
      next += direction;
      if (this._wrapSelection) {
        if (next < 0) next = len - 1;
        else if (next >= len) next = 0;
      } else {
        if (next < 0 || next >= len) {
          next = this._selectedIndex;
          break;
        }
      }
      // Only count this step if we landed on a selectable row
      if (!this._rows[next]?.isGroupHeader) steps--;
      // Safety: avoid infinite loops if all rows are headers
      if (next === this._selectedIndex) break;
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

    // Render page items with group headers
    const pageItems = this._pageItems();
    let rowIndex = this._hasPrevSentinel() ? 1 : 0;
    let lastGroup: string | undefined;

    for (let i = 0; i < pageItems.length; i++) {
      const item = pageItems[i];

      // Insert group header when group changes
      if (item.group !== undefined && item.group !== lastGroup) {
        const header = this._createGroupHeaderRow(item.group, rowIndex);
        this._rows.push(header);
        this.add(header.container);
        rowIndex++;
      }
      lastGroup = item.group;

      const isSelected = rowIndex === this._selectedIndex;
      const row = this._createRow(item, rowIndex, isSelected);
      this._rows.push(row);
      this.add(row.container);
      rowIndex++;
    }

    // Append "Next page →" sentinel if not on last page
    if (this._hasNextSentinel()) {
      const sentinel = this._createSentinelRow(
        SENTINEL_NEXT,
        "→",
        "Next page",
        rowIndex === this._selectedIndex,
      );
      this._rows.push(sentinel);
      this.add(sentinel.container);
    }

    // Ensure initial selection is on a selectable row
    if (this._rows.length > 0 && this._rows[this._selectedIndex]?.isGroupHeader) {
      this._selectedIndex = this._nextSelectableIndex(this._selectedIndex, 1);
    }
  }

  private _createGroupHeaderRow(group: string, index: number): MenuRow {
    const th = this._theme;
    const id = `${this.id}-grp-${index}`;

    const container = new BoxRenderable(this._renderer, {
      id,
      flexDirection: "row",
      width: "100%",
      flexShrink: 0,
      backgroundColor: th.bgElevated,
      paddingTop: index > 0 ? 1 : 0,
    });

    // Empty icon column for alignment
    const iconCol = new BoxRenderable(this._renderer, {
      id: `${id}-icol`,
      width: ICON_COLUMN_WIDTH,
      paddingLeft: 1,
    });
    const iconText = new TextRenderable(this._renderer, {
      id: `${id}-icon`,
      content: t``,
    });
    iconCol.add(iconText);
    container.add(iconCol);

    // Group title — bold and dimmed to distinguish from selectable items
    const textCol = new BoxRenderable(this._renderer, {
      id: `${id}-tcol`,
      flexGrow: 1,
      flexDirection: "column",
    });
    const titleText = new TextRenderable(this._renderer, {
      id: `${id}-title`,
      content: t`${bold(fg(th.fgSubtle)(group))}`,
    });
    const descText = new TextRenderable(this._renderer, {
      id: `${id}-desc`,
      content: t``,
    });
    textCol.add(titleText);
    textCol.add(descText);
    container.add(textCol);

    const headerItem: MenuItem = {
      id: `__group_${group}__`,
      icon: "",
      title: group,
      description: "",
      action: { type: "noop" },
    };

    return {
      container,
      iconCol,
      iconText,
      titleText,
      descText,
      item: headerItem,
      isSentinel: false,
      isGroupHeader: true,
    };
  }

  /** Find the next selectable row index in the given direction, skipping group headers */
  private _nextSelectableIndex(from: number, direction: 1 | -1): number {
    const len = this._rows.length;
    if (len === 0) return 0;
    let idx = from;
    for (let attempts = 0; attempts < len; attempts++) {
      idx += direction;
      if (this._wrapSelection) {
        if (idx < 0) idx = len - 1;
        else if (idx >= len) idx = 0;
      } else {
        if (idx < 0 || idx >= len) return from;
      }
      if (!this._rows[idx]?.isGroupHeader) return idx;
    }
    return from;
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
      isGroupHeader: false,
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
      isGroupHeader: false,
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
