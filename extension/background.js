/**
 * Service worker: the single owner of persisted status.
 *
 * The content script does the work but is destroyed on every navigation, and the
 * popup only exists while it is open. So progress is funnelled here, written to
 * chrome.storage.local, and re-broadcast for whatever popup happens to be open.
 * That is why closing the popup mid-run does not lose the counters.
 */
const DEFAULT_STATUS = {
  state: "idle",
  message: "Open Google Photos, then press Test.",
  code: null,
  selected: 0,
  deleted: 0,
  wouldTrash: 0,
  batches: 0,
  compatible: null,
  dryRun: false,
  startedAt: 0,
  updatedAt: Date.now()
};

const DEFAULT_SETTINGS = {
  batchSize: 500,
  maxBatches: 0,
  dryRun: false
};

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(["status", "settings"]);
  const seed = {};
  if (!stored.status) seed.status = DEFAULT_STATUS;
  seed.settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  await chrome.storage.local.set(seed);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GPC_STATUS") {
    const status = { ...DEFAULT_STATUS, ...message.payload, updatedAt: Date.now() };
    chrome.storage.local.set({ status });
    // Rejects when no popup is listening, which is the normal case.
    chrome.runtime.sendMessage({ type: "GPC_STATUS_BROADCAST", payload: status }).catch(() => {});
    sendResponse?.({ ok: true });
    return;
  }

  if (message?.type === "GPC_RESET") {
    const status = { ...DEFAULT_STATUS, updatedAt: Date.now() };
    chrome.storage.local.set({ status }).then(() => sendResponse?.({ ok: true, status }));
    return true;
  }
});
