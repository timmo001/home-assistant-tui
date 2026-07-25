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
- **Shell completions** for Bash, Fish, and Zsh
- **`test-connection` subcommand** — diagnose connectivity without launching the TUI
- **Todo status output** — `home-assistant-tui todo <entity> --bar-json` or `--count` for status bars and dashboards

## Quick start

```sh
mise run dev
```

For the same checks used in CI:

```sh
mise run check
```

On first launch, a setup form prompts for your Home Assistant URL and a [long-lived access token](https://www.home-assistant.io/docs/authentication/#your-account-profile). Config is saved to `~/.local/share/home-assistant-tui/config.yml`.

## Build

Compile to a standalone binary:

```sh
mise run build
# outputs: dist/home-assistant-tui
```

## Commands

```sh
mise run dev          # Run with --watch for development
mise run serve:start  # Run in a background Terminal Control session
mise run serve:show   # Show the visible background TUI screen
mise run serve:stop   # Stop the background TUI session
mise run build        # Compile to standalone binary at dist/home-assistant-tui
mise run typecheck    # Typecheck with tsc
mise run check        # Format check, typecheck, and build
mise run gen:icons    # Regenerate MDI→Nerd Font codepoint map
mise run format       # Format with Prettier
mise run format:check # Check formatting
mise run package:arch # Build an Arch Linux package in dist/
```

Generate shell completions with the CLI:

```sh
home-assistant-tui completions zsh
home-assistant-tui completions bash
home-assistant-tui completions fish
```

Todo lists can also emit non-interactive output:

```sh
home-assistant-tui todo todo.my_tasks --count
home-assistant-tui todo todo.my_tasks --bar-json
home-assistant-tui todo todo.my_tasks --bar-json --all
```

## Packaging

This repo publishes rolling and stable Linux packages:

- `mise.toml` tasks for local development, CI, and packaging
- `.github/workflows/ci.yml` for build verification on PRs and `main`
- `.github/workflows/publish-aur-git.yml` for publishing `home-assistant-tui-git` after relevant changes to `main`
- `.github/workflows/release.yml` for adding x86_64 and aarch64 archives, deb and RPM packages, and checksums to stable releases before publishing `home-assistant-tui-bin`
- `.scripts/linux/` Arch packaging helpers for both source and prebuilt-binary packages

Stable tags and GitHub Releases are created manually. Publishing a non-prerelease Release packages its existing tag; the workflow can also replay an existing stable tag manually.

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
