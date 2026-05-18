# AGENTS.md

Project instructions for AI coding agents working in this repository.

## Project overview

`home-assistant-tui` is a Bun + TypeScript terminal UI for Home Assistant, built on `@opentui/core` and `effect`. It provides a main menu with fuzzy search, nested submenus with breadcrumb navigation, a live connection-state header bar, first-run setup, and a shared connection form used by both initial setup and Settings > Connection.

## Home Assistant source of truth

`../frontend` is the authoritative source of truth for all HA types, helpers, and patterns. Always consult it before writing anything from scratch.

- **Lookup order**: When a type, helper, or pattern is needed:
  1. Check what is already defined in this repo — prefer reusing or extending existing local types and helpers.
  2. Check `home-assistant-js-websocket` exports — it covers core types (`HassEntity`, `HassConfig`, `HassUser`, `HassEntities`, `StateChangedEvent`, `Connection`, `Auth`, etc.) and is already a dependency.
  3. If not in that package, find the canonical implementation in `../frontend` — primary locations are `../frontend/src/data/` (domain data helpers) and `../frontend/src/common/entity/` (entity helpers like `computeStateName`, `stateActive`, `computeDomain`). Copy the relevant code into this repo rather than writing an independent implementation. Keep copied code minimal — only bring in what is actually needed.
  4. Only author a local type or helper from scratch when it is genuinely absent from all three sources.
- **Key API**: Use `createLongLivedTokenAuth(url, token)` + `createConnection({ auth, createSocket })` for authentication. Never roll a hand-written WebSocket auth flow.
- **Config types**: `HassConfig.version` is the HA version string. `HassUser.name` is the authenticated user's display name.

## Tech stack

- **Runtime**: Bun (not Node)
- **Language**: TypeScript (strict, ESNext, bundler module resolution)
- **TUI framework**: `@opentui/core` — provides `CliRenderer`, `BoxRenderable`, `TextRenderable`, `SelectRenderable`, `ScrollBoxRenderable`, `InputRenderable`, and styled text via `t`, `fg`, `bold`, `dim` template tags
- **Effect**: `effect` v4 beta — used for the program entry point (`Effect.gen`, `Effect.runPromise`).
- **Fuzzy search**: `fuse.js` — weighted fuzzy matching in `MenuList`
- **HA client**: `home-assistant-js-websocket` — official WebSocket client
- **Config**: `yaml` — YAML parse/stringify for `~/.local/share/home-assistant-tui/config.yml`

## Architecture

### Entry point

`src/index.ts` — parses CLI flags, checks config, creates the renderer, wires the HA service and app, starts the appropriate initial view (setup or main).

### Config

`src/config.ts` — `loadConfig()`, `saveConfig(config)`, `isConfigured()`. Config path: `~/.local/share/home-assistant-tui/config.yml`. Default HA URL: `http://homeassistant.local:8123`.

### HA service

`src/services/HomeAssistant.ts` — plain class (not an Effect service). Manages the WebSocket connection lifecycle, emits `ConnectionInfo` updates to subscribers via a `subscribe(cb)` / unsubscribe pattern. Calls `getConfig` and `getUser` after connect to populate header metadata.

### Menu system

- `src/menu.ts` — static menu item definitions using helper functions (`item()`, `noop()`, `submenu()`). Items registered in `mainMenuItems`, `submenus`, `submenuTitles`, `menuItemsById`.
- `src/types.ts` — `MenuItem`, `MenuAction` (discriminated union including `NoopAction`), `MenuVariant`, `ViewId` (`"main" | "submenu" | "setup"`), `ConnectionInfo`, `ConnectionStatus`.

### Views

Three views identified by `ViewId`: `"main"`, `"submenu"`, `"setup"`.

- `src/tui/App.ts` — manages a view stack for back navigation. Handles the `"setup"` view's keyboard routing. Accepts `onConnectionSaved` callback for saving config and reconnecting. Exposes `updateConnectionInfo(info)` to push header updates from the HA service.
- `src/tui/MainMenu.ts` — header bar + title + filter bar + `MenuList` + help bar.
- `src/tui/SubmenuView.ts` — header bar + breadcrumb title + filter bar + `MenuList` + help bar.
- `src/tui/ConnectionForm.ts` — shared URL + token form used by first-run setup **and** Settings > Connection. Accepts `initialValues` (pre-fills with existing config). Keyboard: Tab/Enter advance fields; Escape cancels if `onCancel` is provided.

### Reusable components

- `MenuList` (`src/tui/MenuList.ts`) — `ScrollBoxRenderable` with Fuse.js fuzzy filter.
- `VariantPopup` (`src/tui/VariantPopup.ts`) — absolute overlay using `SelectRenderable`.
- `Toast` (`src/tui/Toast.ts`) — top-right notification overlay.
- `breadcrumb.ts` — styled breadcrumb trail formatter.
- `helpBar.ts` — formats key-action pairs with auto row-wrapping.
- `headerBar.ts` — formats the connection-state header line shown at the top of every persistent view.

### Services

- `HomeAssistant` (`src/services/HomeAssistant.ts`) — HA WebSocket connection manager.
- `CommandRunner` (`src/services/CommandRunner.ts`) — shell command execution (suspend/silent/notify).

### Theme

`src/theme.ts` — `Theme` interface (tokens: `bg`, `bgElevated`, `bgSelected`, `bgInput`, `accent`, `accentFg`, `surface`, `fg`, `fgMuted`, `fgSubtle`, `fgGhost`, `green`, `red`, `yellow`, `transparent`) + `DEFAULT_THEME` (Catppuccin Mocha).

## Conventions

### File naming

- PascalCase for classes/components: `MainMenu.ts`, `SubmenuView.ts`, `ConnectionForm.ts`
- camelCase for utilities: `breadcrumb.ts`, `helpBar.ts`, `headerBar.ts`
- Services in `src/services/`, TUI components in `src/tui/`

### Menu item IDs

Dot-separated, stable identifiers: `"settings"`, `"settings.connection"`. The ID hierarchy matches the submenu nesting.

### Imports

All local imports use `.js` extensions (bundler module resolution with TypeScript).

### Logging

Debug logging goes to stderr via `console.error` with a prefix: `[ha-tui:App]`, `[ha-tui:HomeAssistant]`, etc. This keeps stdout clean for the TUI renderer.

## Commands

```sh
bun run dev          # Run with --watch for development
bun run build        # Compile to standalone binary at dist/home-assistant-tui
bun run format       # Format with Prettier
bun run format:check # Check formatting
bunx tsc --noEmit    # Typecheck
```

## Adding a new view

1. Add a new value to `ViewId` in `src/types.ts`
2. Create a view class in `src/tui/` (root `BoxRenderable`, `setVisible()`, `focus()`, `blur()`)
3. Instantiate in `App.constructor`, add to `showView()`, `focusActiveView()`, `blurActiveView()`
4. Add a `ViewAction` menu item or navigate programmatically via `pushView()`
5. If the view needs connection state, add `updateConnectionInfo(info)` and call it from `App.updateConnectionInfo`

## Adding a new service

1. Define the service as a plain class in `src/services/`
2. Instantiate in `index.ts` and inject dependencies via the `App` constructor or callbacks
3. Use `Effect.gen` in `index.ts` only for the top-level program wrapper
