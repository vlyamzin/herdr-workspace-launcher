# Changelog

All notable changes to this plugin. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions: [SemVer](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-27

### Added

- Hotkey popup with a fuzzy-searchable list of workspace templates (fzf) and a live preview of each template's layout.
- Launch a template as a Herdr workspace with tabs and split panes; focuses the workspace instead if it's already open.
- Wizard to create and edit templates; delete with confirmation; open `templates.toml` in `$EDITOR`.
- Presets: `single`, `columns`, `rows`, `main-left`, `main-top`, `grid`, with custom sizes.
- Templates without `dir` launch in the current git worktree, labelled `<name>:<worktree>`.
