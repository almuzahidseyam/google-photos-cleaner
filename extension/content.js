/**
 * Content script: drives Google Photos' own selection and "Move to Trash" UI.
 *
 * Design rules, in priority order:
 *   1. Never invent a destructive action. Every deletion goes through the same
 *      button and the same confirmation dialog a human would click.
 *   2. Fail closed. If the current DOM cannot be recognised with confidence, stop
 *      with a named error code instead of guessing at a button.
 *   3. Refuse permanence. A dialog whose text reads as permanent deletion is
 *      dismissed, never confirmed. Emptying Trash is out of scope by design.
 *
 * Selectors are structural/ARIA first (`[role="main"]`, `[role="checkbox"]`,
 * `[data-delete-origin]`, `[role="dialog"]`) with Google's obfuscated class names
 * used only as optional fast paths, because those class names change without notice.
 */
(() => {
  if (globalThis.__GPC_CONTENT_LOADED__) return;
  globalThis.__GPC_CONTENT_LOADED__ = true;

  const DEFAULT_BATCH_SIZE = 500;
  const MIN_BATCH_SIZE = 10;
  const MAX_BATCH_SIZE = 500;
  const HARD_BATCH_CEILING = 1000;
  const WAIT_STEP = 80;
  const STEP_TIMEOUT = 12000;
  const DELETE_TIMEOUT = 90000;
  const STALL_LIMIT = 6;

  const DEFAULT_SETTINGS = {
    batchSize: DEFAULT_BATCH_SIZE,
    maxBatches: 0, // 0 means "until the view is empty", capped by HARD_BATCH_CEILING
    dryRun: false
  };

  const state = {
    running: false,
    paused: false,
    stopped: false,
    compatible: null,
    dryRun: false,
    selected: 0,
    deleted: 0,
    wouldTrash: 0,
    batches: 0,
    startedAt: 0,
    settings: { ...DEFAULT_SETTINGS }
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

  /** Throws an Error carrying a stable `code`, so the UI and the docs can agree. */
  function fail(code, message) {
    const err = new Error(message);
    err.code = code;
    throw err;
  }

  function clampInt(value, min, max, fallback) {
    const n = Math.trunc(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  async function loadSettings() {
    try {
      const { settings } = await chrome.storage.local.get("settings");
      const merged = { ...DEFAULT_SETTINGS, ...(settings || {}) };
      state.settings = {
        batchSize: clampInt(merged.batchSize, MIN_BATCH_SIZE, MAX_BATCH_SIZE, DEFAULT_BATCH_SIZE),
        maxBatches: clampInt(merged.maxBatches, 0, HARD_BATCH_CEILING, 0),
        dryRun: merged.dryRun === true
      };
    } catch {
      state.settings = { ...DEFAULT_SETTINGS };
    }
    return state.settings;
  }

  function report(statusName, message, extra = {}) {
    chrome.runtime.sendMessage({
      type: "GPC_STATUS",
      payload: {
        state: statusName,
        message,
        code: null,
        selected: state.selected,
        deleted: state.deleted,
        wouldTrash: state.wouldTrash,
        batches: state.batches,
        compatible: state.compatible,
        dryRun: state.dryRun,
        startedAt: state.startedAt,
        ...extra
      }
    }).catch(() => {});
  }


  async function waitFor(fn, timeout = STEP_TIMEOUT) {
    const end = Date.now() + timeout;
    while (Date.now() < end && !state.stopped) {
      try {
        const v = fn();
        if (v) return v;
      } catch {}
      await sleep(WAIT_STEP);
    }
    return null;
  }

  async function waitPaused() {
    while (state.paused && !state.stopped) await sleep(150);
  }

  function isOnTrashView() {
    const p = location.pathname.toLowerCase();
    return p.includes("/trash") || p.includes("/bin");
  }

  function isOnPhotos() {
    return location.hostname === "photos.google.com";
  }

  function textOf(el) {
    if (!el) return "";
    return norm([
      el.getAttribute?.("aria-label"),
      el.getAttribute?.("title"),
      el.getAttribute?.("data-tooltip"),
      el.getAttribute?.("data-tooltip-text"),
      el.textContent
    ].filter(Boolean).join(" "));
  }

  function enabled(el) {
    return !!el && el.isConnected && !el.disabled && el.getAttribute?.("aria-disabled") !== "true";
  }

  function isDialogVisible(el) {
    if (!el?.isConnected) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && r.width > 20 && r.height > 20;
  }

  function dialogs() {
    return [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(isDialogVisible);
  }

  function currentDialog() {
    const list = dialogs();
    return list[list.length - 1] || null;
  }

  function hasMediaNear(cb) {
    let n = cb;
    for (let i = 0; i < 10 && n; i++, n = n.parentElement) {
      if (n.matches?.('[role="dialog"], [role="alertdialog"]')) return false;
      if (n.querySelector?.("img, video")) return true;
    }
    return false;
  }

  function isMediaCheckbox(cb) {
    if (!enabled(cb)) return false;
    if (cb.getAttribute("role") !== "checkbox") return false;

    // Current Google Photos tile checkbox class when present. Do not require visibility:
    // Google often keeps the checkbox visually hidden until hover.
    if (cb.classList.contains("ckGgle")) return true;

    // Known date/header select-all control class should not be treated as an individual tile.
    if (cb.classList.contains("R4HkWb")) return false;

    const label = textOf(cb);
    if (/select all|select photos from|select all photos from/.test(label)) return false;
    if (/photo|video|image|screenshot|animation/.test(label)) return true;

    // Locale-agnostic structural fallback: checkbox lives inside/next to a media tile.
    return hasMediaNear(cb);
  }

  function chooseMain() {
    const mains = [...document.querySelectorAll('[role="main"]')];
    if (!mains.length) return document.body;

    let best = mains[0];
    let bestScore = -1;
    for (const main of mains) {
      const boxes = [...main.querySelectorAll('[role="checkbox"]')];
      const media = boxes.filter(isMediaCheckbox).length;
      const imgs = main.querySelectorAll("img, video").length;
      const score = media * 100 + boxes.length * 5 + Math.min(imgs, 100);
      if (score > bestScore) { best = main; bestScore = score; }
    }
    return best;
  }

  function mediaCheckboxes(root = chooseMain(), wantedState = null) {
    const all = [...root.querySelectorAll('[role="checkbox"]')].filter(isMediaCheckbox);
    const filtered = wantedState === null ? all : all.filter(cb => cb.getAttribute("aria-checked") === wantedState);
    return filtered.sort((a, b) => {
      if (a === b) return 0;
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }

  function findScroller(main = chooseMain()) {
    const candidates = [];
    let p = main;
    for (let i = 0; i < 8 && p; i++, p = p.parentElement) candidates.push(p);
    candidates.push(...main.querySelectorAll("div"));
    candidates.push(document.scrollingElement, document.documentElement, document.body);

    let best = document.scrollingElement || document.documentElement;
    let bestScore = -1;
    for (const el of candidates) {
      if (!(el instanceof HTMLElement)) continue;
      if (el.clientHeight < 250 || el.scrollHeight <= el.clientHeight + 100) continue;
      const st = getComputedStyle(el);
      const scrollish = /(auto|scroll|overlay)/.test(st.overflowY) || el === document.scrollingElement || el === document.documentElement || el === document.body;
      if (!scrollish) continue;
      const containsMain = el === main || el.contains(main) || main.contains(el);
      const score = (containsMain ? 1000000 : 0) + (el.scrollHeight - el.clientHeight);
      if (score > bestScore) { best = el; bestScore = score; }
    }
    return best;
  }

  function setScrollTop(scroller, top) {
    if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) {
      window.scrollTo(0, top);
    } else {
      scroller.scrollTop = top;
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    }
  }

  function scrollTopOf(scroller) {
    if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) return window.scrollY || document.documentElement.scrollTop || 0;
    return scroller.scrollTop;
  }

  function scrollHeightOf(scroller) {
    if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) return document.documentElement.scrollHeight;
    return scroller.scrollHeight;
  }

  function clientHeightOf(scroller) {
    if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) return window.innerHeight;
    return scroller.clientHeight;
  }

  function nativeSelectedCount() {
    const preferred = [
      ...document.querySelectorAll(".rtExYb"),
      ...document.querySelectorAll('[aria-live="polite"], [aria-live="assertive"]')
    ];
    for (const el of preferred) {
      const t = `${el.textContent || ""} ${el.getAttribute?.("aria-label") || ""}`;
      const m = t.replace(/[,\s](?=\d{3}\b)/g, "").match(/\d+/);
      if (!m) continue;
      const n = Number(m[0]);
      if (Number.isFinite(n) && n >= 0 && n <= 10000000) {
        // Prefer the known Google Photos counter. For generic aria-live, only trust selected-like text.
        if (el.classList?.contains("rtExYb") || /select/i.test(t)) return n;
      }
    }
    return mediaCheckboxes(chooseMain(), "true").length;
  }

  async function plainClick(el) {
    if (!enabled(el)) return false;
    try { el.scrollIntoView({ block: "center", inline: "nearest" }); } catch {}
    await sleep(30);
    try {
      el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      el.click();
      return true;
    } catch {
      return false;
    }
  }

  async function shiftClick(el) {
    if (!enabled(el)) return false;
    try { el.scrollIntoView({ block: "center", inline: "nearest" }); } catch {}
    await sleep(30);
    try {
      const opts = { bubbles: true, cancelable: true, composed: true, view: window, shiftKey: true };
      if (typeof PointerEvent === "function") {
        el.dispatchEvent(new PointerEvent("pointerdown", opts));
        el.dispatchEvent(new PointerEvent("pointerup", opts));
      }
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.dispatchEvent(new MouseEvent("click", opts));
      return true;
    } catch {
      return false;
    }
  }

  function findDeleteButton() {
    // Strongest current structural selector: Google adds data-delete-origin to the delete action area.
    const structural = document.querySelector('div[data-delete-origin] button, [data-delete-origin] button');
    if (enabled(structural)) return structural;

    const buttons = [...document.querySelectorAll("button")].filter(enabled);
    const exact = buttons.find(b => /^(move to trash|move to bin|trash|delete)$/i.test(textOf(b)));
    if (exact) return exact;
    return buttons.find(b => /move to trash|move to bin|trash|delete/i.test(textOf(b)) && !/album|shared|permanent|forever/i.test(textOf(b))) || null;
  }

  function dialogLooksPermanent(dialog) {
    const t = textOf(dialog);
    return /delete permanently|permanently delete|delete forever|permanent deletion|can't be restored|cannot be restored/.test(t);
  }

  function findConfirmButton(dialog) {
    if (!dialog) return null;
    const buttons = [...dialog.querySelectorAll("button")].filter(enabled);
    if (!buttons.length) return null;

    // English Google Photos UI (as in the user's screenshot) — safest explicit matches first.
    const preferred = buttons.find(b => /^(move to trash|move to bin|delete)$/i.test(textOf(b)));
    if (preferred) return preferred;

    // Structural fallback only if the dialog has the ordinary two-action Material layout.
    const textButtons = buttons.filter(b => textOf(b).length > 0);
    if (textButtons.length === 2 && !dialogLooksPermanent(dialog)) return textButtons[1];
    return null;
  }

  /**
   * Closes the open dialog without confirming. Prefers the dialog's own Cancel
   * button, because a synthetic Escape on `document` is not always honoured;
   * Escape is the fallback.
   */
  async function dismissDialog() {
    const dlg = currentDialog();
    if (dlg) {
      const buttons = [...dlg.querySelectorAll("button")].filter(enabled);
      const cancel = buttons.find(b => /^(cancel|no|not now|dismiss|close)$/i.test(textOf(b)));
      if (cancel) {
        await plainClick(cancel);
        if (await waitFor(() => !currentDialog(), 2500)) return true;
      }
    }
    for (const target of [document.activeElement, currentDialog(), document.body, document]) {
      if (!target?.dispatchEvent) continue;
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true }));
    }
    await sleep(250);
    return !!(await waitFor(() => !currentDialog(), 3000));
  }

  async function clearSelection() {
    for (let pass = 0; pass < 4; pass++) {
      const checked = mediaCheckboxes(chooseMain(), "true");
      if (!checked.length || nativeSelectedCount() === 0) return true;
      for (const cb of checked.slice(0, 30)) {
        if (cb.getAttribute("aria-checked") === "true") await plainClick(cb);
      }
      await sleep(200);
    }
    return nativeSelectedCount() === 0;
  }

  async function compatibilityTest(silent = false) {
    if (!isOnPhotos()) fail("NOT_ON_PHOTOS", "Open photos.google.com first.");
    if (isOnTrashView()) fail("ON_TRASH_VIEW", "Open the main Photos view, not Trash.");
    if (state.running && !silent) fail("ALREADY_RUNNING", "Deletion is already running.");

    if (!silent) report("testing", "Finding a real photo on the current Google Photos page…", { compatible: false });

    const main = chooseMain();
    let boxes = mediaCheckboxes(main, "false");
    if (!boxes.length) {
      // A fresh Google Photos grid may still be settling.
      boxes = await waitFor(() => {
        const b = mediaCheckboxes(chooseMain(), "false");
        return b.length ? b : null;
      }, 8000) || [];
    }
    if (!boxes.length) {
      fail("NO_MEDIA_CHECKBOX", "No photo/video tile checkbox was found. Open the main Photos page and wait for thumbnails to load.");
    }

    const cb = boxes[0];
    const before = nativeSelectedCount();
    await plainClick(cb);
    const selected = await waitFor(() => {
      const n = nativeSelectedCount();
      return (n > before || cb.getAttribute("aria-checked") === "true") ? Math.max(n, 1) : null;
    }, 5000);
    if (!selected) fail("NO_SELECTION_MODE", "Found a photo, but Google Photos did not enter selection mode.");

    const del = await waitFor(findDeleteButton, 5000);
    if (!del) {
      await clearSelection();
      fail("NO_TRASH_BUTTON", "Selection works, but the Move to Trash button could not be identified.");
    }

    await plainClick(del);
    const dlg = await waitFor(currentDialog, 6000);
    if (!dlg) {
      await clearSelection();
      fail("NO_DIALOG", "Move to Trash opened no recognizable confirmation dialog.");
    }
    if (dialogLooksPermanent(dlg)) {
      await dismissDialog();
      await clearSelection();
      fail("PERMANENT_DELETE_DIALOG", "Google is asking for permanent deletion. Empty or restore Trash manually before using this extension.");
    }

    const confirm = findConfirmButton(dlg);
    if (!confirm) {
      await dismissDialog();
      await clearSelection();
      fail("NO_CONFIRM_BUTTON", "Confirmation dialog was found, but its safe Move to Trash confirmation could not be verified.");
    }

    // Safe test: never click the destructive confirmation. Escape/cancel instead.
    await dismissDialog();
    await clearSelection();

    state.compatible = true;
    if (!silent) report("ready", "Test passed. This page can be selected and its Move to Trash dialog was verified without deleting anything.", { compatible: true });
    return true;
  }

  async function selectUpTo(target) {
    const main = chooseMain();
    const scroller = findScroller(main);
    let stalls = 0;
    let lastScroll = -1;
    let lastCount = nativeSelectedCount();

    while (!state.stopped) {
      await waitPaused();
      if (state.stopped) return 0;

      let count = nativeSelectedCount();
      state.selected = count;
      report(state.paused ? "paused" : "running", `Selecting batch… ${count}/${target}`);
      if (count >= target) return count;

      const unchecked = mediaCheckboxes(chooseMain(), "false");
      const remaining = target - count;
      let progressed = false;

      if (unchecked.length) {
        // O(1) range selection when possible: first normal click, last shift-click.
        const slice = unchecked.slice(0, Math.max(1, Math.min(unchecked.length, remaining)));
        const before = count;

        if (slice.length === 1) {
          await plainClick(slice[0]);
        } else {
          await plainClick(slice[0]);
          await sleep(40);
          await shiftClick(slice[slice.length - 1]);
        }

        await sleep(180);
        count = nativeSelectedCount();

        // If Google's shift-range handler did not react, fall back to individual tile clicks.
        if (count <= before + (slice.length > 1 ? 1 : 0)) {
          for (const cb of slice) {
            if (state.stopped) break;
            await waitPaused();
            if (cb.getAttribute("aria-checked") !== "true") {
              await plainClick(cb);
              await sleep(24);
            }
            if (nativeSelectedCount() >= target) break;
          }
          await sleep(120);
          count = nativeSelectedCount();
        }

        progressed = count > before;
      }

      state.selected = count;
      if (count >= target) return count;

      const beforeScroll = scrollTopOf(scroller);
      const step = Math.max(300, clientHeightOf(scroller) * 0.72);
      setScrollTop(scroller, beforeScroll + step);
      await sleep(550);
      const afterScroll = scrollTopOf(scroller);

      if (progressed || count > lastCount || afterScroll !== beforeScroll) stalls = 0;
      else stalls++;

      if (afterScroll === beforeScroll || afterScroll === lastScroll) stalls++;
      lastScroll = afterScroll;
      lastCount = count;

      const atBottom = afterScroll + clientHeightOf(scroller) >= scrollHeightOf(scroller) - 20;
      if (atBottom && stalls >= 2) return count;
      if (stalls >= STALL_LIMIT) return count;
    }
    return 0;
  }

  /**
   * Moves the current selection to Trash. In dry-run mode it walks the identical
   * path — find the button, open the dialog, verify the confirmation exists — and
   * then dismisses instead of confirming, so nothing is deleted.
   */
  async function deleteSelected({ dryRun = false } = {}) {
    const selectedBefore = nativeSelectedCount();
    if (selectedBefore <= 0) return 0;

    const del = await waitFor(findDeleteButton, 6000);
    if (!del) fail("NO_TRASH_BUTTON", "Move to Trash button disappeared after selection.");
    await plainClick(del);

    const dlg = await waitFor(currentDialog, 7000);
    if (!dlg) fail("NO_DIALOG", "Google Photos did not show the Trash confirmation dialog.");
    if (dialogLooksPermanent(dlg)) {
      await dismissDialog();
      fail("PERMANENT_DELETE_DIALOG", "Google requested permanent deletion. This extension refuses to confirm that action.");
    }

    const confirm = findConfirmButton(dlg);
    if (!confirm) {
      await dismissDialog();
      fail("NO_CONFIRM_BUTTON", "Could not safely verify the Move to Trash confirmation button.");
    }

    if (dryRun) {
      await dismissDialog();
      await clearSelection();
      return selectedBefore;
    }

    await plainClick(confirm);

    const settled = await waitFor(() => {
      const noDialog = !currentDialog();
      const count = nativeSelectedCount();
      return noDialog && count === 0;
    }, DELETE_TIMEOUT);

    if (!settled) {
      fail("BATCH_TIMEOUT", "Google Photos did not finish the deletion batch within 90 seconds. Stopped to avoid duplicate actions.");
    }
    return selectedBefore;
  }

  async function run() {
    if (state.running) return;
    state.running = true;
    state.paused = false;
    state.stopped = false;
    state.startedAt = Date.now();
    state.deleted = 0;
    state.wouldTrash = 0;
    state.batches = 0;
    state.selected = 0;

    try {
      const settings = await loadSettings();
      state.dryRun = settings.dryRun;
      const batchSize = settings.batchSize;
      const batchLimit = settings.maxBatches > 0
        ? Math.min(settings.maxBatches, HARD_BATCH_CEILING)
        : HARD_BATCH_CEILING;

      report("testing", state.dryRun
        ? "Dry run: checking the page before counting…"
        : "Quick safety check before deletion…", { compatible: false });
      await compatibilityTest(true);
      state.compatible = true;
      report("running", state.dryRun
        ? "Dry run started. Nothing will be deleted."
        : "Safety check passed. Starting from the top…", { compatible: true });

      const scroller = findScroller(chooseMain());
      setScrollTop(scroller, 0);
      await sleep(900);

      let emptyPasses = 0;
      while (!state.stopped && state.batches < batchLimit) {
        await waitPaused();
        if (state.stopped) break;

        // The view can change under us — a navigation into Trash must not be swept.
        if (!isOnPhotos()) fail("NOT_ON_PHOTOS", "The tab left photos.google.com. Stopped.");
        if (isOnTrashView()) fail("ON_TRASH_VIEW", "The tab navigated to Trash. Stopped without touching it.");

        const runScroller = findScroller(chooseMain());
        setScrollTop(runScroller, 0);
        await sleep(700);

        const selected = await selectUpTo(batchSize);
        state.selected = selected;

        if (selected <= 0) {
          emptyPasses++;
          if (emptyPasses >= 3) {
            report("done", state.dryRun
              ? `Dry run finished. Nothing was deleted.`
              : `Finished. ${state.deleted.toLocaleString()} items were moved to Trash.`,
              { selected: 0, compatible: true });
            state.running = false;
            return;
          }
          report("running", "No selectable photo found yet; waiting for the gallery to settle…");
          await sleep(1800);
          continue;
        }
        emptyPasses = 0;

        if (state.dryRun) {
          report("running", `Dry run: verifying the Trash dialog for ${selected.toLocaleString()} selected items…`);
          const counted = await deleteSelected({ dryRun: true });
          state.wouldTrash = counted;
          state.batches = 1;
          state.selected = 0;
          report("done",
            `Dry run passed. ${counted.toLocaleString()} items would have been moved to Trash in the first batch, and the confirmation dialog was verified. Nothing was deleted.`,
            { selected: 0, compatible: true });
          state.running = false;
          return;
        }

        report("running", `Moving ${selected.toLocaleString()} selected items to Trash…`);
        const moved = await deleteSelected({ dryRun: false });
        state.deleted += moved;
        state.batches += 1;
        state.selected = 0;
        report("running", `Batch ${state.batches}: ${moved.toLocaleString()} moved to Trash. Total: ${state.deleted.toLocaleString()}.`);
        await sleep(650);
      }

      if (state.stopped) {
        report("idle", `Stopped. ${state.deleted.toLocaleString()} items were moved to Trash.`, { selected: nativeSelectedCount(), compatible: true });
      } else {
        // Reaching the batch limit is a normal finish, not a failure.
        report("done",
          `Batch limit reached after ${state.batches} batches. ${state.deleted.toLocaleString()} items were moved to Trash. Press Start again to continue.`,
          { selected: 0, compatible: true });
      }
    } catch (e) {
      state.stopped = true;
      report("error", e?.message || String(e), { compatible: state.compatible === true, code: e?.code || "UNKNOWN" });
    } finally {
      state.running = false;
      state.paused = false;
    }
  }

  /** Read-only snapshot of what the current page looks like, for bug reports. */
  function diagnostics() {
    const main = chooseMain();
    const boxes = [...main.querySelectorAll('[role="checkbox"]')];
    const media = boxes.filter(isMediaCheckbox);
    const scroller = findScroller(main);
    const dlg = currentDialog();
    return {
      extensionVersion: chrome.runtime.getManifest?.().version || null,
      url: `${location.origin}${location.pathname}`,
      onTrashView: isOnTrashView(),
      userAgent: navigator.userAgent,
      language: navigator.language,
      mainRegions: document.querySelectorAll('[role="main"]').length,
      checkboxesInMain: boxes.length,
      mediaCheckboxes: media.length,
      checkedMediaCheckboxes: media.filter(cb => cb.getAttribute("aria-checked") === "true").length,
      fastPathClassPresent: media.some(cb => cb.classList.contains("ckGgle")),
      nativeSelectedCount: nativeSelectedCount(),
      nativeCounterFound: !!document.querySelector(".rtExYb"),
      trashButtonFound: !!findDeleteButton(),
      trashButtonStructural: !!document.querySelector('[data-delete-origin] button'),
      dialogOpen: !!dlg,
      dialogLooksPermanent: dlg ? dialogLooksPermanent(dlg) : null,
      scrollerIsDocument: scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body,
      scrollHeight: scrollHeightOf(scroller),
      clientHeight: clientHeightOf(scroller),
      settings: state.settings,
      runtime: {
        running: state.running,
        paused: state.paused,
        compatible: state.compatible,
        deleted: state.deleted,
        batches: state.batches
      }
    };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "GPC_PING") {
      sendResponse({ ok: true, version: chrome.runtime.getManifest?.().version || null });
      return;
    }

    if (msg?.type === "GPC_DIAGNOSE") {
      try {
        sendResponse({ ok: true, diagnostics: diagnostics() });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
      return;
    }

    if (msg?.type === "GPC_TEST") {
      (async () => {
        try {
          await loadSettings();
          state.dryRun = false;
          await compatibilityTest(false);
        } catch (e) {
          state.compatible = false;
          report("error", e?.message || String(e), { compatible: false, code: e?.code || "UNKNOWN" });
        }
      })();
      sendResponse?.({ ok: true });
      return;
    }

    if (msg?.type === "GPC_START") {
      run();
      sendResponse?.({ ok: true });
      return;
    }

    if (msg?.type === "GPC_PAUSE") {
      if (state.running) {
        state.paused = true;
        report("paused", "Paused. Press Pause / Resume again to continue.");
      }
      sendResponse?.({ ok: true });
      return;
    }

    if (msg?.type === "GPC_RESUME") {
      if (state.running) {
        state.paused = false;
        report("running", "Resumed.");
      }
      sendResponse?.({ ok: true });
      return;
    }

    if (msg?.type === "GPC_STOP") {
      state.stopped = true;
      state.paused = false;
      report("idle", "Stopping after the current safe UI step…", { compatible: state.compatible });
      sendResponse?.({ ok: true });
    }
  });
})();
