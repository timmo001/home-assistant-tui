# Home Assistant TUI

A terminal UI for [Home Assistant](https://www.home-assistant.io/), built with [OpenTUI](https://github.com/ArcticGlacier/opentui), [Effect](https://effect.website), and [Fuse.js](https://www.fusejs.io/).

## Features

- Live connection state header (status, URL, HA version, user, last update)
- First-run setup flow with a shared connection form reused by Settings > Connection
- Fuzzy type-to-filter search (Fuse.js with weighted keys)
- Nested submenu navigation with breadcrumb trail
- Variant popup for multi-action menu items
- Toast notifications (info/success/error with auto-dismiss)
- Catppuccin Mocha theme with a `Theme` interface ready for custom loaders
- CLI subcommand resolution with greedy longest-match

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
├── index.ts                   Entry point — config check, HA service, app bootstrap
├── config.ts                  YAML config load/save, isConfigured()
├── flags.ts                   CLI flag parsing and subcommand resolution
├── menu.ts                    Menu item definitions and registries
├── theme.ts                   Theme interface and default (Catppuccin Mocha)
├── types.ts                   Shared types: MenuItem, ConnectionInfo, ViewId, etc.
├── services/
│   ├── HomeAssistant.ts       HA WebSocket service (home-assistant-js-websocket)
│   └── CommandRunner.ts       Shell command execution (suspend/silent/notify)
└── tui/
    ├── App.ts                 View stack, action dispatch, connection state routing
    ├── MainMenu.ts            Main menu view — header + filter + list + help
    ├── SubmenuView.ts         Nested submenu view — header + breadcrumb + list + help
    ├── ConnectionForm.ts      Shared URL + token form (first-run and settings)
    ├── MenuList.ts            Reusable fuzzy-filterable scroll list
    ├── VariantPopup.ts        Centred popup for variant selection
    ├── Toast.ts               Single-slot toast notification overlay
    ├── breadcrumb.ts          Breadcrumb trail formatter
    ├── headerBar.ts           Connection state header formatter
    └── helpBar.ts             Auto-wrapping keybind help bar
```

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
