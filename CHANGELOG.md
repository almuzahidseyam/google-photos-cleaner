# Changelog

All notable changes to this project are documented here. The version below is the
one in `extension/manifest.json`; `npm test` fails if the two disagree.

## 1.1.0 — 2026-08-29

A rename, a new icon, and one behaviour change that makes the safety guard honest
about what it can read. Nothing that already worked stops working.

### Changed
- **Renamed to Bulk Trash for Google Photos.** Google's branding rules do not allow
  a Google trademark to be a third-party product's own name; they do allow plain-text
  compatibility phrasing, so the distinctive part now comes first and the mark appears
  only in *for Google Photos*. The repository keeps its `google-photos-cleaner` slug
  so existing clones and links keep working.
- **New icon set.** Two amber tiles tipping into a white bin on a slate plate,
  regenerated at 16/32/48/128 by `scripts/make-icons.py`. It deliberately shares no
  colour or motif with Google Photos, and was checked at 16 px against both light and
  dark toolbars.
- **A non-English interface is now refused instead of run half-blind.** The guard that
  spots a permanent-deletion dialog reads English phrasing, so on a localised page it
  reported "not permanent" for every dialog. The compatibility test — and therefore
  every run, including a dry run — now stops with `UNSUPPORTED_UI_LANGUAGE` when
  `<html lang>` says the page is not English.
- **The confirmation button is chosen by its own label only.** The previous structural
  fallback accepted a dialog with exactly two buttons whenever the permanence test
  said no; combined with the point above, that could have clicked a permanent-deletion
  confirmation nothing had read. *Move to Trash* / *Move to Bin* is accepted outright,
  a bare *Delete* only on a declared-English page whose dialog does not read as
  permanent, and anything else stops the run with `NO_CONFIRM_BUTTON`.
- **Labels are matched one source at a time.** `aria-label`, `title`, the tooltip
  attributes and text content used to be joined into one string, so a button carrying
  both an aria-label and identical visible text read as "move to trash move to trash"
  and no anchored pattern could match it.
- **The selection loop no longer trusts Google's counter alone.** It also counts the
  tiles it watched turn checked and takes the higher number. If `.rtExYb` is renamed,
  the readout reads zero, the loop never believes it hit the target — and *stop after
  one batch* could have quietly become thousands of items.
- **Clearing a selection prefers Google's own exit control** (*Clear selection* and
  its variants), then Escape when no dialog is open, and only then falls back to
  unclicking tiles.

### Added
- `UNSUPPORTED_UI_LANGUAGE` in the popup's hint table and in `docs/SAFETY.md`.
- The page's declared language, whether it reads as English, and whether an exit-
  selection control was found, in the diagnostics snapshot.
- Four `npm test` checks, 23 in total: the name states compatibility instead of
  leading with a Google trademark and matches everywhere it appears; no dialog button
  is chosen by position or count; every `fail()` code is documented in
  `docs/SAFETY.md`; and a stubbed non-English page is refused with the right code.
- `docs/STORE_LISTING.md` now records that Chrome Web Store payments were retired in
  February 2021, and what charging would cost in privacy terms.

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
- **MIT header in every shipped file** — an `SPDX-License-Identifier` line and the
  copyright line, so each file states its own terms and its author.
- **`docs/PRIVACY.md`** — the privacy policy: nothing collected, nothing
  transmitted, the four locally stored values enumerated, and what the diagnostics
  snapshot does and does not contain.
- **`docs/STORE_LISTING.md`** — the Chrome Web Store submission answers: single
  purpose, a justification per permission, the data-usage disclosure, the listing
  copy and the screenshot set.
- Two more `npm test` checks: every shipped file carries the licence header, and
  the store material still describes the manifest it claims to describe — summary
  length, one justification per declared permission, and the storage keys the
  privacy policy enumerates.

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
