import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  InputRenderable,
  type KeyEvent,
  t,
  bold,
  fg,
} from "@opentui/core";
import type { Theme } from "../theme.js";
import { DEFAULT_HA_URL } from "../config.js";
import { formatHelpBar, type HelpEntry } from "./helpBar.js";

const log = (msg: string) =>
  console.error(`[ha-tui:ConnectionForm] ${msg}`);

export interface ConnectionFormValues {
  readonly url: string;
  readonly token: string;
}

export interface ConnectionFormOptions {
  /**
   * Pre-filled values. Falls back to defaults when omitted.
   * Used by Settings > Connection to show the currently saved config.
   */
  readonly initialValues?: Partial<ConnectionFormValues>;
  /** Called with the entered values when the user submits the form. */
  readonly onSubmit: (values: ConnectionFormValues) => void;
  /**
   * Called when the user presses Escape.
   * May be omitted on first-run setup where there is no previous state to cancel to.
   */
  readonly onCancel?: () => void;
}

type FieldName = "url" | "token";

/**
 * Shared connection setup/settings form.
 *
 * Renders URL and token input fields with keyboard navigation:
 *   - Tab / Shift+Tab — move between fields
 *   - Enter           — advance to next field, or submit on last field
 *   - Escape          — cancel (if `onCancel` is provided)
 *
 * Used by both the first-run setup flow and Settings > Connection.
 */
export class ConnectionForm {
  private root: BoxRenderable;
  private urlInput: InputRenderable;
  private tokenInput: InputRenderable;
  private urlLabel: TextRenderable;
  private tokenLabel: TextRenderable;
  private helpBar: TextRenderable;
  private activeField: FieldName = "url";
  private callbacks: ConnectionFormOptions;
  private theme: Theme;

  constructor(
    renderer: CliRenderer,
    theme: Theme,
    options: ConnectionFormOptions,
  ) {
    this.theme = theme;
    this.callbacks = options;

    const initialUrl =
      options.initialValues?.url?.trim() || DEFAULT_HA_URL;
    const initialToken = options.initialValues?.token ?? "";

    // Root container
    this.root = new BoxRenderable(renderer, {
      id: "conn-form-root",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      padding: 1,
    });

    // Title
    const titleText = new TextRenderable(renderer, {
      id: "conn-form-title",
      content: t`${bold(fg(theme.accent)("Connection Setup"))}${fg(theme.fgMuted)(" — enter your Home Assistant URL and access token")}`,
      marginBottom: 2,
    });
    this.root.add(titleText);

    // URL field
    this.urlLabel = new TextRenderable(renderer, {
      id: "conn-form-url-label",
      content: this.fieldLabel("url", "url"),
      marginBottom: 0,
    });
    this.root.add(this.urlLabel);

    this.urlInput = new InputRenderable(renderer, {
      id: "conn-form-url-input",
      value: initialUrl,
      placeholder: DEFAULT_HA_URL,
      backgroundColor: theme.bgInput,
      textColor: theme.fg,
      focusedBackgroundColor: theme.bgSelected,
      focusedTextColor: theme.fg,
      width: "100%",
      marginBottom: 2,
    });
    this.root.add(this.urlInput);

    // Token field
    this.tokenLabel = new TextRenderable(renderer, {
      id: "conn-form-token-label",
      content: this.fieldLabel("token", "token"),
      marginBottom: 0,
    });
    this.root.add(this.tokenLabel);

    this.tokenInput = new InputRenderable(renderer, {
      id: "conn-form-token-input",
      value: initialToken,
      placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      backgroundColor: theme.bgInput,
      textColor: theme.fg,
      focusedBackgroundColor: theme.bgSelected,
      focusedTextColor: theme.fg,
      width: "100%",
      marginBottom: 2,
    });
    this.root.add(this.tokenInput);

    // Help bar
    const helpEntries: HelpEntry[] = [
      { key: "Tab", action: "next field" },
      { key: "Enter", action: "save" },
      ...(options.onCancel ? [{ key: "Esc", action: "cancel" } as HelpEntry] : []),
    ];
    this.helpBar = new TextRenderable(renderer, {
      id: "conn-form-help",
      content: formatHelpBar(theme, helpEntries),
      marginTop: 1,
    });
    this.root.add(this.helpBar);

    renderer.root.add(this.root);
    this.root.visible = false;

    // Set initial focus
    this.urlInput.focus();
    this.tokenInput.blur();
  }

  // ---------------------------------------------------------------------------
  // View lifecycle

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  focus(): void {
    this.setFieldFocus(this.activeField);
  }

  blur(): void {
    this.urlInput.blur();
    this.tokenInput.blur();
  }

  resetAndFocus(): void {
    this.activeField = "url";
    this.urlInput.focus();
    this.tokenInput.blur();
    this.updateLabels();
  }

  /**
   * Update the form fields with new values without changing focus state.
   * Used by Settings > Connection to pre-fill the form with the saved config.
   */
  setValues(values: Partial<ConnectionFormValues>): void {
    if (values.url !== undefined) {
      this.urlInput.value = values.url.trim() || DEFAULT_HA_URL;
    }
    if (values.token !== undefined) {
      this.tokenInput.value = values.token;
    }
  }

  // ---------------------------------------------------------------------------
  // Keyboard handling (called by App when this view is active)

  handleKeyPress(key: KeyEvent): boolean {
    if (key.name === "escape") {
      log("Escape pressed — cancelling");
      this.callbacks.onCancel?.();
      return true;
    }

    if (key.name === "tab") {
      this.cycleField(key.shift ? "backward" : "forward");
      return true;
    }

    if (key.name === "return") {
      this.submit();
      return true;
    }

    // All other keys forwarded to the active input
    const active = this.activeField === "url" ? this.urlInput : this.tokenInput;
    return active.handleKeyPress(key);
  }

  // ---------------------------------------------------------------------------

  private cycleField(direction: "forward" | "backward"): void {
    if (direction === "forward") {
      this.activeField = this.activeField === "url" ? "token" : "url";
    } else {
      this.activeField = this.activeField === "token" ? "url" : "token";
    }
    this.setFieldFocus(this.activeField);
    this.updateLabels();
  }

  private setFieldFocus(field: FieldName): void {
    if (field === "url") {
      this.urlInput.focus();
      this.tokenInput.blur();
    } else {
      this.urlInput.blur();
      this.tokenInput.focus();
    }
  }

  private submit(): void {
    const url = this.urlInput.value.trim() || DEFAULT_HA_URL;
    const token = this.tokenInput.value.trim();

    if (!token) {
      log("Token is empty — not submitting");
      // TODO: show inline validation error
      return;
    }

    log(`Submitting form: url=${url}`);
    this.callbacks.onSubmit({ url, token });
  }

  private updateLabels(): void {
    this.urlLabel.content = this.fieldLabel(
      "url",
      "url",
    );
    this.tokenLabel.content = this.fieldLabel(
      "token",
      "token",
    );
  }

  private fieldLabel(field: FieldName, label: string): ReturnType<typeof t> {
    const isActive = this.activeField === field;
    return isActive
      ? t`${fg(this.theme.accent)(label)}`
      : t`${fg(this.theme.fgMuted)(label)}`;
  }

  destroy(): void {
    this.root.visible = false;
  }
}
