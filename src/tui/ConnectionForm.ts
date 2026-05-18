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
import type { Locale } from "../i18n/index.js";
import { DEFAULT_HA_URL } from "../config.js";
import { formatHelpBar, type HelpEntry } from "./helpBar.js";

const log = (msg: string) => console.error(`[ha-tui:ConnectionForm] ${msg}`);

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
  /**
   * Called with the entered values when the user submits the form.
   * If the returned promise rejects, the form stays open and shows an error.
   */
  readonly onSubmit: (values: ConnectionFormValues) => Promise<void>;
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
  private statusText: TextRenderable;
  private helpBar: TextRenderable;
  private activeField: FieldName = "url";
  private submitting = false;
  private callbacks: ConnectionFormOptions;
  private theme: Theme;
  private strings: Locale;

  constructor(
    renderer: CliRenderer,
    theme: Theme,
    strings: Locale,
    options: ConnectionFormOptions,
  ) {
    this.theme = theme;
    this.strings = strings;
    this.callbacks = options;

    const initialUrl = options.initialValues?.url?.trim() || DEFAULT_HA_URL;
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
      content: t`${bold(fg(theme.accent)(strings.connectionForm.title))}${fg(theme.fgMuted)(strings.connectionForm.subtitle)}`,
      marginBottom: 2,
    });
    this.root.add(titleText);

    // URL field
    this.urlLabel = new TextRenderable(renderer, {
      id: "conn-form-url-label",
      content: this.fieldLabel("url"),
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
      content: this.fieldLabel("token"),
      marginBottom: 0,
    });
    this.root.add(this.tokenLabel);

    this.tokenInput = new InputRenderable(renderer, {
      id: "conn-form-token-input",
      value: initialToken,
      placeholder: strings.connectionForm.tokenPlaceholder,
      backgroundColor: theme.bgInput,
      textColor: theme.fg,
      focusedBackgroundColor: theme.bgSelected,
      focusedTextColor: theme.fg,
      width: "100%",
      marginBottom: 2,
    });
    this.root.add(this.tokenInput);

    // Status line (connecting / error feedback)
    this.statusText = new TextRenderable(renderer, {
      id: "conn-form-status",
      content: t``,
      marginBottom: 0,
    });
    this.root.add(this.statusText);

    // Help bar
    const helpEntries: HelpEntry[] = [
      { key: strings.keys.tab, action: strings.connectionForm.help.nextField },
      { key: strings.keys.enter, action: strings.connectionForm.help.save },
      ...(options.onCancel
        ? [
            {
              key: strings.keys.esc,
              action: strings.connectionForm.help.cancel,
            } as HelpEntry,
          ]
        : []),
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

  /** Pre-fill the form with the given values without resetting focus. */
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
    // Block input while a save is in progress
    if (this.submitting) return true;

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
      if (this.activeField === "url") {
        // Advance to token field
        this.cycleField("forward");
      } else {
        // Submit from the token field
        this.submit();
      }
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

    if (this.submitting) return;
    this.submitting = true;

    log(`Submitting form: url=${url}`);
    this.statusText.content = t`${fg(this.theme.fgMuted)(this.strings.connectionForm.connecting)}`;

    this.callbacks.onSubmit({ url, token }).then(
      () => {
        this.submitting = false;
        this.statusText.content = t``;
      },
      () => {
        this.submitting = false;
        this.statusText.content = t`${fg(this.theme.red)(this.strings.connectionForm.saveFailed)}`;
      },
    );
  }

  private updateLabels(): void {
    this.urlLabel.content = this.fieldLabel("url");
    this.tokenLabel.content = this.fieldLabel("token");
  }

  private fieldLabel(field: FieldName): ReturnType<typeof t> {
    const isActive = this.activeField === field;
    const label =
      field === "url"
        ? this.strings.connectionForm.urlLabel
        : this.strings.connectionForm.tokenLabel;
    return isActive
      ? t`${fg(this.theme.accent)(label)}`
      : t`${fg(this.theme.fgMuted)(label)}`;
  }

  destroy(): void {
    this.root.visible = false;
  }
}
