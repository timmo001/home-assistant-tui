import { StyledText, fg, bold } from "@opentui/core";
import type { TextChunk } from "@opentui/core";
import type { Theme } from "../theme.js";
import type { ConnectionInfo, ConnectionStatus } from "../types.js";
import type { Locale } from "../i18n/index.js";
import { mdiToNerdFont } from "../data/iconResolver.js";

/** Status indicator characters and their associated colours */
const STATUS_DOT: Record<ConnectionStatus, string> = {
  connecting: "◌",
  connected: "●",
  disconnected: "✗",
  error: "✗",
};

/**
 * Format the header bar as a single-line `StyledText`.
 *
 * Layout (terminal-width aware, fields elided from the right when narrow):
 *   Home Assistant TUI   ● Connected   http://host:8123   2025.5.1   John   Updated 2s ago
 *
 * When `titleParts` is supplied the title renders as a breadcrumb
 * (preceding parts dimmed, final part bold-accented) in place of the app name:
 *   Home Assistant TUI › Settings   ● Connected   …
 *
 * Colours:
 *   - connecting  → yellow dot
 *   - connected   → green dot
 *   - disconnected/error → red dot
 */
export function formatHeaderBar(
  theme: Theme,
  strings: Locale,
  info: ConnectionInfo,
  titleParts?: readonly string[],
): StyledText {
  const chunks: TextChunk[] = [];
  const columns = process.stdout.columns || 80;

  // Title: breadcrumb when titleParts are provided, otherwise the app name
  let titleText: string;
  if (titleParts && titleParts.length > 0) {
    if (titleParts.length === 1) {
      titleText = titleParts[0]!;
      chunks.push(bold(fg(theme.accent)(titleText)));
    } else {
      const prefix = titleParts.slice(0, -1).join(" › ");
      const last = titleParts[titleParts.length - 1]!;
      titleText = `${prefix} › ${last}`;
      chunks.push(fg(theme.fgMuted)(prefix));
      chunks.push(fg(theme.fgSubtle)(" › "));
      chunks.push(bold(fg(theme.accent)(last)));
    }
  } else {
    titleText = strings.app.name;
    chunks.push(bold(fg(theme.accent)(titleText)));
  }

  // Status dot + label
  const dotColor = statusColor(theme, info.status);
  const dotChar = STATUS_DOT[info.status];
  const label = statusLabel(strings, info);

  chunks.push(fg(theme.fgSubtle)("   "));
  chunks.push(fg(dotColor)(dotChar));
  chunks.push(fg(theme.fgSubtle)(" "));
  chunks.push(fg(dotColor)(label));

  // Build the right-side metadata string progressively
  const rightParts: TextChunk[] = [];

  if (info.userName) {
    const accountIcon = mdiToNerdFont("account") ?? "󰀄";
    rightParts.push(fg(theme.fgSubtle)("   "));
    rightParts.push(fg(theme.fgMuted)(`${accountIcon} ${info.userName}`));
  }

  if (info.errorMessage && info.status === "error") {
    rightParts.push(fg(theme.fgSubtle)("   "));
    rightParts.push(fg(dotColor)(info.errorMessage.slice(0, 40)));
  }

  // Calculate approximate plain-text width before adding right parts
  const leftWidth = titleText.length + 3 + dotChar.length + 1 + label.length;

  let usedWidth = leftWidth;
  for (const part of rightParts) {
    const raw = chunkText(part);
    if (usedWidth + raw.length > columns - 1) break;
    chunks.push(part);
    usedWidth += raw.length;
  }

  return new StyledText(chunks);
}

// ---------------------------------------------------------------------------

function statusColor(theme: Theme, status: ConnectionStatus): string {
  switch (status) {
    case "connected":
      return theme.green;
    case "connecting":
      return theme.yellow;
    case "disconnected":
    case "error":
      return theme.red;
  }
}

function statusLabel(strings: Locale, info: ConnectionInfo): string {
  switch (info.status) {
    case "connected":
      return strings.status.connected;
    case "connecting":
      return strings.status.connecting;
    case "disconnected":
      return strings.status.disconnected;
    case "error":
      return strings.status.error;
  }
}

function formatAgo(strings: Locale, date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 5) return strings.status.justNow;
  if (secs < 60) return strings.status.ago.seconds(secs);
  const mins = Math.floor(secs / 60);
  if (mins < 60) return strings.status.ago.minutes(mins);
  return strings.status.ago.hours(Math.floor(mins / 60));
}

/** Extract plain-text content from a TextChunk for width calculations */
function chunkText(chunk: TextChunk): string {
  return chunk.text;
}
