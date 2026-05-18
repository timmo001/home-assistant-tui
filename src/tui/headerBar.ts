import { StyledText, fg, bold } from "@opentui/core";
import type { TextChunk } from "@opentui/core";
import type { Theme } from "../theme.js";
import type { ConnectionInfo, ConnectionStatus } from "../types.js";

const APP_NAME = "Home Assistant TUI";

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
 * Colours:
 *   - connecting  → yellow dot
 *   - connected   → green dot
 *   - disconnected/error → red dot
 */
export function formatHeaderBar(
  theme: Theme,
  info: ConnectionInfo,
): StyledText {
  const chunks: TextChunk[] = [];
  const columns = process.stdout.columns || 80;

  // App name (always shown)
  chunks.push(bold(fg(theme.accent)(APP_NAME)));

  // Status dot + label
  const dotColor = statusColor(theme, info.status);
  const dotChar = STATUS_DOT[info.status];
  const statusLabel = statusLabel_(info);

  chunks.push(fg(theme.fgSubtle)("   "));
  chunks.push(fg(dotColor)(dotChar));
  chunks.push(fg(theme.fgSubtle)(" "));
  chunks.push(fg(dotColor)(statusLabel));

  // Build the right-side metadata string progressively
  const rightParts: TextChunk[] = [];

  if (info.url) {
    rightParts.push(fg(theme.fgSubtle)("   "));
    rightParts.push(fg(theme.fgMuted)(info.url));
  }

  if (info.haVersion) {
    rightParts.push(fg(theme.fgSubtle)("   "));
    rightParts.push(fg(theme.fgMuted)(info.haVersion));
  }

  if (info.userName) {
    rightParts.push(fg(theme.fgSubtle)("   "));
    rightParts.push(fg(theme.fgMuted)(info.userName));
  }

  if (info.lastUpdateAt) {
    const ago = formatAgo(info.lastUpdateAt);
    rightParts.push(fg(theme.fgSubtle)("   "));
    rightParts.push(fg(theme.fgMuted)(`Updated ${ago}`));
  }

  if (info.errorMessage && info.status === "error") {
    rightParts.push(fg(theme.fgSubtle)("   "));
    rightParts.push(fg(dotColor)(info.errorMessage.slice(0, 40)));
  }

  // Calculate approximate plain-text width before adding right parts
  const leftWidth =
    APP_NAME.length + 3 + dotChar.length + 1 + statusLabel.length;

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

function statusLabel_(info: ConnectionInfo): string {
  switch (info.status) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "disconnected":
      return "Disconnected";
    case "error":
      return "Error";
  }
}

function formatAgo(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

/** Extract plain-text content from a TextChunk for width calculations */
function chunkText(chunk: TextChunk): string {
  return chunk.text;
}
