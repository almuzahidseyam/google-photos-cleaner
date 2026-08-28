# Architecture

Three scripts, no dependencies, no build step.

```
popup.html/js/css   the only consent surface; owns settings, arms the destructive action
background.js       service worker; the single owner of persisted status
content.js          the selection and Trash loop; the only code that touches the page
```

## Why the status lives in the service worker

The content script is destroyed on every navigation, and the popup only exists while
it is open. Neither can hold the counters for a run that takes an hour. So
`content.js` reports progress to `background.js`, which writes it to
`chrome.storage.local` and re-broadcasts it for whatever popup happens to be open.
Closing the popup mid-run therefore loses nothing, and reopening it reads the last
stored status immediately.

The re-broadcast rejects when no popup is listening. That is the normal case, and it
is caught and ignored on purpose.

## Message flow

```
popup  --GPC_PING-------> content   (does the script exist in this tab?)
popup  --GPC_TEST------->  content   compatibility test, never confirms
popup  --GPC_START----->  content   run(); reads settings from storage itself
popup  --GPC_PAUSE/RESUME/STOP--> content
popup  --GPC_DIAGNOSE-->  content   read-only snapshot, returned synchronously
content --GPC_STATUS--->  background --GPC_STATUS_BROADCAST--> popup
```

`GPC_PING` exists because a content script declared in the manifest does not exist in
tabs that were already open when the extension was installed or reloaded. The popup
pings, and injects `content.js` via `chrome.scripting` if there is no answer, rather
than telling the user to reload.

`content.js` guards itself with `globalThis.__GPC_CONTENT_LOADED__` so that injection
into a tab that already has it does not register a second message listener — which
would double every click. The guard is deliberately not version-stamped, so future
versions do not need to rename it.

## Finding things on the page

Selector strategy, in priority order:

**Structural and ARIA first.** `[role="main"]` for the gallery, `[role="checkbox"]`
for tile selection, `[data-delete-origin] button` for the Trash action,
`[role="dialog"]` / `[role="alertdialog"]` for the confirmation. These are the parts
of Google Photos most likely to survive a redesign, because they carry accessibility
meaning.

**Google's class names only as optional fast paths.** `.ckGgle` is accepted as
"definitely a tile checkbox" and `.R4HkWb` rejected as "a date-header select-all", but
neither is *required* — they are obfuscated names that can change in any deploy. The
same applies to `.rtExYb`, the native selected-count readout: preferred when present,
with a fallback to counting checked checkboxes.

**Do not require visibility.** An earlier iteration failed because it waited for a
tile checkbox to be visibly rendered, and Google keeps them hidden until hover. Tile
checkboxes are matched structurally instead: a `[role="checkbox"]` with an `img` or
`video` within ten ancestors, and not inside a dialog.

**Do not depend on English where it can be avoided.** Labels are read from
`aria-label`, `title`, `data-tooltip` and text content together, and a locale-agnostic
structural test backs up every text match. The one place English still matters is
picking the confirm button out of the dialog; when that fails you get
`NO_CONFIRM_BUTTON` rather than a wrong click.

**Pick the right `[role="main"]`.** Photos can render more than one. `chooseMain()`
scores candidates by how many media checkboxes, checkboxes and media elements they
contain and takes the winner, rather than assuming the first.

**Find the real scroller.** The gallery is not always scrolled by the document.
`findScroller()` walks up to eight ancestors plus the descendants of `main`, keeps
only elements that are actually taller than their viewport and have a scrolling
`overflow-y`, and prefers one that contains `main`.

## The selection loop

`selectUpTo(target)` fills a batch:

1. Read the native selected count.
2. Take the unchecked tile checkboxes in document order. Plain-click the first,
   shift-click the last — Google's own range selection, so a 500-item batch costs two
   clicks rather than 500.
3. If the count did not move, Google's range handler did not react; fall back to
   clicking each tile individually.
4. Scroll down by ~72% of the viewport, wait for the virtualised grid to render more
   tiles, repeat.
5. Stop at the target, or when six consecutive passes make no progress, or at the
   bottom of the list.

Then `deleteSelected()` opens the Trash dialog, verifies a safe confirmation exists,
and either clicks it or — in dry-run mode — dismisses it. Between batches the run
scrolls back to the top, because deleting items re-flows the grid and the top is the
only reliably stable anchor.

Dry run stops after the first batch by design: nothing was deleted, so a second pass
would select exactly the same items forever.

## Fail-closed in practice

Every abort throws through `fail(code, message)`, which attaches a stable `code`. The
popup maps codes to recovery hints and `npm test` fails if a code exists without one,
so the UI and `docs/SAFETY.md` cannot drift apart from the code.

Dismissing a dialog prefers its own Cancel button and falls back to Escape. A
synthetic Escape dispatched at `document` is not always honoured, which could
otherwise leave a confirmation dialog open after a failed test.

The run loop re-checks the view on every batch. If the tab has left
`photos.google.com`, or navigated into Trash, it stops rather than continuing against
whatever is now on screen.

Reaching the batch limit is reported as a normal finish, not an error. An earlier
version threw there, and a completed run read as a crash.

## Testing

The extension can only be exercised for real against Google's live DOM, so `npm test`
covers what is checkable offline: the manifest against `package.json` and
`CHANGELOG.md`, the existence of every referenced file, the permission surface, the
popup's ids against the popup script, every `fail()` code against its hint, and both
scripts loaded in a stubbed `chrome`/DOM context to exercise ping, diagnostics, the
double-injection guard, Trash-view detection and status normalisation.

Every check was proven by reintroducing the bug it exists to catch and confirming the
suite went red — manifest version drift, a missing icon path, `<all_urls>` in the
manifest, an extra permission, a renamed popup id, `window.confirm` returning, the
double-injection guard removed, an undocumented error code, Trash-view detection
disabled, and status defaults not being filled in. Ten mutations, ten red runs, every
file restored byte-for-byte afterwards.
