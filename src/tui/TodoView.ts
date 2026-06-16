import { type CliRenderer, type KeyEvent, t, fg, dim } from "@opentui/core";
import {
  subscribeEntities,
  type UnsubscribeFunc,
} from "home-assistant-js-websocket";
import type { Connection, HassEntities } from "home-assistant-js-websocket";
import type { MenuItem } from "../types.js";
import type { Theme } from "../theme.js";
import type { Locale } from "../i18n/index.js";
import { globalHelp, type HelpEntry } from "./helpBar.js";
import { MenuList } from "./MenuList.js";
import { ConnectedView, type ConnectedViewOptions } from "./ConnectedView.js";
import { VariantPopup } from "./VariantPopup.js";
import { TodoItemPrompt, type TodoItemPromptValues } from "./TodoItemPrompt.js";
import { ConfirmPrompt } from "./ConfirmPrompt.js";
import {
  TodoItemStatus,
  TodoListEntityFeature,
  computeStateName,
  createItem,
  deleteItems,
  fetchItems,
  getTodoLists,
  subscribeItems,
  supportsFeature,
  updateItem,
  type TodoItem,
  type TodoList,
} from "../data/todo.js";
import { resolveEntityIcon } from "../data/iconResolver.js";
import { twoPhaseSearch } from "../search.js";
import type { FuseOptionKey } from "fuse.js";

const log = (msg: string) => console.error(`[ha-tui:TodoView] ${msg}`);
const PAGE_SIZE = 50;

export type TodoViewOptions = ConnectedViewOptions;

interface SearchableTodoItem extends MenuItem {
  readonly todo: TodoItem;
  readonly searchFields: readonly string[];
}

const FUSE_KEYS: ReadonlyArray<FuseOptionKey<SearchableTodoItem>> = [
  { name: "title", weight: 4 },
  { name: "keywords", weight: 2 },
  { name: "description", weight: 1 },
];

export class TodoView extends ConnectedView {
  private requestedEntityId: string | null = null;
  private selectedEntityId: string | null = null;
  private selectedListName = "";
  private entityStates: HassEntities = {};
  private allItems: TodoItem[] = [];
  private filteredItems: readonly SearchableTodoItem[] = [];
  private showCompleted = false;
  private filterText = "";
  private pageInfoText = "";
  private unsubEntities: UnsubscribeFunc | null = null;
  private unsubItems: (() => Promise<void>) | null = null;
  private pickerPopup: VariantPopup;
  private itemPrompt: TodoItemPrompt;
  private confirmPrompt: ConfirmPrompt;
  private editingItem: TodoItem | null = null;
  private pendingDeleteItem: TodoItem | null = null;

  constructor(
    renderer: CliRenderer,
    theme: Theme,
    strings: Locale,
    options: TodoViewOptions,
  ) {
    super(renderer, theme, strings, options, {
      idPrefix: "todo",
      viewTitle: strings.menu.todo.title,
      initialStatus: strings.todo.loadingLists,
    });

    this.pickerPopup = new VariantPopup(renderer, theme, strings, {
      onSelect: (action) => {
        if (action.type === "view" && action.viewId === "todo") {
          const entityId = action.entityId;
          if (entityId) {
            this.selectTodoList(entityId);
          }
        }
        queueMicrotask(() => this.focus());
      },
      onDismiss: () => queueMicrotask(() => this.focus()),
    });

    this.itemPrompt = new TodoItemPrompt(renderer, theme, strings, {
      onSubmit: (values) => void this.submitItemPrompt(values),
      onDismiss: () => {
        this.editingItem = null;
        queueMicrotask(() => this.focus());
      },
    });

    this.confirmPrompt = new ConfirmPrompt(renderer, theme, {
      onConfirm: () => void this.confirmDeleteSelected(),
      onDismiss: () => {
        this.pendingDeleteItem = null;
        queueMicrotask(() => this.focus());
      },
    });
  }

  setEntityId(entityId: string | null): void {
    this.requestedEntityId = entityId;
    if (this.conn) {
      this.doCleanup();
      void this.initializeForConnection(this.conn);
    }
  }

