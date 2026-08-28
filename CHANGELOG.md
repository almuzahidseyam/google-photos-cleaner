# Changelog

All notable changes to this project are documented here. The version below is the
one in `extension/manifest.json`; `npm test` fails if the two disagree.

## 1.0.0 — 2026-08-29

First public release. Three private iterations preceded it; this is the first
version published as source.

### Added
- **Dry run.** Selects a batch, opens the real confirmation dialog, verifies that
  a safe *Move to Trash* confirmation exists, then dismisses it. Reports how many
  items *would* have been trashed and deletes nothing.
- **Configurable batch size** (50/100/250/500) and a **stop-after-N-batches**
  limit, both persisted in `chrome.storage.local`.
- **Copy diagnostics.** A read-only snapshot of what the extension can see on the
  current page — region counts, whether the Trash button and native counter were
  found, scroller geometry — for pasting into a bug report.
- **Named error codes** (`NO_TRASH_BUTTON`, `PERMANENT_DELETE_DIALOG`,
  `BATCH_TIMEOUT`, …) with a recovery hint shown per code in the popup and
  documented in `docs/SAFETY.md`.
- **Elapsed-time readout** while a run is in progress.
- Extension icons at 16/32/48/128, generated reproducibly by `scripts/make-icons.py`.
- `npm test` — a dependency-free suite that checks the manifest against
  `package.json`, verifies every referenced file exists, confirms the popup markup
  carries every id the popup script reads, and loads both scripts against a stubbed
  `chrome`/DOM to exercise ping, diagnostics and status handling.
- GitHub Actions workflow that runs the suite and attaches a loadable ZIP to tags.

### Changed
- **The consent gate no longer uses `window.confirm`.** Dialogs raised from an
  extension popup behave inconsistently across Chrome versions, so the destructive
  button now arms on the first click and starts on a second click within six
  seconds, and disarms itself if you wait.
- **Dialogs are dismissed by their own Cancel button** where one is present,
  falling back to Escape. A synthetic Escape dispatched at `document` is not always
  honoured, which could leave a confirmation dialog open after a failed test.
- **Reaching the batch limit is now a normal finish**, reported as *done*. It
  previously threw and surfaced as an error, which read as a crash.
- **The run loop re-checks the view on every batch.** If the tab navigates away
  from `photos.google.com`, or into Trash, the run stops instead of continuing
  against whatever is now on screen.
- Message names lost their `GPC3_` prefix, and the load guard is no longer
  version-stamped, so future versions do not need to rename anything.
- Restructured into `extension/`, `docs/` and `scripts/` for publication.
