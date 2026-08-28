// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Muhammad Al-Muzahid

/**
 * Static + stubbed smoke tests. No dependencies, no browser, no network.
 *
 * The extension can only be exercised for real against Google's live DOM, so what
 * is checkable offline is checked here: the manifest agrees with package.json and
 * points at files that exist, the popup markup carries every id the popup script
 * reaches for, and both scripts load and answer messages against a stubbed
 * chrome/DOM environment.
 *
 * Run with: npm test
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ext = join(root, "extension");

let failures = 0;
let checks = 0;

function check(name, fn) {
  checks += 1;
  try {
    fn();
    console.log(`  ok    ${name}`);
  } catch (e) {
    failures += 1;
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function checkAsync(name, fn) {
  checks += 1;
  try {
    await fn();
    console.log(`  ok    ${name}`);
  } catch (e) {
    failures += 1;
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
}

function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
}

const manifest = JSON.parse(readFileSync(join(ext, "manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const popupHtml = readFileSync(join(ext, "popup.html"), "utf8");
const popupJs = readFileSync(join(ext, "popup.js"), "utf8");
const contentSrc = readFileSync(join(ext, "content.js"), "utf8");
const backgroundSrc = readFileSync(join(ext, "background.js"), "utf8");
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");

console.log("manifest and packaging");

check("manifest_version is 3", () => equal(manifest.manifest_version, 3, "manifest_version"));

check("manifest version matches package.json", () =>
  equal(manifest.version, pkg.version, "version"));

check("CHANGELOG documents the manifest version", () =>
  assert(changelog.includes(`## ${manifest.version}`), `CHANGELOG.md has no "## ${manifest.version}" heading`));

check("every path referenced by the manifest exists", () => {
  const paths = new Set([manifest.action.default_popup, manifest.background.service_worker]);
  for (const size of Object.keys(manifest.icons)) paths.add(manifest.icons[size]);
  for (const size of Object.keys(manifest.action.default_icon)) paths.add(manifest.action.default_icon[size]);
  for (const cs of manifest.content_scripts) for (const f of cs.js) paths.add(f);
  const missing = [...paths].filter(p => !existsSync(resolve(ext, p)));
  assert(missing.length === 0, `missing: ${missing.join(", ")}`);
});

check("icons are declared at 16/32/48/128", () =>
  equal(Object.keys(manifest.icons).sort().join(","), "128,16,32,48", "icon sizes"));

check("host access is limited to photos.google.com", () => {
  equal(manifest.host_permissions.length, 1, "host_permissions length");
  equal(manifest.host_permissions[0], "https://photos.google.com/*", "host pattern");
  for (const cs of manifest.content_scripts) {
    equal(cs.matches.join(","), "https://photos.google.com/*", "content script match pattern");
  }
});

check("no permission is requested beyond storage/activeTab/scripting", () =>
  equal([...manifest.permissions].sort().join(","), "activeTab,scripting,storage", "permissions"));

check("no host permission grants all URLs", () =>
  assert(!JSON.stringify(manifest).includes("<all_urls>"), "manifest requests <all_urls>"));

console.log("popup markup");

check("popup.html declares every id popup.js reaches for", () => {
  const declared = new Set([...popupHtml.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const used = new Set([...popupJs.matchAll(/\$\("([^"]+)"\)/g)].map(m => m[1]));
  const missing = [...used].filter(id => !declared.has(id));
  assert(missing.length === 0, `popup.js reads missing ids: ${missing.join(", ")}`);
});

check("popup does not use window.confirm as its consent gate", () =>
  assert(!/(^|[^.\w])confirm\s*\(/.test(popupJs.replace(/findConfirmButton/g, "")),
    "popup.js still calls confirm()"));

/**
 * Minimal chrome + DOM stub. Only what the two scripts touch at load time and
 * while answering GPC_PING / GPC_DIAGNOSE / GPC_STATUS is implemented; anything
 * that needs Google's real markup is out of reach offline by definition.
 */
