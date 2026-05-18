# starter-tui-menu

A barebones TUI menu template built with [OpenTUI](https://github.com/ArcticGlacier/opentui), [Effect](https://effect.website), and [Fuse.js](https://www.fusejs.io/). Designed as a starting point for building terminal menu applications with Bun.

## Features

- Fuzzy type-to-filter search (Fuse.js with weighted keys)
- Nested submenu navigation with breadcrumb trail
- Variant popup for multi-action menu items
- Toast notifications (info/success/error with auto-dismiss)
- Command execution: suspended (with stdio), silent (background), notify (toast feedback)
- Catppuccin Mocha theme with a `Theme` interface ready for custom loaders
- CLI subcommand resolution with greedy longest-match

## Quick start

```sh
bun install
bun run dev
```

## Build

Compile to a standalone binary:

```sh
bun run build
# outputs: dist/starter-tui-menu
```

## Structure

```
src/
├── index.ts              Entry point
├── flags.ts              CLI flag parsing and subcommand resolution
├── menu.ts               Menu item definitions and registries
├── theme.ts              Theme interface and default theme
├── types.ts              Shared type definitions
├── services/
│   └── CommandRunner.ts  Shell command execution (suspend/silent/notify)
└── tui/
    ├── App.ts            View stack, action dispatch, variant popup routing
    ├── MainMenu.ts       Main menu view with filter bar
    ├── SubmenuView.ts    Generic nested submenu with breadcrumbs
    ├── MenuList.ts       Reusable fuzzy-filterable scroll list
    ├── VariantPopup.ts   Centred popup for variant selection
    ├── Toast.ts          Single-slot toast notification overlay
    ├── breadcrumb.ts     Breadcrumb trail formatter
    └── helpBar.ts        Auto-wrapping keybind help bar
```

## Adding menu items

Edit `src/menu.ts`. Use the helper functions to define items:

```ts
// Simple command
item("my-item", "", "My Item", "Description", cmd("echo hello"))

// With variants (popup with alternatives)
item("my-item", "", "My Item", "Description", cmd("echo default"), [
  { label: "Option A", description: "First option", action: cmd("echo a") },
  { label: "Option B", description: "Second option", action: cmd("echo b") },
])

// Submenu
item("parent", "", "Parent", "Opens a submenu", submenu("parent"))
```

Register submenus in the `submenus` and `submenuTitles` maps, and call `registerItems()` for flat ID lookup.

## Action types

| Type | Behaviour |
|---|---|
| `command` | Suspend TUI, run with inherited stdio, optionally wait for keypress |
| `silent` | Run in background, capture output silently |
| `notify` | Run in background with toast progress/success/error |
| `view` | Navigate to a TUI view |
| `submenu` | Open a nested submenu |
| `quit` | Exit the application |

## Extending

- **Theme**: Replace `DEFAULT_THEME` in `theme.ts` with a dynamic loader. The `Theme` interface is stable.
- **Views**: Add new `ViewId` values to `types.ts`, create view classes, wire them in `App.ts`.
- **Services**: Add Effect service layers in `index.ts` and inject through `AppDeps`.
- **Menus**: Add items to arrays in `menu.ts` and register in the maps.

## Tech stack

- **Runtime**: [Bun](https://bun.sh)
- **TUI framework**: [@opentui/core](https://github.com/ArcticGlacier/opentui)
- **Effect system**: [Effect](https://effect.website) v4
- **Fuzzy search**: [Fuse.js](https://www.fusejs.io/)
