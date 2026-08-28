<h1 align="center">
  <img src="extension/icons/icon-preview.png" width="88" height="88" alt=""><br>
  Bulk Trash for Google Photos
</h1>

<p align="center">
  A Chrome extension that empties <em>your own</em> Google Photos library into Trash
  by driving the site's normal selection and <strong>Move to Trash</strong> UI —
  behind a live compatibility test, a dry run, and a two-click consent gate.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-1a73e8" alt="Manifest V3">
  <img src="https://img.shields.io/badge/dependencies-none-188038" alt="No dependencies">
  <img src="https://img.shields.io/badge/license-MIT-5f6368" alt="MIT licence">
</p>

---

## Why this exists

Google Photos has no "select everything" button. Clearing a large library by hand
means shift-clicking your way through tens of thousands of tiles, and Google
Takeout — the supported way to get your archive out — has no matching way to put the
account back to empty afterwards.

I hit this with an institute account holding roughly 60,000 items across ~374 GB. The
archive came out cleanly through Takeout; getting the account back to zero was the
part with no tool. This is that tool.

It automates the clicks a human would make. There is no private API, no request
forgery, and no session token handling: it runs in the page you are already signed
into and presses the same buttons you would.

## What it will and will not do

It moves items from the main Photos grid to Trash, in batches, from the top of the
library downward, reporting progress as it goes.

It will not empty Trash. Everything it does is recoverable for the 60 days Google
holds trashed items, and restoring is a normal Google Photos operation. It also
refuses to confirm any dialog whose wording reads as *permanent* deletion — if
Google offers that instead of the ordinary Trash confirmation, the extension stops
and hands the decision back to you.

**Back your library up first.** Run Google Takeout, verify the export, and ideally
copy it to a second disk before you delete anything. A tool that deletes 60,000
items quickly is only a good tool if the archive already exists.

## Install

There is no Web Store listing. Load it unpacked:

1. Download the source — either clone the repository or take the ZIP from
   [Releases](https://github.com/almuzahidseyam/google-photos-cleaner/releases). The
   repository keeps its original `google-photos-cleaner` slug so existing clones and
   links keep working; the extension itself is named **Bulk Trash for Google
   Photos**.
2. Open `chrome://extensions/`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the **`extension/`** folder — not the
   repository root.
5. Open or reload <https://photos.google.com/>.

Works in Chrome and other Chromium browsers that support Manifest V3 (Edge, Brave,
Opera). Not Firefox: it uses the `chrome.*` MV3 APIs directly.

## Use

1. Open the **main Photos grid** — not an album, not Search, not Trash — and wait
   for thumbnails to appear. Google Photos must be **in English**: the check that
   refuses permanent-deletion dialogs reads their wording, so on any other interface
   language the extension stops rather than run half-blind.
2. Click the extension icon.
3. Press **1. Test safely**. It selects a single item, opens the real Trash
   confirmation dialog, verifies that a safe confirmation button exists, then
   dismisses the dialog and clears the selection. Nothing is deleted.
4. Only once that test passes does **2. Move all to Trash** become available. Press
   it twice — the first click arms it, the second starts the run, and it disarms
   itself after six seconds if you change your mind.

Leave the tab open and do not click inside the gallery while it runs; the extension
is competing with you for the same selection state. **Pause / Resume** and **Stop**
both take effect at the next safe step rather than mid-dialog.

Closing the popup does not stop the run. Progress is kept by the service worker, so
reopening the popup shows the live counters again.

## Settings

Open **Settings** in the popup.

**Dry run** walks the entire path — select a batch, find the Trash button, open the
dialog, verify the confirmation — and then dismisses instead of confirming. It
reports how many items the first batch *would* have moved and stops there. This is
the honest way to check the extension against today's Google Photos build, and it
is not gated on the manual test because it cannot delete anything.

**Batch size** (50–500) is how many items are selected before each Trash
confirmation. 500 is fastest; drop it if selection stalls or the tab struggles.

**Stop after** caps the number of batches, which is useful for a cautious first run
— set one batch, watch what happens, then remove the limit.

**Copy diagnostics** puts a read-only JSON snapshot on your clipboard describing
what the extension can currently see: how many media checkboxes it found, whether
the Trash button and the native selection counter were located, scroller geometry,
the language the page declares itself to be in, your browser language. Paste it into
an issue; it contains no photo content, no
filenames and no account identifiers.

## The honest limitation

Google Photos is a private web app. Its DOM is generated, its CSS class names are
obfuscated, and Google changes both without notice or obligation. **No extension that
drives that DOM can promise to keep working.**

What this project does about that is refuse to guess. Selectors are structural and
ARIA-based first — `[role="main"]`, `[role="checkbox"]`, `[data-delete-origin]`,
`[role="dialog"]` — with Google's class names used only as optional fast paths. When
the current page cannot be read with confidence, the run stops with a named error code
instead of clicking something that looked approximately right. The **Test safely** and
**Dry run** paths exist so you can confirm compatibility against today's build before
anything destructive is allowed.

`docs/SAFETY.md` lists every error code and what to do about it.
`docs/ARCHITECTURE.md` explains how the selection loop, the fail-closed rule and the
message flow actually work.

## Privacy

Nothing is collected and nothing is transmitted. There is no account, no analytics,
no remote code and no network request of any kind — the extension stores four values
locally (batch size, batch limit, the dry-run flag and the last run's status) and
reads only the structure of the Google Photos page in front of you. The diagnostics
snapshot you can copy for a bug report carries no photo data, no filenames and
nothing identifying your account. [docs/PRIVACY.md](docs/PRIVACY.md) states all of
it in full, permission by permission.

Not on the Chrome Web Store yet; [docs/STORE_LISTING.md](docs/STORE_LISTING.md)
holds the submission material for when it is.

## Development

No dependencies and no build step. The extension is plain ES2022 loaded directly by
Chrome.

```bash
npm test                     # 23 checks: manifest, packaging, popup markup, stubbed runtime, naming, licence and store material
python3 scripts/make-icons.py   # regenerate the icon set (needs Pillow)
```

`npm test` runs offline: it cross-checks `manifest.json` against `package.json` and
`CHANGELOG.md`, asserts every file the manifest references exists, verifies the popup
markup declares every id `popup.js` reaches for, confirms every `fail()` code has a
recovery hint in the UI and a row in `docs/SAFETY.md`, holds the extension name to
compatibility phrasing rather than a leading Google trademark, refuses a confirm
button chosen by position or count, loads both `content.js` and `background.js`
against a stubbed `chrome`/DOM to exercise ping, diagnostics, status handling and the
non-English refusal, and holds the licence headers and the store material against the
manifest they describe.

Each check was proven by reintroducing the bug it exists to catch and confirming the
suite goes red — see the mutation cases listed in `docs/ARCHITECTURE.md`.

```
extension/        the extension itself; this is what Load unpacked wants
  manifest.json   MV3 manifest, photos.google.com only
  content.js      the selection and Trash loop, fail-closed
  background.js   service worker; owns persisted status
  popup.*         the only consent surface
docs/             safety model, architecture notes, privacy policy, store material
scripts/          test suite and icon generator
```

## Disclaimer

Not affiliated with, endorsed by, or connected to Google. It automates a user
interface you already have access to, on an account you are already signed into.
Use it on your own library, understand that deletion is deletion once Trash is
emptied, and keep a verified backup. Provided as is, without warranty — see
[LICENSE](LICENSE).

## License

[MIT](LICENSE) © Muhammad Al-Muzahid