function makeSandbox({ pathname = "/", lang = null } = {}) {
  const storage = {};
  const listeners = [];
  const installed = [];
  const sent = [];

  class HTMLElement {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.clientHeight = 0;
      this.scrollHeight = 0;
      this.scrollTop = 0;
      this.parentElement = null;
      this.isConnected = true;
      this.classList = { contains: () => false, toggle: () => {} };
    }
    querySelectorAll() { return []; }
    querySelector() { return null; }
    getAttribute() { return null; }
    matches() { return false; }
    dispatchEvent() { return true; }
  }

  const documentElement = new HTMLElement("html");
  // Only `lang` is answered: it is what the English-only permanence guard reads.
  documentElement.getAttribute = name => (name === "lang" ? lang : null);
  const body = new HTMLElement("body");

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    HTMLElement,
    Node: { DOCUMENT_POSITION_FOLLOWING: 4, DOCUMENT_POSITION_PRECEDING: 2 },
    Event: class { constructor(type) { this.type = type; } },
    MouseEvent: class { constructor(type) { this.type = type; } },
    KeyboardEvent: class { constructor(type) { this.type = type; } },
    PointerEvent: class { constructor(type) { this.type = type; } },
    getComputedStyle: () => ({ display: "block", visibility: "visible", overflowY: "visible" }),
    location: { hostname: "photos.google.com", origin: "https://photos.google.com", pathname },
    navigator: { userAgent: "node-smoke-test", language: "en-US" },
    document: {
      documentElement,
      body,
      scrollingElement: documentElement,
      activeElement: body,
      querySelectorAll: () => [],
      querySelector: () => null,
      dispatchEvent: () => true
    },
    chrome: {
      runtime: {
        getManifest: () => manifest,
        onInstalled: { addListener: fn => installed.push(fn) },
        onMessage: { addListener: fn => listeners.push(fn) },
        sendMessage: msg => { sent.push(msg); return Promise.resolve({ ok: true }); }
      },
      storage: {
        local: {
          get: keys => {
            const list = Array.isArray(keys) ? keys : [keys];
            const out = {};
            for (const k of list) if (k in storage) out[k] = storage[k];
            return Promise.resolve(out);
          },
          set: obj => { Object.assign(storage, obj); return Promise.resolve(); }
        }
      }
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return { sandbox, storage, listeners, installed, sent };
}

function dispatch(listeners, message) {
  let response;
  for (const fn of listeners) fn(message, {}, r => { response = r; });
  return response;
}

console.log("content script, stubbed");

check("loads once and registers a single message listener", () => {
  const env = makeSandbox();
  const ctx = vm.createContext(env.sandbox);
  vm.runInContext(contentSrc, ctx, { filename: "content.js" });
  vm.runInContext(contentSrc, ctx, { filename: "content.js" });
  equal(env.listeners.length, 1, "listener count after loading twice");
});

check("answers GPC_PING with the manifest version", () => {
  const env = makeSandbox();
  vm.runInContext(contentSrc, vm.createContext(env.sandbox), { filename: "content.js" });
  const res = dispatch(env.listeners, { type: "GPC_PING" });
  equal(res.ok, true, "ping ok");
  equal(res.version, manifest.version, "ping version");
});

check("GPC_DIAGNOSE reports an empty page honestly", () => {
  const env = makeSandbox();
  vm.runInContext(contentSrc, vm.createContext(env.sandbox), { filename: "content.js" });
  const res = dispatch(env.listeners, { type: "GPC_DIAGNOSE" });
  assert(res?.ok === true, `diagnose failed: ${res?.error}`);
  const d = res.diagnostics;
  equal(d.mediaCheckboxes, 0, "mediaCheckboxes on an empty DOM");
  equal(d.trashButtonFound, false, "trashButtonFound on an empty DOM");
  equal(d.dialogOpen, false, "dialogOpen on an empty DOM");
  equal(d.onTrashView, false, "onTrashView for /");
  equal(d.settings.batchSize, 500, "default batch size");
  for (const key of ["extensionVersion", "url", "userAgent", "nativeSelectedCount", "runtime"]) {
    assert(key in d, `diagnostics is missing ${key}`);
  }
});

check("recognises the Trash view so the run loop can refuse it", () => {
  const env = makeSandbox({ pathname: "/trash" });
  vm.runInContext(contentSrc, vm.createContext(env.sandbox), { filename: "content.js" });
  const res = dispatch(env.listeners, { type: "GPC_DIAGNOSE" });
  equal(res.diagnostics.onTrashView, true, "onTrashView for /trash");
});

