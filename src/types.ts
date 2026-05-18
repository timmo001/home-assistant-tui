// --- Connection types ---

/** Live state of the Home Assistant WebSocket connection */
export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

/**
 * Snapshot of connection state shown in the header bar.
 * Fields beyond `status` and `url` are populated after a successful connect.
 */
export interface ConnectionInfo {
  readonly status: ConnectionStatus;
  readonly url: string;
  readonly haVersion?: string;
  readonly userName?: string;
  readonly lastUpdateAt?: Date;
  readonly errorMessage?: string;
}

// --- Menu types ---

/** Identifies a top-level TUI view for navigation */
export type ViewId = "main" | "submenu" | "setup" | "dashboard";

/** Action that suspends the TUI and runs a command with inherited stdio */
export interface CommandAction {
  readonly type: "command";
  readonly cmd: string;
  /** When true, show "Press any key to continue" before resuming the TUI */
  readonly wait: boolean;
}

/** Action that runs a command in the background without suspending */
export interface SilentAction {
  readonly type: "silent";
  readonly cmd: string;
}

/** Toast notification config for notify actions */
export interface NotifyConfig {
  /** Stable ID for grouping — a new notification with the same ID replaces the previous one */
  readonly id: string;
  /** Message shown while the command is running (e.g. "Refreshing...") */
  readonly progress: string;
  /** Message shown on success (e.g. "Done") */
  readonly success: string;
}

/** Action that runs a command silently and shows toast notifications for progress/result */
export interface NotifyAction {
  readonly type: "notify";
  readonly cmd: string;
  readonly notify: NotifyConfig;
}

/** Toast variant controlling display colour */
export type ToastVariant = "info" | "success" | "error";

/** Action that navigates to a sub-view within the TUI */
export interface ViewAction {
  readonly type: "view";
  readonly viewId: ViewId;
}

/** Action that opens a nested submenu */
export interface SubmenuAction {
  readonly type: "submenu";
  readonly menuId: string;
}

/** Action that does nothing — for placeholder menu items */
export interface NoopAction {
  readonly type: "noop";
}

/** Action that exits the TUI */
export interface QuitAction {
  readonly type: "quit";
}

/** Discriminated union of all possible menu item actions */
export type MenuAction =
  | CommandAction
  | SilentAction
  | NotifyAction
  | ViewAction
  | SubmenuAction
  | NoopAction
  | QuitAction;

/** A selectable variant for a menu item offering an alternative action */
export interface MenuVariant {
  /** Short display label (e.g. "Quick", "Full") */
  readonly label: string;
  /** Optional description shown below the label in the popup */
  readonly description?: string;
  /** The action to execute when this variant is selected */
  readonly action: MenuAction;
}

/** A single entry in the TUI menu system */
export interface MenuItem {
  /** Stable dot-separated identifier (e.g. "greet", "settings.display.colors") */
  readonly id: string;
  /** Primary display text */
  readonly title: string;
  /** Secondary text shown below the title */
  readonly description: string;
  /** Nerd Font icon character */
  readonly icon: string;
  /** What happens when this item is selected */
  readonly action: MenuAction;
  /** Optional alternative actions shown in a popup selector when present */
  readonly variants?: readonly MenuVariant[];
  /** Optional search aliases for fuzzy filter matching */
  readonly keywords?: readonly string[];
}
