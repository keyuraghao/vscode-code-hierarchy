# Changelog

All notable changes to Code Hierarchy are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-23

First release.

### Added

- A hierarchy panel docked in the editor area beside your code, listing the
  functions, classes and methods of the active file as a nested tree. It opens
  by itself the first time you focus a source file, so there is no sidebar icon
  and nothing to click.
- Fuzzy search box: subsequence matching in the style of Go to Symbol, with the
  matched characters highlighted, results ranked by match quality, and parents
  kept so a nested hit stays reachable.
- Live rebuilding as you type, debounced so it does not fight your editing.
- Click a symbol to move the cursor there, with a brief highlight of its body.
  Focus stays in the panel so you can keep browsing.
- Cursor following: the symbol containing the cursor is highlighted and its
  parents expanded.
- Full keyboard navigation with arrow keys, `Enter` and `Esc`, plus
  `Ctrl+Alt+H` to jump to the search box from anywhere.
- Functions-only mode that hides fields, properties and variables, and drops
  containers left with nothing callable inside.
- Sorting by file position or by name.
- Status bar breadcrumb showing the enclosing symbol path.
- Fallback pattern parser for files whose language has no server installed,
  covering Python by indentation and C-like languages by brace depth. Its
  results are labelled approximate in the panel footer.
- Ten settings under `codeHierarchy.*`.
- Output channel at Output -> Code Hierarchy, with a log level picker.

### Notes

- The panel uses VS Code's own codicon font and theme colour variables, so it
  matches whatever theme is active.
- The webview runs under a strict content security policy: no remote resources,
  no inline scripts.
