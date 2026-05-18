import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  InputRenderable,
  type KeyEvent,
  t,
  bold,
  dim,
  fg,
} from "@opentui/core";
import type { Theme } from "../theme.js";
import type { Locale } from "../i18n/index.js";
import type { ServiceFieldEntry } from "../data/services.js";

/** Width of the form popup in characters */
const POPUP_WIDTH = 60;

/** Supported selector types that can be rendered as TUI inputs */
const SUPPORTED_SELECTORS = new Set([
  "boolean",
  "text",
  "number",
  "select",
  "duration",
  "color_temp",
  "time",
  "date",
  "datetime",
]);

/** Configuration for the {@link ServiceFormPopup} component */
export interface ServiceFormPopupOptions {
  /** Called when the user submits the form */
  readonly onSubmit: (data: Record<string, unknown>) => void;
  /** Called when the popup is dismissed without submission */
  readonly onDismiss: () => void;
}

/** Internal form field state */
interface FormField {
  readonly fieldId: string;
  readonly label: string;
  readonly selector: string;
  readonly selectorConfig: Record<string, unknown>;
  readonly supported: boolean;
  readonly input: InputRenderable | null;
  readonly textDisplay: TextRenderable | null;
  /** For boolean/select: currently selected option index */
  selectedOption: number;
  /** For boolean/select: available options */
  readonly options: string[];
}

/**
 * Popup overlay with form fields for service parameters.
 *
 * Only shows required fields. Supported selectors are rendered as InputRenderables;
 * unsupported ones are displayed as dim informational text.
 */
export class ServiceFormPopup {
  private renderer: CliRenderer;
  private theme: Theme;
  private strings: Locale;
  private root: BoxRenderable;
  private titleText: TextRenderable;
  private fieldsContainer: BoxRenderable;
  private helpText: TextRenderable;
  private callbacks: ServiceFormPopupOptions;

  private fields: FormField[] = [];
  private focusedFieldIndex = 0;

  constructor(
    renderer: CliRenderer,
    theme: Theme,
    strings: Locale,
    options: ServiceFormPopupOptions,
  ) {
    this.renderer = renderer;
    this.theme = theme;
    this.strings = strings;
    this.callbacks = options;

    this.root = new BoxRenderable(renderer, {
      id: "service-form-root",
      position: "absolute",
      width: POPUP_WIDTH,
      zIndex: 160,
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
      id: "service-form-title",
      content: t``,
      marginBottom: 1,
    });
    this.root.add(this.titleText);

    this.fieldsContainer = new BoxRenderable(renderer, {
      id: "service-form-fields",
      flexDirection: "column",
      width: "100%",
    });
    this.root.add(this.fieldsContainer);

    this.helpText = new TextRenderable(renderer, {
      id: "service-form-help",
      content: t``,
      marginTop: 1,
    });
    this.root.add(this.helpText);

    renderer.root.add(this.root);
  }

  /** Whether the popup is currently visible */
  get visible(): boolean {
    return this.root.visible;
  }

  /**
   * Show the form popup for a service's required fields.
   */
  show(serviceName: string, requiredFields: ServiceFieldEntry[]): void {
    // Clear previous fields
    this.clearFields();

    this.titleText.content = t`${bold(fg(this.theme.accent)(serviceName))}`;

    // Build form fields
    for (let i = 0; i < requiredFields.length; i++) {
      const field = requiredFields[i];
      const formField = this.createFormField(field, i);
      this.fields.push(formField);
    }

    // Update help text
    this.helpText.content = t`${dim(this.strings.keys.tab)} ${dim("next field")}  ${dim(this.strings.keys.enter)} ${dim(this.strings.entityActions.submit)}  ${dim(this.strings.keys.esc)} ${dim(this.strings.entityActions.cancel)}`;

    // Calculate height
    const fieldLines = this.fields.length * 3; // label + input + spacing
    const chromeLines = 7; // border(2) + title(1) + titleMargin(1) + helpMargin(1) + help(1) + padding
    const totalHeight = Math.min(
      fieldLines + chromeLines,
      this.renderer.height - 4,
    );

    const termHeight = this.renderer.height;
    const termWidth = this.renderer.width;
    const top = Math.max(1, Math.floor((termHeight - totalHeight) / 2));
    const left = Math.max(1, Math.floor((termWidth - POPUP_WIDTH) / 2));

    this.root.top = top;
    this.root.left = left;
    this.root.height = totalHeight;
    this.root.visible = true;

    // Focus first supported field
    this.focusedFieldIndex = 0;
    this.focusCurrentField();
  }

