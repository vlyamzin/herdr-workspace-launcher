# workspace-launcher

A [Herdr](https://herdr.dev) plugin. Press a hotkey to get a floating popup with a fuzzy-searchable
list of **workspace templates**, launch one, or create/edit/delete templates with a wizard.

A template is one Herdr workspace: a label, a directory, and a list of tabs, each split into panes
running whatever commands you like.

## Install

Requires Node.js ≥ 20 + npm, [fzf](https://github.com/junegunn/fzf) on `PATH`, Herdr ≥ 0.9.0 (Linux/macOS).

From GitHub (Herdr clones the repo and runs `npm ci && npm run build`):

```sh
herdr plugin install vlyamzin/herdr-workspace-launcher               # follow main
herdr plugin install vlyamzin/herdr-workspace-launcher --ref v0.1.0  # or pin a release
herdr plugin update vlyamzin.workspace-launcher                      # fetch updates for the recorded ref
```

A pinned `--ref` stays on that tag; to move to a newer release, install again with the new tag.
Releases and their notes: https://github.com/vlyamzin/herdr-workspace-launcher/releases

From a local checkout (for development; `link` doesn't run the build):

```sh
npm install && npm run build && herdr plugin link "$PWD"
```

Then bind a key in your Herdr `config.toml`:

```toml
[[keys.command]]
key = "prefix+space"
type = "plugin_action"
command = "vlyamzin.workspace-launcher.open"
description = "workspace launcher"
```

## Usage

| Key | In the list |
|---|---|
| `enter` | launch the template (or start the wizard on **+ New template**) |
| `ctrl-n` | new template (the current query pre-fills the name) |
| `ctrl-e` | edit the selected template |
| `ctrl-d` | delete the selected template (asks first) |
| `ctrl-o` | open `templates.toml` in `$VISUAL` / `$EDITOR` |
| `esc` | close |

Search matches template names. Launching a template whose label is already open as a workspace
focuses that workspace instead of creating a duplicate.

The wizard asks for: name → directory (defaults to the focused pane's cwd; `~` works) → number of
tabs → per tab: name, layout preset, pane count, sizes, and a command per pane (blank = plain shell).
When editing, every prompt is pre-filled, so pressing Enter all the way through changes nothing.
`Esc` or `Ctrl-C` cancels back to the list.

A pane's command runs as `$SHELL -ic '<cmd>; exec $SHELL'`, so quitting the program leaves you in
a shell in the same directory instead of closing the pane.

For testing outside the popup: `HERDR_PLUGIN_CONFIG_DIR=… node dist/launch.js <name>`.

## Template format

Templates live in `$HERDR_PLUGIN_CONFIG_DIR/templates.toml` (see `herdr plugin config-dir
vlyamzin.workspace-launcher`). The file is hand-editable. Saving from the wizard rewrites it, so
comments are not preserved.

```toml
[[template]]
name = "api"            # also the workspace label; must be unique
dir = "~/code/api"      # optional, see below

[[template.tab]]
name = "dev"
preset = "main-left"
sizes = [65]            # optional, see presets

[[template.tab.pane]]
command = "nvim ."

[[template.tab.pane]]
command = "npm run dev"
label = "server"        # optional; default = first word of the command

[[template.tab.pane]]   # no command = plain shell
```

### One template for many worktrees

Leave `dir` out (or blank in the wizard) and the template launches wherever you open the popup:
the focused pane's directory, moved up to its git worktree root. The workspace label becomes
`<name>:<worktree folder>`, e.g. `api:feature-x`, so each worktree gets its own workspace, and
launching again from the same worktree focuses it.

```toml
[[template]]
name = "api"   # no dir → current worktree
```

Panes are listed in slot order (the wizard and the preview number them). For a tab with no
`[[template.tab.pane]]` entries, the preset's minimum number of plain shells is used.

## Presets

| Preset | Panes | `sizes` |
|---|---|---|
| `single` | 1 | — |
| `columns` | 2–6, side by side | optional % per pane, e.g. `[50, 25, 25]`; omitted = equal |
| `rows` | 2–6, stacked | same as `columns` |
| `main-left` | big pane left + 1–5 stacked right | `[main %]`, default 60 |
| `main-top` | big pane top + 1–5 side by side below | `[main %]`, default 60 |
| `grid` | 4, in a 2×2 (TL, TR, BL, BR) | `[left column %, top row %]`, default 50/50 |

`columns` and `rows` sizes are relative weights, so they don't have to add up to 100.

## Releasing

Versions follow SemVer; `package.json`, `herdr-plugin.toml` and the `vX.Y.Z` tag always match.

1. Add changes under `## [Unreleased]` in `CHANGELOG.md` and commit.
2. `npm version patch` (or `minor` / `major`). This bumps `package.json`, copies the version into
   `herdr-plugin.toml`, turns `Unreleased` into the new version section, commits `Release vX.Y.Z`
   and tags `vX.Y.Z`.
3. `git push --follow-tags`. The Release workflow checks the versions match, builds, and publishes
   a GitHub release with that version's changelog section.