  get hasPopup(): boolean {
    return (
      this.confirmPrompt.visible ||
      this.itemPrompt.visible ||
      this.pickerPopup.visible
    );
  }

  handleKeyPress(key: KeyEvent): boolean {
    if (this.confirmPrompt.visible) {
      return this.confirmPrompt.handleKeyPress(key);
    }

    if (this.itemPrompt.visible) {
      return this.itemPrompt.handleKeyPress(key);
    }

    if (this.pickerPopup.visible) {
      return this.pickerPopup.handleKeyPress(key);
    }

    return this.menuList.handleKeyPress(key);
  }

  override resetAndFocus(): void {
    this.filterText = "";
    this.rebuildAndDisplay({ resetSelection: true });
    this.updateFilterBar("");
    this.menuList.focus();
  }

  override showStatus(message: string): void {
    if (!this.statusVisible) {
      this.root.insertBefore(this.statusText, this.menuList);
      this.statusVisible = true;
    }
    this.statusText.content = t`${fg(this.theme.fgMuted)(message)}`;
    this.menuList.setFilteredItems([], { resetSelection: true });
    this.pageInfoText = "";
    this.updateFilterBar(this.filterText);
  }

  protected override onBecameVisible(): void {
    if (!this.selectedEntityId && Object.keys(this.entityStates).length > 0) {
      this.handleEntityStatesChanged();
    }
  }

  protected override onBecameHidden(): void {
    this.pickerPopup.hide();
    this.itemPrompt.hide();
    this.confirmPrompt.hide();
  }

  protected buildHelp(): readonly HelpEntry[] {
    return [
      { key: this.strings.keys.arrowsUD, action: this.strings.help.navigate },
      { key: this.strings.keys.enter, action: this.strings.help.select },
      { key: "a", action: this.strings.todo.help.add },
      { key: "e", action: this.strings.todo.help.edit },
      { key: "m", action: this.strings.todo.help.mark },
      { key: "d", action: this.strings.todo.help.delete },
      { key: "v", action: this.strings.todo.help.completed },
      { key: "w", action: this.strings.todo.help.openWeb },
      { key: "/", action: this.strings.help.filter },
      { key: this.strings.keys.pgUpDn, action: this.strings.help.nextPage },
      { key: this.strings.keys.esc, action: this.strings.help.back },
      ...globalHelp(this.strings),
    ];
  }

  protected createMenuList(): MenuList {
    return new MenuList(this.renderer, {
      id: "todo-list",
      items: [],
      theme: this.theme,
      pageSize: PAGE_SIZE,
      externalFilter: true,
      onSelect: () => this.openEditPrompt(),
      onFilterChange: (filter) => this.handleFilterChange(filter),
      onPageChange: () => this.updatePageIndicator(),
      onEscape: () => this.handleBack(),
      onBack: () => this.handleBack(),
      onKeyPress: (key) => this.handleTodoKeyPress(key),
      filterActivation: "slash",
      wrapSelection: false,
    });
  }

  protected async doInitialize(conn: Connection): Promise<void> {
    await this.initializeForConnection(conn);
  }

  protected doCleanup(): void {
    this.unsubEntities?.();
    this.unsubEntities = null;
    if (this.unsubItems) {
      void this.unsubItems();
      this.unsubItems = null;
    }
    this.entityStates = {};
    this.allItems = [];
    this.filteredItems = [];
    this.filterText = "";
    this.pageInfoText = "";
    this.selectedEntityId = null;
    this.selectedListName = "";
    this.editingItem = null;
    this.pendingDeleteItem = null;
    this.pickerPopup.hide();
    this.itemPrompt.hide();
    this.confirmPrompt.hide();
  }

  private async initializeForConnection(conn: Connection): Promise<void> {
    this.showStatus(this.strings.todo.loadingLists);

    try {
      this.unsubEntities = subscribeEntities(conn, (entities) => {
        if (this.conn !== conn) return;
        this.entityStates = entities;
        this.handleEntityStatesChanged();
      });
    } finally {
      this.initializationInProgress = false;
    }
  }

