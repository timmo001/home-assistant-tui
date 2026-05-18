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

## Tech stack

- **Runtime**: [Bun](https://bun.sh)
- **TUI framework**: [@opentui/core](https://github.com/ArcticGlacier/opentui)
- **Effect system**: [Effect](https://effect.website) v4
- **Fuzzy search**: [Fuse.js](https://www.fusejs.io/)
- **HA client**: [home-assistant-js-websocket](https://github.com/home-assistant/home-assistant-js-websocket)
- **Config**: [yaml](https://eemeli.org/yaml/)
