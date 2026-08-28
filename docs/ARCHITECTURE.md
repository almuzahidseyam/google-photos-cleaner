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

**Read labels one source at a time.** `labelsOf()` returns `aria-label`, `title`,
`data-tooltip`, `data-tooltip-text` and text content as separate strings, and
`labelMatches()` tests the pattern against each. Joining them first — the earlier
approach — meant a button carrying both `aria-label="Move to trash"` and the text
"Move to trash" read as `"move to trash move to trash"`, which no anchored pattern
can match.

**Be honest about the one English dependence.** Everything about finding and
selecting tiles is locale-agnostic, but the permanence test in
`dialogLooksPermanent()` is English phrases, and it is the only thing standing
between a run and a permanent-deletion dialog. So rather than let it silently pass
on a page it cannot read, the compatibility test reads `<html lang>` and refuses a
non-English interface with `UNSUPPORTED_UI_LANGUAGE`. Inside a dialog, only *Move to
Trash* / *Move to Bin* is accepted unconditionally; a bare *Delete* additionally
requires that declared-English page. There is no fallback that picks a button by
position or by how many buttons the dialog has — when nothing matches, the run stops
with `NO_CONFIRM_BUTTON` rather than clicking.

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

The count is `max(native readout, tiles this loop watched turn checked)`, not the
readout alone. If `.rtExYb` is renamed, the readout reads zero, the loop never
believes it reached `target`, and "stop after one batch" quietly becomes thousands of
items — so the loop counts what it did off the DOM as well and trusts whichever
number is higher.

`clearSelection()` prefers Google's own exit control (*Clear selection*, *Cancel
selection*, and the variants around them), then Escape — but only when no dialog is
open, since Escape would otherwise close the dialog instead — and only then falls
back to unclicking tiles one by one.

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
name against Google's branding rules, the popup's ids against the popup script, every
`fail()` code against both its popup hint and its row in `docs/SAFETY.md`, the absence
of any confirm-button fallback that guesses by position or count, and both scripts
loaded in a stubbed `chrome`/DOM context to exercise ping, diagnostics, the
double-injection guard, Trash-view detection, the non-English refusal and status
normalisation. Twenty-three checks.

Every check was proven by reintroducing the bug it exists to catch and confirming the
suite went red — manifest version drift, a missing icon path, `<all_urls>` in the
manifest, an extra permission, a renamed popup id, `window.confirm` returning, the
double-injection guard removed, an undocumented error code, Trash-view detection
disabled, status defaults not being filled in, a name leading with a Google
trademark, the npm name drifting from the manifest name, the store listing's Name
field left stale, the two-button confirm fallback reinstated, an error code missing
from `docs/SAFETY.md`, and the non-English refusal deleted. Sixteen mutations, sixteen
red runs, every file restored byte-for-byte afterwards.