  private handleEntityStatesChanged(): void {
    if (this.selectedEntityId) {
      this.updateSelectedListName();
      return;
    }

    if (this.requestedEntityId) {
      if (!this.isValidTodoEntity(this.requestedEntityId)) {
        this.showStatus(
          this.strings.todo.entityNotFound(this.requestedEntityId),
        );
        return;
      }
      this.selectTodoList(this.requestedEntityId);
      return;
    }

    const lists = getTodoLists(this.entityStates);
    if (!this.isVisible) {
      return;
    }

    if (lists.length === 0) {
      this.showStatus(this.strings.todo.emptyLists);
      return;
    }
    if (lists.length === 1) {
      this.selectTodoList(lists[0].entity_id);
      return;
    }
    if (this.pickerPopup.visible) {
      return;
    }
    this.showPicker(lists);
  }

  private isValidTodoEntity(entityId: string): boolean {
    const entity = this.entityStates[entityId];
    return (
      entity !== undefined &&
      entity.entity_id.split(".")[0] === "todo" &&
      entity.state !== "unavailable"
    );
  }

  private showPicker(lists: readonly TodoList[]): void {
    if (!this.isVisible) {
      return;
    }

    this.showStatus(this.strings.todo.pickList);
    this.blur();
    this.pickerPopup.show({
      id: "todo-picker",
      icon: "󰄬",
      title: this.strings.todo.pickList,
      description: "",
      action: { type: "noop" },
      variants: lists.map((list) => ({
        label: list.name,
        description: list.entity_id,
        action: { type: "view", viewId: "todo", entityId: list.entity_id },
      })),
    });
  }

  private selectTodoList(entityId: string): void {
    const conn = this.conn;
    if (!conn) return;

    this.selectedEntityId = entityId;
    this.updateSelectedListName();
    this.titleParts = [
      this.callbacks.rootTitle ?? this.strings.app.name,
      this.strings.menu.todo.title,
      this.selectedListName || entityId,
    ];
    this.header.update(this.currentInfo, this.titleParts);
    this.callbacks.onTitleChange?.(this.titleParts);
    this.showStatus(this.strings.todo.loadingItems);
    void this.subscribeToSelectedList(conn, entityId);
  }

  private async subscribeToSelectedList(
    conn: Connection,
    entityId: string,
  ): Promise<void> {
    if (this.unsubItems) {
      await this.unsubItems();
      this.unsubItems = null;
    }

    try {
      this.allItems = await fetchItems(conn, entityId);
      if (this.conn !== conn || this.selectedEntityId !== entityId) return;
      this.rebuildAndDisplay({ resetSelection: true });

      this.unsubItems = await subscribeItems(conn, entityId, (update) => {
        if (this.conn !== conn || this.selectedEntityId !== entityId) return;
        this.allItems = update.items;
        this.rebuildAndDisplay();
      });
    } catch (err) {
      log(`Failed to load todo items: ${String(err)}`);
      this.showStatus(this.strings.todo.loadFailed(String(err)));
    }
  }

  private updateSelectedListName(): void {
    const entityId = this.selectedEntityId;
    if (!entityId) return;
    const entity = this.entityStates[entityId];
    this.selectedListName = entity ? computeStateName(entity) : entityId;
  }

  private rebuildAndDisplay(options?: {
    readonly resetSelection?: boolean;
  }): void {
    if (!this.selectedEntityId) return;

    const visibleItems = this.allItems.filter(
      (item) => this.showCompleted || item.status !== TodoItemStatus.Completed,
    );
    const menuItems = visibleItems.map((item) => this.buildMenuItem(item));

    this.filteredItems =
      this.filterText.length === 0
        ? menuItems
        : twoPhaseSearch(
            menuItems,
            this.filterText,
            (item) => item.searchFields,
            FUSE_KEYS,
          );

    if (this.filteredItems.length === 0) {
      this.showStatus(
        this.filterText.length > 0
          ? this.strings.todo.emptyFiltered
          : this.showCompleted
            ? this.strings.todo.emptyAll
            : this.strings.todo.emptyActive,
      );
      return;
    }

    this.hideStatus();
    this.menuList.setFilteredItems(this.filteredItems, options);
    this.updatePageIndicator();
  }