  /** Hide the popup and release focus */
  hide(): void {
    this.root.visible = false;
    this.blurCurrentField();
    this.clearFields();
  }

  /** Handle keyboard input when the popup has focus */
  handleKeyPress(key: KeyEvent): boolean {
    if (key.name === "escape") {
      this.hide();
      this.callbacks.onDismiss();
      return true;
    }

    if (key.name === "tab" || (key.name === "return" && !key.shift)) {
      // Move to next field, or submit if on last field
      const nextIdx = this.nextSupportedFieldIndex(this.focusedFieldIndex + 1);
      if (nextIdx === -1 || key.name === "return") {
        // Submit the form
        this.submit();
        return true;
      }
      this.blurCurrentField();
      this.focusedFieldIndex = nextIdx;
      this.focusCurrentField();
      return true;
    }

    if (key.name === "tab" && key.shift) {
      // Move to previous field
      const prevIdx = this.prevSupportedFieldIndex(this.focusedFieldIndex - 1);
      if (prevIdx !== -1) {
        this.blurCurrentField();
        this.focusedFieldIndex = prevIdx;
        this.focusCurrentField();
      }
      return true;
    }

    // For boolean/select fields: left/right to cycle options
    const currentField = this.fields[this.focusedFieldIndex];
    if (currentField?.supported && currentField.options.length > 0) {
      if (key.name === "left" || key.name === "right") {
        const delta = key.name === "right" ? 1 : -1;
        const len = currentField.options.length;
        currentField.selectedOption =
          (currentField.selectedOption + delta + len) % len;
        this.updateSelectDisplay(currentField);
        return true;
      }
    }

    // Let the focused input handle the key
    return false;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private submit(): void {
    const data: Record<string, unknown> = {};

    for (const field of this.fields) {
      if (!field.supported) continue;

      if (field.options.length > 0) {
        // Boolean or select
        const value = field.options[field.selectedOption];
        if (field.selector === "boolean") {
          data[field.fieldId] = value === "true";
        } else {
          data[field.fieldId] = value;
        }
      } else if (field.input) {
        const raw = field.input.value.trim();
        if (raw.length === 0) continue;

        if (field.selector === "number") {
          data[field.fieldId] = Number(raw);
        } else if (field.selector === "duration") {
          data[field.fieldId] = parseDuration(raw);
        } else {
          data[field.fieldId] = raw;
        }
      }
    }

    this.hide();
    this.callbacks.onSubmit(data);
  }

  private createFormField(field: ServiceFieldEntry, index: number): FormField {
    const selectorType = field.selector
      ? (Object.keys(field.selector)[0] ?? "unknown")
      : "unknown";
    const selectorConfig = field.selector
      ? ((Object.values(field.selector)[0] as Record<string, unknown>) ?? {})
      : {};
    const supported = SUPPORTED_SELECTORS.has(selectorType);
    const label = field.name ?? field.fieldId;
    const fieldContainerId = `service-form-field-${index}`;

    // Label
    const labelText = new TextRenderable(this.renderer, {
      id: `${fieldContainerId}-label`,
      content: supported
        ? t`${fg(this.theme.fg)(label)}`
        : t`${dim(fg(this.theme.fgMuted)(`⚠ ${label} (${selectorType}) — ${this.strings.entityActions.unsupportedSelector}`))}`,
      marginTop: index > 0 ? 1 : 0,
    });
    this.fieldsContainer.add(labelText);

    if (!supported) {
      return {
        fieldId: field.fieldId,
        label,
        selector: selectorType,
        selectorConfig,
        supported: false,
        input: null,
        textDisplay: labelText,
        selectedOption: 0,
        options: [],
      };
    }

    // Create the appropriate input
    let input: InputRenderable | null = null;
    let textDisplay: TextRenderable | null = null;
    let options: string[] = [];
    let selectedOption = 0;

    if (selectorType === "boolean") {
      options = ["true", "false"];
      textDisplay = new TextRenderable(this.renderer, {
        id: `${fieldContainerId}-value`,
        content: t`${fg(this.theme.accent)("◀")} ${fg(this.theme.fg)("true")} ${fg(this.theme.accent)("▶")}`,
      });
      this.fieldsContainer.add(textDisplay);
    } else if (selectorType === "select") {
      options = (selectorConfig.options as string[]) ?? [];
      selectedOption = 0;
      const display = options[0] ?? "";
      textDisplay = new TextRenderable(this.renderer, {
        id: `${fieldContainerId}-value`,
        content: t`${fg(this.theme.accent)("◀")} ${fg(this.theme.fg)(display)} ${fg(this.theme.accent)("▶")}`,
      });
      this.fieldsContainer.add(textDisplay);
    } else {
      // Text-based input
      const placeholder = this.getPlaceholder(
        selectorType,
        selectorConfig,
        field,
      );
      input = new InputRenderable(this.renderer, {
        id: `${fieldContainerId}-input`,
        width: POPUP_WIDTH - 6,
        placeholder,
        backgroundColor: this.theme.bgInput,
        textColor: this.theme.fg,
        placeholderColor: this.theme.fgMuted,
        cursorColor: this.theme.accent,
      });
      this.fieldsContainer.add(input);
    }

    return {
      fieldId: field.fieldId,
      label,
      selector: selectorType,
      selectorConfig,
      supported: true,
      input,
      textDisplay,
      selectedOption,
      options,
    };
  }

  private getPlaceholder(
    selectorType: string,
    config: Record<string, unknown>,
    field: ServiceFieldEntry,
  ): string {
    switch (selectorType) {
      case "number": {
        const min = config.min as number | undefined;
        const max = config.max as number | undefined;
        const step = config.step as number | undefined;
        const parts: string[] = [];
        if (min != null) parts.push(`min: ${min}`);
        if (max != null) parts.push(`max: ${max}`);
        if (step != null) parts.push(`step: ${step}`);
        return parts.length > 0
          ? parts.join(", ")
          : String(field.example ?? "");
      }
      case "duration":
        return "HH:MM:SS";
      case "color_temp": {
        const min = config.min_mireds as number | undefined;
        const max = config.max_mireds as number | undefined;
        if (min != null && max != null) return `${min}–${max} mireds`;
        return String(field.example ?? "mireds");
      }
      case "time":
        return "HH:MM";
      case "date":
        return "YYYY-MM-DD";
      case "datetime":
        return "YYYY-MM-DD HH:MM";
      default:
        return String(field.example ?? "");
    }
  }

  private updateSelectDisplay(field: FormField): void {
    if (!field.textDisplay) return;
    const value = field.options[field.selectedOption] ?? "";
    field.textDisplay.content = t`${fg(this.theme.accent)("◀")} ${fg(this.theme.fg)(value)} ${fg(this.theme.accent)("▶")}`;
  }

  private focusCurrentField(): void {
    const field = this.fields[this.focusedFieldIndex];
    if (field?.input) {
      field.input.focus();
    }
  }

  private blurCurrentField(): void {
    const field = this.fields[this.focusedFieldIndex];
    if (field?.input) {
      field.input.blur();
    }
  }

  private nextSupportedFieldIndex(from: number): number {
    for (let i = from; i < this.fields.length; i++) {
      if (this.fields[i].supported) return i;
    }
    return -1;
  }

  private prevSupportedFieldIndex(from: number): number {
    for (let i = from; i >= 0; i--) {
      if (this.fields[i].supported) return i;
    }
    return -1;
  }

  private clearFields(): void {
    this.fields = [];
    this.focusedFieldIndex = 0;
    // Remove all children from the fields container
    for (const child of this.fieldsContainer.getChildren()) {
      this.fieldsContainer.remove(child.id);
    }
  }

  /** Remove the popup from the render tree */
  destroy(): void {
    this.hide();
    this.renderer.root.remove(this.root.id);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a duration string like "HH:MM:SS" or "MM:SS" or just seconds */
function parseDuration(raw: string): Record<string, number> {
  const parts = raw.split(":").map(Number);
  if (parts.length === 3) {
    return { hours: parts[0], minutes: parts[1], seconds: parts[2] };
  }
  if (parts.length === 2) {
    return { hours: 0, minutes: parts[0], seconds: parts[1] };
  }
  return { hours: 0, minutes: 0, seconds: parts[0] ?? 0 };
}
