/**
 * Popup: the only consent surface. It renders status, owns the settings, and arms
 * the destructive action behind a deliberate second click.
 *
 * `window.confirm` is deliberately not used — dialogs from an extension popup are
 * unreliable across Chrome versions, and an in-popup armed state is both visible
 * and cancellable.
 */
const $ = id => document.getElementById(id);

/** Recovery advice per error code thrown by content.js. Kept in sync with docs/SAFETY.md. */
const HINTS = {
  NOT_ON_PHOTOS: "Open https://photos.google.com/ in this tab.",
  ON_TRASH_VIEW: "Go back to the main Photos grid. Trash is deliberately out of scope.",
  NO_MEDIA_CHECKBOX: "Wait for thumbnails to render, then test again. Album, Search and Utilities views are not supported.",
  NO_SELECTION_MODE: "Reload the page, then test again.",
  NO_TRASH_BUTTON: "The toolbar could not be read. Copy diagnostics from Settings and open an issue.",
  NO_DIALOG: "The confirmation flow could not be read. Copy diagnostics from Settings and open an issue.",
  PERMANENT_DELETE_DIALOG: "Google offered permanent deletion, which this extension will not confirm. Handle those items by hand.",
  NO_CONFIRM_BUTTON: "The dialog buttons could not be read confidently. Try Chrome in English, or copy diagnostics and open an issue.",
  BATCH_TIMEOUT: "Google Photos stalled. Reload the page and start again — items already in Trash will not be picked twice.",
  ALREADY_RUNNING: "A run is already in progress. Press Stop first.",
  UNKNOWN: "Copy diagnostics from Settings and open an issue with them."
};

const ARM_TIMEOUT = 6000;

let tab = null;
let compatible = false;
let paused = false;
let running = false;
let startedAt = 0;
let dryRun = false;
let armTimer = null;

function pad(n) { return String(n).padStart(2, "0"); }

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function startLabel() {
  return dryRun ? "2. Dry run — delete nothing" : "2. Move all to Trash";
}

function disarm() {
  clearTimeout(armTimer);
  armTimer = null;
  $("start").dataset.armed = "";
  $("start").textContent = startLabel();
}

function render(s = {}) {
  const state = s.state || "idle";
  running = state === "running" || state === "testing";
  startedAt = state === "running" ? (s.startedAt || 0) : 0;

  $("state").textContent = state === "testing" ? "Testing…" :
    state === "running" ? (s.dryRun ? "Dry run…" : "Moving to Trash…") :
    state === "paused" ? "Paused" :
    state === "done" ? "Finished" :
    state === "error" ? "Stopped with an error" :
    state === "ready" ? "Test passed" : "Not tested";

  $("message").textContent = s.message || "Press Test first. It will not delete a photo.";
  $("selected").textContent = (s.selected || 0).toLocaleString();
  $("deleted").textContent = (s.dryRun ? (s.wouldTrash || 0) : (s.deleted || 0)).toLocaleString();
  $("batches").textContent = (s.batches || 0).toLocaleString();

  const hint = state === "error" ? HINTS[s.code] || HINTS.UNKNOWN : "";
  $("hint").textContent = hint;
  $("hint").hidden = !hint;

  compatible = s.compatible === true;
  // A dry run deletes nothing and runs its own compatibility check, so it is not
  // gated on a prior manual test. The destructive path always is.
  $("start").disabled = (!compatible && !dryRun) || running;
  $("test").disabled = running;
  $("pause").disabled = !(state === "running" || state === "paused");
  $("stop").disabled = !(state === "running" || state === "paused" || state === "testing");
  paused = state === "paused";
  if (running) disarm();
  tick();

  $("dot").className = "dot " + (
    state === "error" ? "bad" :
    state === "running" || state === "testing" || state === "paused" ? "work" :
    compatible || state === "done" ? "good" : "neutral"
  );
}

