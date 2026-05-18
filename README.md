# Home Assistant TUI

A terminal UI for [Home Assistant](https://www.home-assistant.io/), built with [OpenTUI](https://github.com/ArcticGlacier/opentui), [Effect](https://effect.website), and [Fuse.js](https://www.fusejs.io/).

## Features

- **Dashboard** — favorites and area overview pulled from HA frontend config
- **Entity browser** — browse all entities with domain grouping, paging, and per-area filtering
- **Live connection header** — status, URL, HA version, user, last update timestamp
- **Two-phase search** — exact substring match first, then Fuse.js fuzzy fallback
- **MDI icon resolution** — Material Design Icons mapped to Nerd Font codepoints for terminal display
- **Nested submenus** with breadcrumb trail navigation
- **Variant popup** for multi-action menu items
- **Toast notifications** (info/success/error with auto-dismiss)
- **i18n** — locale system with English strings (extensible)
- **First-run setup** with a shared connection form reused by Settings > Connection
- **Catppuccin Mocha** theme with a `Theme` interface ready for custom loaders
- **CLI subcommand resolution** with greedy longest-match against the menu registry
- **`test-connection` subcommand** — diagnose connectivity without launching the TUI

## Quick start

```sh
bun install
bun run dev
```

On first launch, a setup form prompts for your Home Assistant URL and a [long-lived access token](https://www.home-assistant.io/docs/authentication/#your-account-profile). Config is saved to `~/.local/share/home-assistant-tui/config.yml`.

## Build

Compile to a standalone binary:

```sh
bun run build
# outputs: dist/home-assistant-tui
```

## Commands

```sh
bun run dev          # Run with --watch for development
bun run build        # Compile to standalone binary at dist/home-assistant-tui
bun run gen:icons    # Regenerate MDI→Nerd Font codepoint map
bun run format       # Format with Prettier
bun run format:check # Check formatting
bunx tsc --noEmit    # Typecheck
```

## Configuration

`~/.local/share/home-assistant-tui/config.yml`:

```yaml
homeassistant:
  url: http://homeassistant.local:8123
  token: <long-lived-access-token>
```

Use **Settings > Connection** to change these values from within the TUI.

## Structure

```
src/
├── index.ts                   Entry point — config, HA service, app bootstrap
├── config.ts                  YAML config load/save, isConfigured()
├── flags.ts                   CLI flag parsing and subcommand resolution
├── menu.ts                    Menu item definitions and MenuRegistry builder
├── search.ts                  Two-phase search (exact substring + Fuse.js fuzzy)
├── theme.ts                   Theme interface and default (Catppuccin Mocha)
├── types.ts                   Shared types: MenuItem, ConnectionInfo, ViewId, etc.
├── cmd/
│   └── testConnection.ts      test-connection diagnostic subcommand
├── data/
│   ├── areaRegistry.ts        AreaRegistryEntry + fetchAreaRegistry
│   ├── deviceRegistry.ts      DeviceRegistryEntry + fetchDeviceRegistry
│   ├── entityRegistry.ts      EntityRegistryEntry + subscribe/fetch
│   ├── floorRegistry.ts       FloorRegistryEntry + fetchFloorRegistry
│   ├── frontend.ts            Fetch HA frontend config (favorites)
│   ├── iconResolver.ts        MDI→Nerd Font icon resolution + domain fallbacks
│   ├── mdiCodepoints.ts       Generated MDI name→codepoint map
│   ├── stateTranslation.ts    fetchStateTranslations + translateEntityState
│   └── usagePrediction.ts     Common-controls usage prediction
├── i18n/
│   ├── index.ts               Strings context (defaults to English)
│   ├── en.ts                  English locale strings
│   └── types.ts               Locale interface definition
├── services/
│   ├── HomeAssistant.ts       HA WebSocket lifecycle + connection state
│   └── CommandRunner.ts       Shell command execution (suspend/silent/notify)
└── tui/
    ├── App.ts                 View stack, action dispatch, global keyboard
    ├── MainMenu.ts            Main menu view — header + filter + list + help
    ├── SubmenuView.ts         Nested submenu — header + breadcrumb + list + help
    ├── DashboardView.ts       Dashboard — favorites + areas overview
    ├── EntitiesView.ts        Entity browser with grouping and paging
    ├── AreaEntitiesView.ts    Entities filtered to a single area
    ├── ConnectionForm.ts      Shared URL + token form (setup + settings)
    ├── ConnectedView.ts       Connection-aware view base
    ├── HeaderBlock.ts         Header block component
    ├── MenuList.ts            Reusable fuzzy-filterable scroll list
    ├── VariantPopup.ts        Centred popup for variant selection
    ├── Toast.ts               Single-slot toast notification overlay
    ├── breadcrumb.ts          Breadcrumb trail formatter
    ├── filterBar.ts           Filter bar component
    ├── headerBar.ts           Connection state header formatter
    └── helpBar.ts             Auto-wrapping keybind help bar
```

## Views

| ViewId | Description |
|---|---|
| `main` | Main menu with fuzzy search |
| `dashboard` | Favorites and area cards from HA frontend config |
| `entities` | All entities grouped by domain with paging |
| `areaEntities` | Entities filtered to a single area |
| `submenu` | Nested submenu (e.g. Settings) |
| `setup` | First-run connection form |

## Home Assistant types

All HA types come from [`home-assistant-js-websocket`](https://github.com/home-assistant/home-assistant-js-websocket) — the official HA client library. The [`../frontend`](../frontend) repo is the authoritative reference for types, helpers, and patterns beyond what the package exports directly.

## Action types

| Type | Behaviour |
|---|---|
| `command` | Suspend TUI, run with inherited stdio, optionally wait for keypress |
| `silent` | Run in background, capture output silently |
| `notify` | Run in background with toast progress/success/error |
| `view` | Navigate to a TUI view |
| `submenu` | Open a nested submenu |
| `noop` | No-op — for placeholder/work-in-progress menu items |
| `quit` | Exit the application |

## Tech stack

- **Runtime**: [Bun](https://bun.sh)
- **TUI framework**: [@opentui/core](https://github.com/ArcticGlacier/opentui)
- **Effect system**: [Effect](https://effect.website) v4
- **Fuzzy search**: [Fuse.js](https://www.fusejs.io/)
- **HA client**: [home-assistant-js-websocket](https://github.com/home-assistant/home-assistant-js-websocket)
- **Config**: [yaml](https://eemeli.org/yaml/)
