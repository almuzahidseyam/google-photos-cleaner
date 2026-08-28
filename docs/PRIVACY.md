# Privacy policy

**Bulk Trash for Google Photos collects nothing, transmits nothing, and contacts no
server of its own.** There is no account, no analytics, no telemetry, no
third-party service and no remote code. The extension makes no network requests
at all — every line it runs ships inside the package you installed.

Last updated: 29 August 2026. Contact: almuzahidseyam@gmail.com

## What is stored, and where

Three settings and one status object, held in `chrome.storage.local` on your own
machine. Nothing leaves the device.

| Key | What it holds |
| --- | --- |
| `settings.batchSize` | How many items to select per batch (50–500) |
| `settings.maxBatches` | Stop after this many batches; `0` means no limit |
| `settings.dryRun` | Whether the next run should delete nothing |
| `status` | The last run's state, item and batch counts, elapsed timestamps and, if it stopped, the error code |

Uninstalling the extension removes all of it. Nothing is written anywhere else,
and no file is created on disk.

## What is read

While you are on `https://photos.google.com/*`, and only there, the extension
reads the structure of the page in front of you: which tiles carry a checkbox,
whether a *Move to Trash* button is present, whether a confirmation dialog is
open, and the scroll geometry of the grid. It does this to click the same
controls you would click yourself.

It does not read, download, upload, copy, index or transmit your photographs,
their filenames, their metadata, their albums or anything identifying your Google
account. It has no interest in the content of a photo and no code that looks at
one.

## Diagnostics

*Copy diagnostics* exists so a bug report can describe a page the author cannot
see. It runs only when you press it, and the snapshot it puts on your clipboard
is a structural summary — counts of regions and checkboxes, whether the Trash
button was found, whether a dialog is open, scroller dimensions, the language the
page declares itself to be in, your settings
and the extension version. **No photo data, no filenames, no album names, no
email address and no account identifier appear in it.** Nothing is sent
anywhere; pasting it into a report is your decision and your action.

## Permissions, and why each one exists

| Permission | Why |
| --- | --- |
| `host_permissions: https://photos.google.com/*` | The only site the extension is allowed to touch. Nothing matches any other origin. |
| `storage` | Holds the four values in the table above, locally. |
| `activeTab` | Lets the popup act on the tab you have open when you press a button, instead of holding standing access to your tabs. |
| `scripting` | Injects the content script into that tab if Chrome has not already loaded it, which happens after the extension is updated or reloaded. |

There is no `<all_urls>`, no `tabs`, no `webRequest`, no `cookies`, no
`identity`, and no optional permission requested later.

## Deletion

The extension moves items to Google Photos' Trash, using the site's own
confirmation dialog. **It never empties Trash and has no code that could.**
Google retains trashed items for 60 days, and that window is deliberately left
as your way back. If a dialog offers permanent deletion rather than a move to
Trash, the run stops with `PERMANENT_DELETE_DIALOG` and clicks nothing.

## Changes

This policy is versioned in the repository along with the code, so its history is
readable at
<https://github.com/almuzahidseyam/google-photos-cleaner/commits/main/docs/PRIVACY.md>.

MIT licensed. Copyright (c) 2026 Muhammad Al-Muzahid.