  private buildMenuItem(item: TodoItem): SearchableTodoItem {
    const completed = item.status === TodoItemStatus.Completed;
    const icon = completed ? "󰄬" : "󰄱";
    const title = completed
      ? `${this.strings.todo.completedPrefix} ${item.summary}`
      : item.summary;
    const descriptionParts = [
      item.description?.trim() || this.strings.todo.noDescription,
      item.due ? this.strings.todo.due(item.due) : "",
    ].filter(Boolean);
    const searchFields = [item.summary, item.description ?? "", item.uid];

    return {
      id: item.uid,
      icon,
      title,
      description: descriptionParts.join(" · "),
      action: { type: "noop" },
      keywords: searchFields,
      todo: item,
      searchFields,
    };
  }

  private handleFilterChange(filter: string): void {
    this.filterText = filter;
    this.updateFilterBar(filter);
    this.rebuildAndDisplay();
  }

  private handleBack(): void {
    this.callbacks.onBack();
  }

  private handleTodoKeyPress(key: KeyEvent): boolean {
    if (key.name === "a" && !key.ctrl && !key.meta) {
      this.openAddPrompt();
      return true;
    }

    if (key.name === "e" && !key.ctrl && !key.meta) {
      this.openEditPrompt();
      return true;
    }

    if (key.name === "d" && !key.ctrl && !key.meta) {
      this.requestDeleteSelected();
      return true;
    }

    if (key.name === "m" && !key.ctrl && !key.meta) {
      void this.toggleSelectedDone();
      return true;
    }

    if (key.name === "v" && !key.ctrl && !key.meta) {
      this.toggleCompletedVisibility();
      return true;
    }

    if (key.name === "w" && !key.ctrl && !key.meta) {
      this.openTodoListInBrowser();
      return true;
    }

    return false;
  }

  private openTodoListInBrowser(): void {
    const entityId = this.selectedEntityId;
    if (!entityId || !this.baseUrl) return;

    const url = `${this.baseUrl}/todo?entity_id=${encodeURIComponent(entityId)}`;
    Bun.spawn(["xdg-open", url], { stdout: "ignore", stderr: "ignore" });
    this.toast?.show("todo-web", this.strings.todo.openedWeb, "info");
  }

  private openAddPrompt(): void {
    if (
      !this.selectedEntityId ||
      !this.supports(TodoListEntityFeature.CREATE_TODO_ITEM)
    ) {
      this.toast?.show("todo-action", this.strings.todo.unsupported, "error");
      return;
    }
    this.blur();
    this.editingItem = null;
    this.itemPrompt.show("add");
  }

  private openEditPrompt(): void {
    const item = this.selectedTodoItem();
    if (!item) return;
    if (!this.supports(TodoListEntityFeature.UPDATE_TODO_ITEM)) {
      this.toast?.show("todo-action", this.strings.todo.unsupported, "error");
      return;
    }
    this.blur();
    this.editingItem = item;
    this.itemPrompt.show("edit", {
      summary: item.summary,
      description: item.description ?? "",
    });
  }

  private async submitItemPrompt(values: TodoItemPromptValues): Promise<void> {
    const conn = this.conn;
    const entityId = this.selectedEntityId;
    if (!conn || !entityId) return;

    try {
      const supportsDescription = this.supports(
        TodoListEntityFeature.SET_DESCRIPTION_ON_ITEM,
      );
      if (this.editingItem) {
        await updateItem(conn, entityId, {
          ...this.editingItem,
          summary: values.summary,
          description: supportsDescription
            ? values.description || null
            : undefined,
        });
        this.toast?.show("todo-action", this.strings.todo.updated, "success");
      } else {
        await createItem(conn, entityId, {
          summary: values.summary,
          description: supportsDescription
            ? values.description || undefined
            : undefined,
        });
        this.toast?.show("todo-action", this.strings.todo.created, "success");
      }
    } catch (err) {
      log(`Todo item save failed: ${String(err)}`);
      this.toast?.show(
        "todo-action",
        this.strings.todo.actionFailed(String(err)),
        "error",
      );
    } finally {
      this.editingItem = null;
      queueMicrotask(() => this.focus());
    }
  }

