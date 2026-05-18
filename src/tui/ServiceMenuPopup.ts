import {
  type CliRenderer,
  BoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  type KeyEvent,
  t,
  bold,
  dim,
  fg,
} from "@opentui/core";
import type { Theme } from "../theme.js";
import type { Locale } from "../i18n/index.js";
import type { ServiceInfo } from "../data/services.js";

/** Width of the popup box in characters */
const POPUP_WIDTH = 56;

/** Configuration for the {@link ServiceMenuPopup} component */
export interface ServiceMenuPopupOptions {
  /** Called when the user selects a service */
  readonly onSelect: (service: ServiceInfo) => void;
  /** Called when the popup is dismissed without selection */
  readonly onDismiss: () => void;
}

/**
 * Popup overlay listing available services for an entity's domain.
 *
 * Uses the same absolute-positioning + SelectRenderable pattern as VariantPopup.
 * Toggle is shown first for toggleable domains.
 */
export class ServiceMenuPopup {
  private renderer: CliRenderer;
  private theme: Theme;
  private root: BoxRenderable;
  private titleText: TextRenderable;
  private select: SelectRenderable;
  private separator: TextRenderable;
  private helpText: TextRenderable;
  private callbacks: ServiceMenuPopupOptions;

  private services: ServiceInfo[] = [];

  constructor(
    renderer: CliRenderer,
    theme: Theme,
    strings: Locale,
    options: ServiceMenuPopupOptions,
  ) {
    this.renderer = renderer;
    this.theme = theme;
    this.callbacks = options;

    this.root = new BoxRenderable(renderer, {
      id: "service-menu-root",
      position: "absolute",
      width: POPUP_WIDTH,
      zIndex: 150,
      visible: false,
      borderStyle: "rounded",
      borderColor: theme.accent,
      backgroundColor: theme.bgElevated,
      flexDirection: "column",
      paddingLeft: 1,
      paddingRight: 1,
      paddingTop: 0,
      paddingBottom: 0,
    });

    this.titleText = new TextRenderable(renderer, {
      id: "service-menu-title",
      content: t``,
      marginBottom: 1,
    });
    this.root.add(this.titleText);

    this.select = new SelectRenderable(renderer, {
      id: "service-menu-select",
      options: [],
      selectedIndex: 0,
      wrapSelection: true,
      showDescription: true,
      showScrollIndicator: true,
      backgroundColor: theme.bgElevated,
      textColor: theme.fg,
      descriptionColor: theme.fgMuted,
      selectedBackgroundColor: theme.accent,
      selectedTextColor: theme.accentFg,
      selectedDescriptionColor: theme.fg,
      focusedBackgroundColor: theme.bgElevated,
      focusedTextColor: theme.fg,
      width: "100%",
      flexGrow: 1,
    });
    this.root.add(this.select);

    this.select.on(SelectRenderableEvents.ITEM_SELECTED, () => {
      const idx = this.select.getSelectedIndex();
      const service = this.services[idx];
      if (service) {
        this.hide();
        this.callbacks.onSelect(service);
      }
    });

    this.separator = new TextRenderable(renderer, {
      id: "service-menu-sep",
      content: t`${fg(theme.fgSubtle)("─".repeat(POPUP_WIDTH - 4))}`,
      marginTop: 1,
    });
    this.root.add(this.separator);

    this.helpText = new TextRenderable(renderer, {
      id: "service-menu-help",
      content: t`${dim(strings.keys.arrowsUD)} ${dim(strings.help.navigate)}  ${dim(strings.keys.enter)} ${dim(strings.help.select)}  ${dim(strings.keys.esc)} ${dim(strings.help.cancel)}`,
    });
    this.root.add(this.helpText);

    renderer.root.add(this.root);
  }

  /** Whether the popup is currently visible */
  get visible(): boolean {
    return this.root.visible;
  }

  /**
   * Show the popup with a list of services for a given entity.
   */
  show(entityName: string, services: ServiceInfo[]): void {
    if (services.length === 0) return;

    this.services = services;

    this.titleText.content = t`${bold(fg(this.theme.accent)(entityName))}`;

    this.select.options = services.map((s) => ({
      name: s.name,
      description: s.description,
    }));
    this.select.selectedIndex = 0;

    // Calculate popup height: each item = 2 lines + chrome
    const maxVisibleItems = Math.min(services.length, 10);
    const itemLines = maxVisibleItems * 2;
    const chromeLines = 7; // border(2) + title(1) + titleMargin(1) + sep margin(1) + sep(1) + help(1)
    const totalHeight = itemLines + chromeLines;

    const termHeight = this.renderer.height;
    const termWidth = this.renderer.width;
    const top = Math.max(1, Math.floor((termHeight - totalHeight) / 2));
    const left = Math.max(1, Math.floor((termWidth - POPUP_WIDTH) / 2));

    this.root.top = top;
    this.root.left = left;
    this.root.height = totalHeight;
    this.root.visible = true;
    this.select.focus();
  }

  /** Hide the popup and release focus */
  hide(): void {
    this.root.visible = false;
    this.select.blur();
  }

  /** Handle keyboard input when the popup has focus */
  handleKeyPress(key: KeyEvent): boolean {
    switch (key.name) {
      case "escape":
      case "backspace":
        this.hide();
        this.callbacks.onDismiss();
        return true;
      default:
        return false;
    }
  }

  /** Remove the popup from the render tree */
  destroy(): void {
    this.hide();
    this.renderer.root.remove(this.root.id);
  }
}