function tick() {
  $("elapsed").textContent = startedAt ? formatDuration(Date.now() - startedAt) : "";
}
setInterval(tick, 1000);

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function isPhotos(t) {
  try { return new URL(t?.url || "").hostname === "photos.google.com"; }
  catch { return false; }
}

/**
 * Content scripts declared in the manifest do not exist in tabs that were already
 * open when the extension was installed or reloaded, so ping first and inject on
 * demand rather than telling the user to reload.
 */
async function ensureContent() {
  if (!tab?.id) throw new Error("No active tab.");
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "GPC_PING" });
    return;
  } catch {}
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  await new Promise(r => setTimeout(r, 150));
}

async function send(type) {
  if (!isPhotos(tab)) {
    render({ state: "error", compatible: false, code: "NOT_ON_PHOTOS", message: "Open photos.google.com first." });
    return null;
  }
  try {
    await ensureContent();
    return await chrome.tabs.sendMessage(tab.id, { type });
  } catch {
    render({
      state: "error",
      compatible: false,
      code: "UNKNOWN",
      message: "Could not reach the Google Photos page. Reload the tab and try again."
    });
    return null;
  }
}

async function saveSettings() {
  const settings = {
    batchSize: Number($("batchSize").value),
    maxBatches: Number($("maxBatches").value),
    dryRun: $("dryRun").checked
  };
  dryRun = settings.dryRun;
  $("start").classList.toggle("dry", dryRun);
  disarm();
  await chrome.storage.local.set({ settings });
  // Toggling dry run changes whether the destructive gate applies, so re-render.
  const { status } = await chrome.storage.local.get("status");
  render(status || {});
  disarm();
}

async function loadSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  const s = { batchSize: 500, maxBatches: 0, dryRun: false, ...(settings || {}) };
  $("batchSize").value = String(s.batchSize);
  $("maxBatches").value = String(s.maxBatches);
  $("dryRun").checked = s.dryRun === true;
  dryRun = s.dryRun === true;
  $("start").classList.toggle("dry", dryRun);
  $("start").textContent = startLabel();
}

$("test").addEventListener("click", () => send("GPC_TEST"));

// Two-click consent gate: the first click arms, the second starts.
$("start").addEventListener("click", async () => {
  if (dryRun) {
    await send("GPC_START");
    return;
  }
  if ($("start").dataset.armed !== "1") {
    $("start").dataset.armed = "1";
    $("start").textContent = "Click again to confirm";
    armTimer = setTimeout(disarm, ARM_TIMEOUT);
    return;
  }
  disarm();
  await send("GPC_START");
});

$("pause").addEventListener("click", () => send(paused ? "GPC_RESUME" : "GPC_PAUSE"));
$("stop").addEventListener("click", () => send("GPC_STOP"));

for (const id of ["batchSize", "maxBatches", "dryRun"]) {
  $(id).addEventListener("change", saveSettings);
}

$("diagnose").addEventListener("click", async () => {
  const res = await send("GPC_DIAGNOSE");
  if (!res?.ok) return;
  const text = JSON.stringify(res.diagnostics, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    $("diagnose").textContent = "Copied to clipboard";
  } catch {
    console.log(text);
    $("diagnose").textContent = "Copy failed — see the popup console";
  }
  setTimeout(() => { $("diagnose").textContent = "Copy diagnostics"; }, 2500);
});

chrome.runtime.onMessage.addListener(msg => {
  if (msg?.type === "GPC_STATUS_BROADCAST") render(msg.payload);
});

(async () => {
  tab = await getActiveTab();
  $("page").textContent = isPhotos(tab)
    ? "Connected to photos.google.com" + new URL(tab.url).pathname
    : "Open photos.google.com first";
  await loadSettings();
  const { status } = await chrome.storage.local.get("status");
  render(status || {});
  if (!isPhotos(tab)) {
    $("start").disabled = true;
    $("test").disabled = true;
  }
})();
