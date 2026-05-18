import { type StyledText, t, fg } from "@opentui/core";
import type { Theme } from "../theme.js";

/**
 * Format the filter bar content based on current filter text.
 *
 * Shows a muted "/" when empty, or an accented "/" followed by the typed
 * filter text when active.
 */
export function formatFilterBar(theme: Theme, filter: string): StyledText {
  if (filter.length === 0) {
    return t`${fg(theme.fgSubtle)("/")}`;
  }
  return t`${fg(theme.accent)("/")} ${fg(theme.fg)(filter)}`;
}