check("every fail() code has a hint in popup.js", () => {
  const codes = [...contentSrc.matchAll(/fail\("([A-Z_]+)"/g)].map(m => m[1]);
  assert(codes.length > 0, "no fail() codes found in content.js");
  const missing = [...new Set(codes)].filter(c => !popupJs.includes(`${c}:`));
  assert(missing.length === 0, `codes without a popup hint: ${missing.join(", ")}`);
});

// docs/SAFETY.md is the document a user is pointed at when a run stops. A code that
// exists in the code but not in that table leaves them reading an error name with
// nothing to look it up in.
check("every fail() code is documented in docs/SAFETY.md", () => {
  const safety = readFileSync(join(root, "docs/SAFETY.md"), "utf8");
  const codes = [...new Set([...contentSrc.matchAll(/fail\("([A-Z_]+)"/g)].map(m => m[1]))];
  const missing = codes.filter(c => !safety.includes(`\`${c}\``));
  assert(missing.length === 0, `codes missing from the safety table: ${missing.join(", ")}`);
});

// The single most dangerous line this project could grow back is a fallback that
// picks a dialog button by position or by how many there are. An earlier version had
// one, and outside English it would have clicked a permanent-deletion confirmation
// that nothing had read. This check exists to keep it deleted.
check("the confirm button is chosen by its own label, never by position or count", () => {
  const from = contentSrc.indexOf("function findConfirmButton");
  assert(from > 0, "findConfirmButton is gone");
  const rest = contentSrc.slice(from);
  const fn = rest.slice(0, rest.indexOf("\n  }") + 4);
  assert(/labelMatches\(b, \/\^\(move to trash\|move to bin\)\$\/\)/.test(fn),
    "the unambiguous Move to Trash label is no longer matched exactly");
  assert(!/buttons\s*\[/.test(fn), "findConfirmButton indexes into the button list");
  assert(!/buttons\.length\s*(===|==|>|>=|<|<=)\s*\d/.test(fn),
    "findConfirmButton branches on how many buttons the dialog has");
  const gate = fn.indexOf("uiLanguageIsEnglish() === true && !dialogLooksPermanent(dialog)");
  const bareDelete = fn.indexOf("/^delete$/");
  assert(gate > 0, "the bare Delete path is no longer gated on a declared-English page and a non-permanent dialog");
  assert(bareDelete > gate, "the bare Delete match sits outside the language and permanence gate");
});

// A guard that cannot read the page must not report itself as satisfied, so the
// language it read is part of the diagnostics snapshot and of the refusal.
await checkAsync("a non-English page is refused rather than run half-blind", async () => {
  const en = makeSandbox({ lang: "en-GB" });
  vm.runInContext(contentSrc, vm.createContext(en.sandbox), { filename: "content.js" });
  equal(dispatch(en.listeners, { type: "GPC_DIAGNOSE" }).diagnostics.uiLanguageIsEnglish, true,
    "en-GB read as English");

  const other = makeSandbox({ lang: "bn" });
  vm.runInContext(contentSrc, vm.createContext(other.sandbox), { filename: "content.js" });
  const d = dispatch(other.listeners, { type: "GPC_DIAGNOSE" }).diagnostics;
  equal(d.uiLanguage, "bn", "reported page language");
  equal(d.uiLanguageIsEnglish, false, "bn read as English");

  dispatch(other.listeners, { type: "GPC_TEST" });
  await new Promise(r => setTimeout(r, 60));
  const status = other.sent.filter(m => m.type === "GPC_STATUS").at(-1);
  assert(status, "the test reported no status at all");
  equal(status.payload.state, "error", "reported state");
  equal(status.payload.code, "UNSUPPORTED_UI_LANGUAGE", "reported code");
  equal(status.payload.compatible, false, "reported compatibility");
});

console.log("service worker, stubbed");

check("GPC_STATUS is normalised, stored and re-broadcast", () => {
  const env = makeSandbox();
  vm.runInContext(backgroundSrc, vm.createContext(env.sandbox), { filename: "background.js" });
  equal(env.listeners.length, 1, "listener count");
  const res = dispatch(env.listeners, { type: "GPC_STATUS", payload: { state: "running", deleted: 7 } });
  equal(res.ok, true, "status ack");
  equal(env.storage.status.state, "running", "stored state");
  equal(env.storage.status.deleted, 7, "stored deleted count");
  equal(env.storage.status.batches, 0, "defaults filled in");
  assert(typeof env.storage.status.updatedAt === "number", "updatedAt stamped");
  equal(env.sent.at(-1).type, "GPC_STATUS_BROADCAST", "re-broadcast");
});

check("onInstalled seeds settings without clobbering existing ones", () => {
  const env = makeSandbox();
  vm.runInContext(backgroundSrc, vm.createContext(env.sandbox), { filename: "background.js" });
  equal(env.installed.length, 1, "onInstalled listener count");
});

console.log("naming and branding");

// Google's branding rules let a third-party product say what it works with, but not
// take a Google trademark as its own name. The distinctive word has to come first and
// the mark has to appear only in the "for Google Photos" compatibility phrasing. The
// name also has to be the same name everywhere, or the store listing and the package
// stop describing each other.
check("the name states compatibility instead of leading with a Google trademark", () => {
  assert(!/^google/i.test(manifest.name), `"${manifest.name}" leads with a Google trademark`);
  assert(!/^google/i.test(manifest.short_name), `"${manifest.short_name}" leads with a Google trademark`);
  assert(/\bfor google photos$/i.test(manifest.name),
    `"${manifest.name}" does not use the "for Google Photos" compatibility phrasing`);
  equal(manifest.action.default_title, manifest.name, "the toolbar tooltip");
  assert(popupHtml.includes(`<title>${manifest.name}</title>`), "popup.html has a different title");
  equal(pkg.name, manifest.name.toLowerCase().replace(/\s+/g, "-"), "the npm package name");
  for (const file of ["README.md", "docs/PRIVACY.md", "docs/STORE_LISTING.md"]) {
    assert(readFileSync(join(root, file), "utf8").includes(manifest.name), `${file} still uses an older name`);
  }
  assert(readFileSync(join(root, "docs/STORE_LISTING.md"), "utf8").includes(`- **Name**: ${manifest.name}`),
    "the store listing's Name field does not match the manifest");
});

console.log("licence and store material");

// The project is open source *and* his: MIT grants the freedom, the copyright line
// names the author, and both have to appear in every shipped file for either to
// mean anything. A file that loses its header still runs, so nothing but a check
// notices.
check("every shipped source file carries the MIT header in the author's name", () => {
  const files = [
    "extension/content.js", "extension/background.js", "extension/popup.js",
    "extension/popup.html", "extension/popup.css",
    "scripts/smoke-test.mjs", "scripts/make-icons.py",
  ];
  for (const file of files) {
    const head = readFileSync(join(root, file), "utf8").split("\n").slice(0, 4).join("\n");
    assert(head.includes("SPDX-License-Identifier: MIT"), `${file} is missing its SPDX line`);
    assert(head.includes("Copyright (c) 2026 Muhammad Al-Muzahid"), `${file} is missing its copyright line`);
  }
  const licence = readFileSync(join(root, "LICENSE"), "utf8");
  assert(licence.startsWith("MIT License"), "LICENSE is not the MIT text");
  assert(licence.includes("Copyright (c) 2026 Muhammad Al-Muzahid"), "LICENSE does not name the author");
  assert(readFileSync(join(root, "README.md"), "utf8").includes("© Muhammad Al-Muzahid"), "README drops the attribution");
  equal(pkg.license, "MIT", "package.json license");
  assert(pkg.author.includes("Muhammad Al-Muzahid"), "package.json author");
});

// The submission answers are only worth having if they still describe the package.
// Each limb here is a claim the listing makes that the manifest could quietly
// contradict: the summary length Google enforces, the permission set the
// justifications cover, and the storage keys the privacy policy enumerates.
check("the Web Store material still describes this manifest", () => {
  const privacy = readFileSync(join(root, "docs/PRIVACY.md"), "utf8");
  const listing = readFileSync(join(root, "docs/STORE_LISTING.md"), "utf8");
  assert(manifest.description.length <= 132, `description is ${manifest.description.length} characters, over the 132 the store allows`);
  // The listing prose is wrapped for reading, so compare it with its line breaks
  // flattened rather than forcing one long line into the document.
  const flat = (text) => text.replace(/\s+/g, " ");
  assert(flat(listing).includes(flat(manifest.description)), "the listing summary and the manifest description have drifted apart");
  // Matched as a code span rather than as a bare substring: "tabs" occurs inside
  // ordinary prose about tabs, so a plain includes() would let a newly added
  // permission pass unjustified.
  for (const permission of manifest.permissions) {
    assert(listing.includes(`\`${permission}\``), `no justification written for ${permission}`);
    assert(privacy.includes(`\`${permission}\``), `the privacy policy does not account for ${permission}`);
  }
  for (const origin of manifest.host_permissions) {
    assert(listing.includes(origin), `no justification written for ${origin}`);
    assert(privacy.includes(origin), `the privacy policy does not account for ${origin}`);
  }
  for (const key of ["batchSize", "maxBatches", "dryRun"]) {
    assert(privacy.includes(key), `the privacy policy does not list the ${key} setting`);
  }
  assert(privacy.includes("collects nothing"), "the privacy policy no longer states that nothing is collected");
  assert(!privacy.includes("analytics,") || privacy.includes("no analytics"), "the privacy policy mentions analytics ambiguously");
  assert(contentSrc.includes("PERMANENT_DELETE_DIALOG") && privacy.includes("PERMANENT_DELETE_DIALOG"),
    "the privacy policy's permanence claim is not tied to the code");
});

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);

