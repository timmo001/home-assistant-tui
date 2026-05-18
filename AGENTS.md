# AGENTS.md

Project instructions for AI coding agents working in this repository.

## Project overview

`starter-tui-menu` is a Bun + TypeScript TUI menu application built on `@opentui/core` and `effect`. It provides a main menu with fuzzy search, nested submenus with breadcrumb navigation, variant popups, toast notifications, and shell command execution.

## Tech stack

- **Runtime**: Bun (not Node)
- **Language**: TypeScript (strict, ESNext, bundler module resolution)
- **TUI framework**: `@opentui/core` — provides `CliRenderer`, `BoxRenderable`, `TextRenderable`, `SelectRenderable`, `ScrollBoxRenderable`, `InputRenderable`, and styled text via `t`, `fg`, `bold`, `dim` template tags
- **Effect**: `effect` v4 beta — used for the program entry point (`Effect.gen`, `Effect.runPromise`). Services can use `Context.Service`, `Layer`, `PubSub`, `Stream` when needed.
- **Fuzzy search**: `fuse.js` — weighted fuzzy matching in `MenuList`

## Architecture

### Entry point

`src/index.ts` — parses CLI flags, creates the renderer, wires dependencies, starts the app. Uses `Effect.gen` as the program wrapper but does not require service layers for the base skeleton.

### Menu system

- `src/menu.ts` — static menu item definitions using helper functions (`item()`, `cmd()`, `silent()`, `notify()`, `view()`, `submenu()`). Items are registered in three maps: `mainMenuItems` (array), `submenus` (Map), `menuItemsById` (Map).
- `src/types.ts` — `MenuItem`, `MenuAction` (discriminated union), `MenuVariant`, `ViewId`.
- Adding a menu item: define it in `menu.ts`, add to the appropriate array, register submenus in `submenus` and `submenuTitles` maps, call `registerItems()`.

### Views

Two views identified by `ViewId`: `"main"` and `"submenu"`.

- `src/tui/App.ts` — manages a view stack for back navigation. All views created at construction, shown/hidden via `setVisible()`. Dispatches actions based on `MenuAction.type`.
- `src/tui/MainMenu.ts` — main menu with configurable title/subtitle, filter bar, `MenuList`, help bar.
- `src/tui/SubmenuView.ts` — generic nested submenu with breadcrumb trail, internal menu stack for depth. Looks up items from the `submenus` registry.

### Reusable components

- `MenuList` (`src/tui/MenuList.ts`) — `ScrollBoxRenderable` subclass with Fuse.js fuzzy filter, two-line rows (icon + title / description), arrow navigation, type-to-filter. Configurable via `MenuListOptions`.
- `VariantPopup` (`src/tui/VariantPopup.ts`) — absolutely positioned centred overlay using `SelectRenderable`. Shows when a menu item has `variants`.
- `Toast` (`src/tui/Toast.ts`) — single-slot notification overlay (top-right, z-index 200). ID-based replacement, auto-dismiss timing per variant.
- `breadcrumb.ts` — formats `["Root", "Sub", "Nested"]` into styled `Root > Sub > **Nested**`.
- `helpBar.ts` — formats key-action pairs with auto row-wrapping.

### Services

- `CommandRunner` (`src/services/CommandRunner.ts`) — three execution modes: `runSuspended` (suspend renderer, inherited stdio), `runSilent` (background, piped), `runNotify` (background with toast feedback). Uses `Bun.spawn`.

### Theme

- `src/theme.ts` — exports `Theme` interface (15 semantic colour tokens + `transparent` flag) and `DEFAULT_THEME` constant (Catppuccin Mocha). To add dynamic theme loading, implement a function that returns a `Theme` and wire it into `index.ts`.

## Conventions

### File naming

- PascalCase for classes/components: `MainMenu.ts`, `SubmenuView.ts`, `MenuList.ts`
- camelCase for utilities: `breadcrumb.ts`, `helpBar.ts`
- Services in `src/services/`, TUI components in `src/tui/`

### Menu item IDs

Dot-separated, stable identifiers: `"greet"`, `"settings.display.colors"`. The ID hierarchy matches the submenu nesting.

### Imports

All local imports use `.js` extensions (bundler module resolution with TypeScript).

### Logging

Debug logging goes to stderr via `console.error` with a prefix: `[starter-tui:App]`, `[starter-tui:CommandRunner]`, etc. This keeps stdout clean for the TUI renderer.

## Commands

```sh
bun run dev          # Run with --watch for development
bun run build        # Compile to standalone binary at dist/starter-tui-menu
bun run format       # Format with Prettier
bun run format:check # Check formatting
bunx tsc --noEmit    # Typecheck
```

## Adding a new view

1. Add a new value to `ViewId` in `src/types.ts`
2. Create a view class in `src/tui/` following the `MainMenu`/`SubmenuView` pattern (root `BoxRenderable`, `setVisible()`, `focus()`, `blur()`)
3. Instantiate it in `App.constructor`, add to `showView()`, `focusActiveView()`, `blurActiveView()`
4. Add a `ViewAction` menu item or navigate programmatically via `pushView()`

## Adding a new service

1. Define the service interface in `src/services/`
2. Optionally use `Context.Service` and `Layer` from Effect for dependency injection
3. Inject into `AppDeps` and pass through to views that need it
4. Compose layers in `index.ts` if using Effect services