  private requestDeleteSelected(): void {
    const item = this.selectedTodoItem();
    if (!item) return;
    if (!this.supports(TodoListEntityFeature.DELETE_TODO_ITEM)) {
      this.toast?.show("todo-action", this.strings.todo.unsupported, "error");
      return;
    }
    this.pendingDeleteItem = item;
    this.blur();
    this.confirmPrompt.show(
      this.strings.todo.deleteItem,
      this.strings.todo.confirmDelete(item.summary),
    );
  }

  private async confirmDeleteSelected(): Promise<void> {
    const item = this.pendingDeleteItem;
    const conn = this.conn;
    const entityId = this.selectedEntityId;
    if (!item || !conn || !entityId) return;

    this.pendingDeleteItem = null;
    try {
      await deleteItems(conn, entityId, [item.uid]);
      this.toast?.show("todo-action", this.strings.todo.deleted, "success");
    } catch (err) {
      log(`Todo item delete failed: ${String(err)}`);
      this.toast?.show(
        "todo-action",
        this.strings.todo.actionFailed(String(err)),
        "error",
      );
    } finally {
      queueMicrotask(() => this.focus());
    }
  }

  private async toggleSelectedDone(): Promise<void> {
    const item = this.selectedTodoItem();
    const conn = this.conn;
    const entityId = this.selectedEntityId;
    if (!item || !conn || !entityId) return;
    if (!this.supports(TodoListEntityFeature.UPDATE_TODO_ITEM)) {
      this.toast?.show("todo-action", this.strings.todo.unsupported, "error");
      return;
    }

    try {
      await updateItem(conn, entityId, {
        uid: item.uid,
        summary: item.summary,
        status:
          item.status === TodoItemStatus.Completed
            ? TodoItemStatus.NeedsAction
            : TodoItemStatus.Completed,
      });
    } catch (err) {
      log(`Todo item toggle failed: ${String(err)}`);
      this.toast?.show(
        "todo-action",
        this.strings.todo.actionFailed(String(err)),
        "error",
      );
    }
  }

  private toggleCompletedVisibility(): void {
    this.showCompleted = !this.showCompleted;
    this.rebuildAndDisplay({ resetSelection: true });
    this.updateFilterBar(this.filterText);
  }

  private selectedTodoItem(): TodoItem | undefined {
    const selected = this.menuList.getSelectedItem();
    if (!selected) return undefined;
    return this.allItems.find((item) => item.uid === selected.id);
  }

  private supports(feature: TodoListEntityFeature): boolean {
    const entityId = this.selectedEntityId;
    return supportsFeature(
      entityId ? this.entityStates[entityId] : undefined,
      feature,
    );
  }

  private updateFilterBar(filter: string): void {
    const completedMode = this.showCompleted
      ? this.strings.todo.completedVisible
      : this.strings.todo.completedHidden;
    const suffix = this.pageInfoText
      ? `${completedMode}  ${this.pageInfoText}`
      : completedMode;
    if (filter.length === 0) {
      const slashColor = this.menuList.filterActive
        ? this.theme.accent
        : this.theme.fgSubtle;
      this.filterBar.content = t`${fg(slashColor)("/")} ${dim(fg(this.theme.fgMuted)(suffix))}`;
    } else {
      this.filterBar.content = t`${fg(this.theme.accent)("/")} ${fg(this.theme.fg)(filter)} ${dim(fg(this.theme.fgMuted)(suffix))}`;
    }
  }

  private updatePageIndicator(): void {
    const total = this.filteredItems.length;
    const totalPages = this.menuList.totalPages;

    if (totalPages <= 1) {
      this.pageInfoText = "";
      this.updateFilterBar(this.filterText);
      return;
    }

    const page = this.menuList.currentPage + 1;
    this.pageInfoText = `${this.strings.entities.pageOf(page, totalPages)} · ${this.strings.todo.totalCount(total)}`;
    this.updateFilterBar(this.filterText);
  }
}
