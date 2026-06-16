import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  type KeyEvent,
  t,
  bold,
  dim,
  fg,
} from "@opentui/core";
import type { Theme } from "../theme.js";

const PROMPT_WIDTH = 54;
const PROMPT_HEIGHT = 7;

export interface ConfirmPromptOptions {
  readonly onConfirm: () => void;
  readonly onDismiss: () => void;
}

export class ConfirmPrompt {
  private readonly renderer: CliRenderer;
  private readonly theme: Theme;
  private readonly callbacks: ConfirmPromptOptions;
  private readonly root: BoxRenderable;
  private readonly titleText: TextRenderable;
  private readonly bodyText: TextRenderable;
  private readonly helpText: TextRenderable;

  constructor(
    renderer: CliRenderer,
    theme: Theme,
    options: ConfirmPromptOptions,
  ) {
    this.renderer = renderer;
    this.theme = theme;
    this.callbacks = options;

    this.root = new BoxRenderable(renderer, {
      id: "confirm-prompt-root",
      position: "absolute",
      width: PROMPT_WIDTH,
      height: PROMPT_HEIGHT,
      zIndex: 170,
      visible: false,
      borderStyle: "rounded",
      borderColor: theme.red,
      backgroundColor: theme.bgElevated,
      flexDirection: "column",
      paddingLeft: 1,
      paddingRight: 1,
    });

    this.titleText = new TextRenderable(renderer, {
      id: "confirm-prompt-title",
      content: t``,
      marginBottom: 1,
    });
    this.root.add(this.titleText);

    this.bodyText = new TextRenderable(renderer, {
      id: "confirm-prompt-body",
      content: t``,
      width: "100%",
      truncate: true,
    });
    this.root.add(this.bodyText);

    this.helpText = new TextRenderable(renderer, {
      id: "confirm-prompt-help",
      content: t`${dim("y")} ${dim("confirm")}  ${dim("Esc")} ${dim("cancel")}`,
      marginTop: 1,
    });
    this.root.add(this.helpText);

    renderer.root.add(this.root);
  }

  get visible(): boolean {
    return this.root.visible;
  }

  show(title: string, body: string): void {
    this.titleText.content = t`${bold(fg(this.theme.red)(title))}`;
    this.bodyText.content = t`${fg(this.theme.fg)(body)}`;
    this.positionRoot();
    this.root.visible = true;
  }

  hide(): void {
    this.root.visible = false;
  }

  handleKeyPress(key: KeyEvent): boolean {
    if (key.name === "y" && !key.ctrl && !key.meta) {
      this.hide();
      this.callbacks.onConfirm();
      return true;
    }

    if (key.name === "escape" || key.name === "backspace") {
      this.hide();
      this.callbacks.onDismiss();
      return true;
    }

    return true;
  }

  destroy(): void {
    this.hide();
    this.renderer.root.remove(this.root.id);
  }

  private positionRoot(): void {
    this.root.top = Math.max(
      1,
      Math.floor((this.renderer.height - PROMPT_HEIGHT) / 2),
    );
    this.root.left = Math.max(
      1,
      Math.floor((this.renderer.width - PROMPT_WIDTH) / 2),
    );
  }
}
