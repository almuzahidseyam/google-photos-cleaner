# Chrome Web Store submission

Everything the dashboard asks for, written out so submission is copy-and-paste
rather than improvisation. Nothing here is marketing: if a sentence stops being
true of the code, change the code or change the sentence.

## Before you upload

1. Register a developer account at
   <https://chrome.google.com/webstore/devconsole> and pay the one-time **$5**
   registration fee. Set the publisher name — it appears under every item you
   publish — and verify the contact email, or the listing cannot go live.
2. Tag a release (`git tag v1.1.0 && git push origin v1.1.0`). CI zips
   `extension/` and attaches it to the release; upload **that** ZIP, so the
   published bytes match a commit you can point at.
3. The ZIP must contain the manifest at its root. Zipping the repository root
   instead of `extension/` is the one mistake that fails immediately.
4. Host the privacy policy at a URL you control. [docs/PRIVACY.md](PRIVACY.md)
   on GitHub is a public URL and is acceptable.

## Why the name is what it is

The extension is called **Bulk Trash for Google Photos**. Google's branding rules
do not allow a Google trademark to be *the* name of a third-party product, but
they do allow naming the product in plain text to state compatibility — the
"**for** Google Photos" construction. So the distinctive part comes first and the
trademark appears only as the thing being worked with. The earlier name led with
"Google Photos", which invited a rejection for implying association.

The icon follows the same reasoning: it is a bin with two tiles going into it, in
slate and amber. It deliberately does not reuse Google Photos' pinwheel, its
colour, or a photo-tile motif.

## Single purpose

> Bulk Trash for Google Photos has one purpose: to clear a Google Photos library
> the signed-in user owns, by driving the site's own multi-select and *Move to
> Trash* controls in batches. It does nothing else — no editing, no downloading,
> no organising, no other site.

The single-purpose policy is the one most likely to be tested here, so the
listing, the description and the screenshots must all describe that one thing.

## Permission justifications

Paste each into the matching box on the **Privacy practices** tab.

- **`host_permissions` — `https://photos.google.com/*`**: the extension's entire
  function is to operate the Google Photos interface. It matches no other origin
  and requests no broad host access.
- **`storage`**: persists four local values — batch size, batch limit, the
  dry-run flag, and the last run's status — so the popup can show progress after
  it is reopened. Nothing is transmitted.
- **`activeTab`**: the popup acts on the tab the user has open at the moment they
  press a button, which avoids standing access to their tabs.
- **`scripting`**: injects the content script into that tab when Chrome has not
  already loaded it, which happens after an update or a reload of the extension.
- **Remote code**: none. Every line executed ships inside the package.

## Data usage disclosure

Declare **no** collection for all categories — personally identifiable
information, health, financial, authentication, personal communications,
location, web history, and user activity. Then tick all three certifications:
the data is not sold to third parties, is not used or transferred for purposes
unrelated to the single purpose, and is not used to determine creditworthiness or
for lending.

Note that the disclosure is required even though nothing is transmitted:
Google's policy covers data handled *locally* too. The four keys stored locally
are listed in [PRIVACY.md](PRIVACY.md) — the four settings and status values are
not user data in Google's sense, but describing them is the honest answer if a
reviewer asks.

## Listing copy

- **Name**: Bulk Trash for Google Photos
- **Summary** (132 characters maximum; the manifest description is already within
  the limit and should stay identical to this box): Bulk Move-to-Trash helper for
  your own Google Photos library, gated behind a live compatibility test and an
  optional dry run.
- **Category**: Workflow & Planning
- **Language**: English
- **Detailed description**: adapt the README's *Why this exists*, *What it will
  do* and *What it will not do* sections. Keep the backup warning in the first
  screen of text — a user who reads only the top of the listing must still learn
  that a verified backup comes first.

## Screenshots

At least one, up to five, at **1280×800** or **640×400**, PNG or JPEG, no
transparency and no browser chrome cropped oddly. The set that describes the
extension honestly:

1. The popup at rest, before anything has run.
2. *Test safely* having passed, showing the compatibility line.
3. A dry run finished, showing the "would have trashed" count.
4. The armed destructive button reading **Click again to confirm**.
5. Settings open, showing batch size, the stop-after limit and the dry-run box.

A 128×128 store icon is required; `extension/icons/icon128.png` is it. The
440×280 small promotional tile is optional but is what appears in search results.

## Expect a question about automating Google Photos

The extension drives another company's interface, so a reviewer may ask whether
it is affiliated with Google or interferes with the site. Both answers are
already in the repository and should be repeated in the listing: it is **not
affiliated with, endorsed by, or connected to Google**, and it clicks only the
controls the signed-in owner can already click, on their own library. Review can
take days rather than hours, and a first submission is sometimes rejected for a
listing detail rather than for the code — read the rejection, fix the one thing,
resubmit.

## Charging for it is no longer a dashboard setting

There is no price field to fill in. Chrome Web Store payments were retired on
**1 February 2021**; the dashboard can only publish an item as free. Anything
paid in 2026 is billed outside the store by the developer, through a processor
such as ExtensionPay, Gumroad, LemonSqueezy or Paddle, with the extension itself
checking a licence.

That check is the problem, not the payment. A licence check is a network request,
so it would mean adding an outbound host permission and sending something — an
email address, a key, a device identifier — to a server. The moment that happens,
three statements in this repository stop being true: PRIVACY.md's "contacts no
server", the README's identical claim, and the two smoke checks that assert both.
A paid build is therefore not a pricing decision but a privacy-posture decision,
and it needs its own version, its own privacy policy, and its own data
disclosure on this tab.

The alternative that keeps the current posture intact is to publish free and ask
for payment where no code has to verify it — a sponsor or donate link in the
listing description and the README. It collects less money and nothing else
changes.

## After publishing

The Web Store version is whatever is in `extension/manifest.json`; it must
increase with every upload, and `npm test` already fails if the manifest and
`package.json` disagree. Keep the CHANGELOG entry and the Git tag in step with
each submission so a published build is always traceable to a commit.
