# Safety model

The premise of this extension is that deleting 60,000 photos is not a thing to be
clever about. Everything below is a rule the code actually enforces, not an
aspiration.

## Four hard rules

**1. Never invent a destructive action.** Every deletion goes through the same
*Move to Trash* button and the same confirmation dialog a person would click. There
is no API call, no request replay, and no attempt to reach Google's internal
endpoints. If the button cannot be found, nothing happens.

**2. Fail closed.** When the current DOM cannot be recognised with confidence, the
run stops and reports a named code. It never falls back to "click the button that
looks most likely". The one structural fallback for the confirmation dialog is
narrow on purpose: it fires only when the dialog has exactly two text buttons in the
ordinary Material layout *and* the dialog text does not read as permanent deletion.

**3. Refuse permanence.** Any dialog whose text matches *delete permanently*,
*permanently delete*, *delete forever*, *can't be restored* or *cannot be restored*
is dismissed, never confirmed. Trash is never emptied — there is no code path that
touches it, and the run refuses to operate while the Trash view is open.

**4. Consent is explicit and repeated.** The destructive button stays disabled until
a live test has passed on the current page. Pressing it arms it; a second press
within six seconds starts the run; waiting disarms it. `window.confirm` is
deliberately unused, because dialogs raised from an extension popup behave
inconsistently across Chrome versions.

## What is recoverable

Items go to Google Photos' Trash, where Google retains them for 60 days and restoring
is a normal operation in the Photos UI. That window is the safety net — but it is a
Google policy, not a promise from this project, and it does not apply to items you
then delete permanently yourself.

Back up first regardless. Google Takeout is the supported export path; verify the
counts in the export against the library before you start deleting, and keep a second
copy.

## Permissions, and why each one is needed

| Permission | Why |
| --- | --- |
| `host_permissions: https://photos.google.com/*` | The only site the extension may read or act on. |
| `storage` | Persists progress counters and your settings so closing the popup does not lose a run. |
| `activeTab` | Identifies the tab the popup is acting on. |
| `scripting` | Injects `content.js` into a Photos tab that was already open when the extension was installed or reloaded, instead of asking you to reload it. |

Nothing is sent anywhere. There is no analytics, no telemetry, no remote
configuration, and no network request of any kind in the extension's own code — the
manifest requests no host beyond `photos.google.com`, and `npm test` fails if that
changes or if `<all_urls>` ever appears.

## Error codes

Each code is thrown by `content.js`, carried through the service worker, and shown in
the popup alongside the recovery hint below. `npm test` fails if a code exists without
a hint.

| Code | Meaning | What to do |
| --- | --- | --- |
| `NOT_ON_PHOTOS` | The tab is not on `photos.google.com`, or navigated away mid-run. | Open Google Photos in the tab. |
| `ON_TRASH_VIEW` | The Trash or Bin view is open. | Go back to the main grid. Trash is deliberately out of scope. |
| `NO_MEDIA_CHECKBOX` | No photo or video tile checkbox could be found. | Wait for thumbnails to render, then retry. Albums, Search and Utilities views are not supported. |
| `NO_SELECTION_MODE` | A tile was clicked but Photos did not enter selection mode. | Reload the page and test again. |
| `NO_TRASH_BUTTON` | Selection works but the *Move to Trash* action could not be identified. | Likely a Google UI change. Copy diagnostics and open an issue. |
| `NO_DIALOG` | *Move to Trash* opened no recognisable confirmation. | Likely a Google UI change. Copy diagnostics and open an issue. |
| `PERMANENT_DELETE_DIALOG` | Google asked for permanent deletion. | The extension refuses to confirm it. Handle those items by hand. |
| `NO_CONFIRM_BUTTON` | The dialog's buttons could not be read confidently. | Often a locale issue — try Chrome in English, or open an issue with diagnostics. |
| `BATCH_TIMEOUT` | Photos did not finish a batch within 90 seconds. | Stopped to avoid double-acting. Reload and restart; items already in Trash will not be picked twice. |
| `ALREADY_RUNNING` | A run is in progress. | Press Stop first. |
| `UNKNOWN` | Anything unclassified. | Copy diagnostics and open an issue with them. |

## Reporting a problem

Use **Copy diagnostics** in the popup's Settings. The snapshot is read-only and
describes structure, not content: how many `[role="main"]` regions and media
checkboxes were found, whether the Trash button and native counter were located,
whether a dialog is open and whether it reads as permanent, scroller geometry, your
browser language and the extension version. It contains no photo data, no filenames,
and nothing identifying your account.
