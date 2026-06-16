import {
  type CliRenderer,
  BoxRenderable,
  InputRenderable,
  TextRenderable,
  type KeyEvent,
  t,
  bold,
  dim,
  fg,
} from "@opentui/core";
import type { Theme } from "../theme.js";
import type { Locale } from "../i18n/index.js";

const PROMPT_WIDTH = 60;

export interface TodoItemPromptValues {
  readonly summary: string;
  readonly description: string;
}

export interface TodoItemPromptOptions {
  readonly onSubmit: (values: TodoItemPromptValues) => void;
  readonly onDismiss: () => void;
}

type PromptMode = "add" | "edit";
type PromptField = "summary" | "description";

export class TodoItemPrompt {
  private readonly renderer: CliRenderer;
  private readonly theme: Theme;
  private readonly strings: Locale;
  private readonly callbacks: TodoItemPromptOptions;
  private readonly root: BoxRenderable;
  private readonly titleText: TextRenderable;
  private readonly summaryLabel: TextRenderable;
  private readonly summaryInput: InputRenderable;
  private readonly descriptionLabel: TextRenderable;
  private readonly descriptionInput: InputRenderable;
  private readonly statusText: TextRenderable;
  private readonly helpText: TextRenderable;
  private activeField: PromptField = "summary";

  constructor(
    renderer: CliRenderer,
    theme: Theme,
    strings: Locale,
    options: TodoItemPromptOptions,
  ) {
    this.renderer = renderer;
    this.theme = theme;
    this.strings = strings;
    this.callbacks = options;

    this.root = new BoxRenderable(renderer, {
      id: "todo-item-prompt-root",
      position: "absolute",
      width: PROMPT_WIDTH,
      zIndex: 170,
      visible: false,
      borderStyle: "rounded",
      borderColor: theme.accent,
      backgroundColor: theme.bgElevated,
      flexDirection: "column",
      paddingLeft: 1,
      paddingRight: 1,
    });

    this.titleText = new TextRenderable(renderer, {
      id: "todo-item-prompt-title",
      content: t``,
      marginBottom: 1,
    });
    this.root.add(this.titleText);

    this.summaryLabel = new TextRenderable(renderer, {
      id: "todo-item-prompt-summary-label",
      content: t``,
    });
    this.root.add(this.summaryLabel);

    this.summaryInput = new InputRenderable(renderer, {
      id: "todo-item-prompt-summary-input",
      width: "100%",
      placeholder: strings.todo.taskNameLabel,
      backgroundColor: theme.bgInput,
      focusedBackgroundColor: theme.bgSelected,
      textColor: theme.fg,
      focusedTextColor: theme.fg,
      cursorColor: theme.accent,
      marginBottom: 1,
    });
    this.root.add(this.summaryInput);

    this.descriptionLabel = new TextRenderable(renderer, {
      id: "todo-item-prompt-description-label",
      content: t``,
    });
    this.root.add(this.descriptionLabel);

    this.descriptionInput = new InputRenderable(renderer, {
      id: "todo-item-prompt-description-input",
      width: "100%",
      placeholder: strings.todo.descriptionPlaceholder,
      backgroundColor: theme.bgInput,
      focusedBackgroundColor: theme.bgSelected,
      textColor: theme.fg,
      focusedTextColor: theme.fg,
      cursorColor: theme.accent,
      marginBottom: 1,
    });
    this.root.add(this.descriptionInput);

    this.statusText = new TextRenderable(renderer, {
      id: "todo-item-prompt-status",
      content: t``,
      marginBottom: 1,
    });
    this.root.add(this.statusText);

    this.helpText = new TextRenderable(renderer, {
      id: "todo-item-prompt-help",
      content: t`${dim(strings.keys.tab)} ${dim(strings.connectionForm.help.nextField)}  ${dim(strings.keys.enter)} ${dim(strings.entityActions.submit)}  ${dim(strings.keys.esc)} ${dim(strings.entityActions.cancel)}`,
    });
    this.root.add(this.helpText);

    renderer.root.add(this.root);
  }

  get visible(): boolean {
    return this.root.visible;
  }

  show(
    mode: PromptMode,
    initialValues: Partial<TodoItemPromptValues> = {},
  ): void {
    this.summaryInput.value = initialValues.summary ?? "";
    this.descriptionInput.value = initialValues.description ?? "";
    this.statusText.content = t``;
    this.titleText.content = t`${bold(fg(this.theme.accent)(mode === "add" ? this.strings.todo.addItem : this.strings.todo.editItem))}`;
    this.activeField = "summary";
    this.updateLabels();
    this.positionRoot();
    this.root.visible = true;
    this.setFieldFocus("summary");
  }

  hide(): void {
    this.root.visible = false;
    this.summaryInput.blur();
    this.descriptionInput.blur();
  }

  handleKeyPress(key: KeyEvent): boolean {
    if (key.name === "escape") {
      this.hide();
      this.callbacks.onDismiss();
      return true;
    }

    if (key.name === "tab") {
      this.activeField =
        this.activeField === "summary" ? "description" : "summary";
      this.setFieldFocus(this.activeField);
      this.updateLabels();
      return true;
    }

    if (key.name === "return") {
      if (this.activeField === "summary") {
        this.activeField = "description";
        this.setFieldFocus("description");
        this.updateLabels();
      } else {
        this.submit();
      }
      return true;
    }

    return false;
  }

  destroy(): void {
    this.hide();
    this.renderer.root.remove(this.root.id);
  }

  private submit(): void {
    const summary = this.summaryInput.value.trim();
    if (!summary) {
      this.statusText.content = t`${fg(this.theme.red)(this.strings.todo.requiredFields)}`;
      this.activeField = "summary";
      this.setFieldFocus("summary");
      this.updateLabels();
      return;
    }

    const description = this.descriptionInput.value.trim();
    this.hide();
    this.callbacks.onSubmit({ summary, description });
  }

  private updateLabels(): void {
    this.summaryLabel.content = this.fieldLabel(
      "summary",
      this.strings.todo.taskNameLabel,
    );
    this.descriptionLabel.content = this.fieldLabel(
      "description",
      this.strings.todo.descriptionLabel,
    );
  }

  private fieldLabel(field: PromptField, label: string): ReturnType<typeof t> {
    return this.activeField === field
      ? t`${fg(this.theme.accent)(label)}`
      : t`${fg(this.theme.fgMuted)(label)}`;
  }

  private setFieldFocus(field: PromptField): void {
    if (field === "summary") {
      this.summaryInput.focus();
      this.descriptionInput.blur();
    } else {
      this.summaryInput.blur();
      this.descriptionInput.focus();
    }
  }

  private positionRoot(): void {
    const height = 12;
    this.root.top = Math.max(
      1,
      Math.floor((this.renderer.height - height) / 2),
    );
    this.root.left = Math.max(
      1,
      Math.floor((this.renderer.width - PROMPT_WIDTH) / 2),
    );
    this.root.height = height;
  }
}
