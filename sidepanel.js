// CleanMySocial — Unfriender : side panel
//
// The panel is the whole interface. On open it loads the entire friends list by
// itself — page after page, resuming where a previous session stopped and
// retrying on its own after a hiccup — keeps a local copy so the next open is
// instant, and drives the removal batch one friend at a time. Every Facebook
// call happens in the service worker; this file only decides what to ask for.

const SPEEDS = [
  { id: "slow", delayMs: 16000, emoji: "🐢", pro: false },
  { id: "normal", delayMs: 8000, emoji: "🚶", pro: false },
  { id: "fast", delayMs: 3000, emoji: "🐇", pro: true },
  { id: "ultra", delayMs: 1000, emoji: "🚀", pro: true }
];
const DEFAULT_SPEED = "slow";
const SETTINGS_STORAGE = "cms_unfriender_settings";
const CACHE_STORAGE = "cms_unfriender_friends_cache";
const CACHE_VERSION = 1;
const REVIEW_OPENED_KEY = "mass-unfriender-review-opened";
/** Pause between friend-list pages while loading. */
const LOAD_PAGE_DELAY = 900;
/** Backoff for a page that failed; the last value repeats until MAX_ATTEMPTS. */
const RETRY_DELAYS = [5000, 15000, 45000];
const MAX_ATTEMPTS = 6;
/** Rows put in the DOM at once — more are added as the list is scrolled. */
const RENDER_STEP = 200;
const FREE_EXPORT_LIMIT = 20;

const ui = {
  accessBadge: document.querySelector("#accessBadge"),
  connectCard: document.querySelector("#connectCard"),
  connectBadge: document.querySelector("#connectBadge"),
  sessionDot: document.querySelector("#sessionDot"),
  sessionTitle: document.querySelector("#sessionTitle"),
  refreshButton: document.querySelector("#refreshButton"),
  offlineView: document.querySelector("#offlineView"),
  openFacebookButton: document.querySelector("#openFacebookButton"),
  controlsView: document.querySelector("#controlsView"),
  breakageNotice: document.querySelector("#breakageNotice"),
  reportButton: document.querySelector("#reportButton"),
  reportStatus: document.querySelector("#reportStatus"),
  listStep: document.querySelector("#listStep"),
  listBadge: document.querySelector("#listBadge"),
  searchInput: document.querySelector("#searchInput"),
  filterChips: [...document.querySelectorAll("[data-filter]")],
  countShown: document.querySelector("#countShown"),
  countTotal: document.querySelector("#countTotal"),
  reloadButton: document.querySelector("#reloadButton"),
  exportButton: document.querySelector("#exportButton"),
  selectAllCheckbox: document.querySelector("#selectAllCheckbox"),
  loadingStrip: document.querySelector("#loadingStrip"),
  loadingText: document.querySelector("#loadingText"),
  friendList: document.querySelector("#friendList"),
  runStep: document.querySelector("#runStep"),
  runBadge: document.querySelector("#runBadge"),
  speedGrid: document.querySelector("#speedGrid"),
  speedHint: document.querySelector("#speedHint"),
  statusSpinner: document.querySelector("#statusSpinner"),
  statusReadyIcon: document.querySelector("#statusReadyIcon"),
  statusKicker: document.querySelector("#statusKicker"),
  statusMessage: document.querySelector("#statusMessage"),
  stopButton: document.querySelector("#stopButton"),
  runProgress: document.querySelector("#runProgress"),
  runCount: document.querySelector("#runCount"),
  runFill: document.querySelector("#runFill"),
  quotaCard: document.querySelector("#quotaCard"),
  quotaCount: document.querySelector("#quotaCount"),
  quotaFill: document.querySelector("#quotaFill"),
  upgradeButton: document.querySelector("#upgradeButton"),
  removeButton: document.querySelector("#removeButton"),
  confirmDialog: document.querySelector("#confirmDialog"),
  confirmTitle: document.querySelector("#confirmTitle"),
  confirmCheckbox: document.querySelector("#confirmCheckbox"),
  confirmRemoveButton: document.querySelector("#confirmRemoveButton"),
  upgradeDialog: document.querySelector("#upgradeDialog"),
  upgradeEyebrow: document.querySelector("#upgradeEyebrow"),
  upgradeTitle: document.querySelector("#upgradeTitle"),
  upgradeDescription: document.querySelector("#upgradeDescription"),
  purchaseButton: document.querySelector("#purchaseButton"),
  licenseInput: document.querySelector("#licenseInput"),
  unlockButton: document.querySelector("#unlockButton"),
  licenseMessage: document.querySelector("#licenseMessage"),
  reviewDialog: document.querySelector("#reviewDialog"),
  reviewDescription: document.querySelector('[data-i18n="reviewDescription"]'),
  reviewLaterButton: document.querySelector('#reviewDialog [value="later"]'),
  reviewButton: document.querySelector("#reviewButton"),
  extensionVersion: document.querySelector("#extensionVersion")
};

let loggedIn = null;
let userId = null;
let friends = [];
let selected = new Set();
let cursor = null;
let hasMore = true;
let loading = false;
/** Set to stop the load loop after the page in flight (reload, or a batch). */
let cancelLoad = false;
let running = false;
let stopRequested = false;
let speedId = DEFAULT_SPEED;
let search = "";
const filters = { mutual: false, nonMutual: false, noPhoto: false, sortAz: false };
let renderLimit = RENDER_STEP;
let access = { unlimited: false, used: 0, limit: 20, remaining: 20 };
let licensePoll = null;
let countdownTimer = null;
let reportedCode = null;
let reportSent = false;
// Keeps a failure message on screen: a re-render of the list must not quietly
// replace it with the ordinary "select friends" prompt.
let errorShown = false;
let cacheWriteTimer = null;

function t(key, substitutions) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

function localize() {
  document.documentElement.lang = chrome.i18n.getUILanguage().split("-")[0];
  document.querySelectorAll("[data-i18n]").forEach(element => {
    const message = t(element.dataset.i18n);
    if (message) element.textContent = message;
  });
  document.querySelectorAll("[data-i18n-aria]").forEach(element => {
    const message = t(element.dataset.i18nAria);
    if (message) element.setAttribute("aria-label", message);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(element => {
    const message = t(element.dataset.i18nPlaceholder);
    if (message) element.setAttribute("placeholder", message);
  });
}

function send(message) {
  return chrome.runtime.sendMessage(message).catch(() => null);
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function setStep(element, mode) {
  element.classList.remove("step-disabled", "step-active", "step-done");
  element.classList.add(`step-${mode}`);
}

function speedById(id) {
  return SPEEDS.find(speed => speed.id === id) || SPEEDS[0];
}

// A locked speed must never be the one a batch runs at, even if a licence
// lapsed after it was chosen.
function activeSpeed() {
  const speed = speedById(speedId);
  return speed.pro && !access.unlimited ? speedById(DEFAULT_SPEED) : speed;
}

/* ------------------------------------------------------------------ status */

function setStatus(kicker, message, { busy = false } = {}) {
  ui.statusKicker.textContent = kicker;
  ui.statusMessage.textContent = message;
  ui.statusSpinner.hidden = !busy;
  ui.statusReadyIcon.hidden = busy;
}

function stopCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
}

// Resolves after `ms`, showing a live countdown, and returns early on Stop.
function waitWithCountdown(ms, label) {
  stopCountdown();
  const until = Date.now() + ms;
  return new Promise(resolve => {
    const tick = () => {
      const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setStatus(label, t("nextInSeconds", [String(left)]), { busy: true });
      if (stopRequested || left <= 0) {
        stopCountdown();
        resolve();
      }
    };
    tick();
    countdownTimer = setInterval(tick, 250);
  });
}

/* --------------------------------------------------------- the local copy */

// The list is kept on this device so reopening the panel does not mean pulling
// thousands of friends from Facebook again. It is keyed to the signed-in
// account, so another profile never sees this one's list.
async function readCache() {
  const stored = await chrome.storage.local.get(CACHE_STORAGE).catch(() => ({}));
  const cache = stored[CACHE_STORAGE];
  if (!cache || cache.version !== CACHE_VERSION || cache.userId !== userId) return null;
  if (!Array.isArray(cache.friends)) return null;
  return cache;
}

function writeCache() {
  if (cacheWriteTimer) clearTimeout(cacheWriteTimer);
  cacheWriteTimer = setTimeout(() => {
    cacheWriteTimer = null;
    chrome.storage.local
      .set({
        [CACHE_STORAGE]: {
          version: CACHE_VERSION,
          userId,
          friends,
          cursor,
          hasMore,
          updatedAt: Date.now()
        }
      })
      .catch(() => {});
  }, 400);
}

function clearCache() {
  if (cacheWriteTimer) clearTimeout(cacheWriteTimer);
  cacheWriteTimer = null;
  return chrome.storage.local.remove(CACHE_STORAGE).catch(() => {});
}

/* ------------------------------------------------------------- friend list */

/** Facebook's own card line — "12 mutual friends" — is the only mutual signal
 * this query returns, and it arrives already translated. A digit in it is
 * therefore what "has mutual friends" has to mean. */
function hasMutual(friend) {
  return /\p{Nd}/u.test(friend.meta || "");
}

function visibleFriends() {
  let list = friends;
  if (search) list = list.filter(friend => friend.name.toLocaleLowerCase().includes(search));
  if (filters.mutual) list = list.filter(hasMutual);
  if (filters.nonMutual) list = list.filter(friend => !hasMutual(friend));
  if (filters.noPhoto) list = list.filter(friend => !friend.avatar);
  if (filters.sortAz) list = [...list].sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

function friendRow(friend) {
  const row = document.createElement("label");
  row.className = selected.has(friend.id) ? "friend-row selected" : "friend-row";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = selected.has(friend.id);
  checkbox.disabled = running;
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) selected.add(friend.id);
    else selected.delete(friend.id);
    row.classList.toggle("selected", checkbox.checked);
    renderMeta();
    renderSelection();
  });

  const avatar = document.createElement("img");
  avatar.className = "friend-avatar";
  avatar.width = 32;
  avatar.height = 32;
  avatar.alt = "";
  avatar.loading = "lazy";
  if (friend.avatar) avatar.src = friend.avatar;

  const copy = document.createElement("span");
  copy.className = "friend-copy";
  const name = document.createElement("strong");
  name.textContent = friend.name;
  const meta = document.createElement("span");
  meta.textContent = friend.meta || friend.handle || "";
  copy.append(name, meta);

  row.append(checkbox, avatar, copy);
  return row;
}

function renderList() {
  const list = visibleFriends();
  ui.friendList.textContent = "";

  if (!list.length) {
    const empty = document.createElement("p");
    empty.className = "list-empty";
    empty.textContent = loading
      ? t("loadingFriends")
      : search || filters.mutual || filters.nonMutual || filters.noPhoto
        ? t("noMatches")
        : t("noFriendsLoaded");
    ui.friendList.append(empty);
  } else {
    const shown = list.slice(0, renderLimit);
    const fragment = document.createDocumentFragment();
    for (const friend of shown) fragment.append(friendRow(friend));
    if (list.length > shown.length) {
      const more = document.createElement("p");
      more.className = "list-empty";
      more.textContent = t("scrollForMore", [String(list.length - shown.length)]);
      fragment.append(more);
    }
    ui.friendList.append(fragment);
  }

  renderMeta();
  renderSelection();
}

// Growing the DOM on scroll keeps a 3000-friend list responsive without giving
// up access to the rows further down.
ui.friendList.addEventListener("scroll", () => {
  const { scrollTop, clientHeight, scrollHeight } = ui.friendList;
  if (scrollHeight - scrollTop - clientHeight > 120) return;
  if (renderLimit >= visibleFriends().length) return;
  renderLimit += RENDER_STEP;
  renderList();
});

function renderMeta() {
  const list = visibleFriends();
  ui.countShown.textContent = String(list.length);
  ui.countTotal.textContent = String(friends.length);

  const allSelected = list.length > 0 && list.every(friend => selected.has(friend.id));
  const someSelected = list.some(friend => selected.has(friend.id));
  ui.selectAllCheckbox.checked = allSelected;
  ui.selectAllCheckbox.indeterminate = !allSelected && someSelected;
  ui.selectAllCheckbox.disabled = running || !list.length;

  ui.exportButton.disabled = running || selected.size === 0;
  ui.reloadButton.disabled = running;
  for (const chip of ui.filterChips) chip.disabled = running;
  ui.searchInput.disabled = running;

  ui.loadingStrip.hidden = !loading;
  ui.listBadge.className = loading ? "step-badge" : hasMore ? "step-badge waiting" : "step-badge ok";
  ui.listBadge.textContent = loading
    ? t("loading")
    : hasMore
      ? t("paused")
      : t("listLoaded", [String(friends.length)]);
  setStep(ui.listStep, friends.length ? "done" : "active");
}

function renderSelection() {
  const count = selected.size;
  ui.removeButton.disabled = running || count === 0;
  if (running || errorShown) return;
  if (count > 0) {
    setStep(ui.runStep, "active");
    ui.runBadge.className = "step-badge";
    ui.runBadge.textContent = t("readyBadge");
    setStatus(t("ready"), t("willRemoveCount", [String(count)]));
  } else {
    setStep(ui.runStep, "disabled");
    ui.runBadge.className = "step-badge waiting";
    ui.runBadge.textContent = t("waiting");
    setStatus(t("ready"), t("selectToStart"));
  }
}

/* -------------------------------------------------------------- load pages */

function describeError(reason) {
  if (reason === "not_logged_in") return t("errorNotLoggedIn");
  if (reason === "missing_token") return t("errorNoToken");
  return t("errorFacebookChanged");
}

/**
 * Which reported failure a technical reason belongs to, or null when it is
 * something the user can fix themselves (like being signed out) and there is
 * nothing for the developer to hear about.
 */
function breakageCode(reason) {
  const text = String(reason || "");
  if (!text || text === "not_logged_in" || text === "missing_token") return null;
  if (text === "no_friend_list") return "no_friend_list";
  if (text.startsWith("bad_response")) return "bad_response";
  if (text === "unexpected_response" || text === "still_friends") return "action_rejected";
  return "graphql_error";
}

function showBreakage(code) {
  reportedCode = code;
  errorShown = true;
  ui.breakageNotice.hidden = false;
  ui.reportButton.hidden = reportSent;
  ui.reportStatus.textContent = reportSent ? t("reportSent") : "";
  ui.reportStatus.className = reportSent ? "report-status success" : "report-status";
}

function hideBreakage() {
  reportedCode = null;
  errorShown = false;
  ui.breakageNotice.hidden = true;
}

/**
 * Pull the whole friends list, page by page, without being asked. A failed page
 * is retried on a growing delay rather than dropped, and `cursor` always points
 * at the next page, so a load cut short by a closed panel, a lost connection or
 * a removal batch simply carries on from there next time.
 */
async function loadFriends() {
  if (loading || !hasMore || !loggedIn) return;
  loading = true;
  cancelLoad = false;
  let attempts = 0;

  ui.loadingText.textContent = t("loadingCount", [String(friends.length)]);
  renderMeta();

  try {
    while (hasMore && !cancelLoad) {
      const response = await send({ type: "LOAD_FRIENDS", cursor });

      if (!response?.ok) {
        const reason = response?.error || "load_failed";
        if (reason === "not_logged_in") {
          loggedIn = false;
          errorShown = true;
          setStatus(t("error"), describeError(reason));
          renderSession();
          return;
        }
        attempts += 1;
        if (attempts >= MAX_ATTEMPTS) {
          errorShown = true;
          setStatus(t("error"), describeError(reason));
          const code = breakageCode(reason);
          if (code) showBreakage(code);
          return;
        }
        // Keep what is already loaded on screen and try again shortly; most of
        // these are a rate limit or a dropped connection, not a dead end.
        const delay = RETRY_DELAYS[Math.min(attempts - 1, RETRY_DELAYS.length - 1)];
        const until = Date.now() + delay;
        while (Date.now() < until && !cancelLoad) {
          const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
          ui.loadingText.textContent = t("retryingIn", [String(left)]);
          await wait(250);
        }
        continue;
      }

      attempts = 0;
      hideBreakage();
      const known = new Set(friends.map(friend => friend.id));
      for (const friend of response.friends) {
        if (known.has(friend.id)) continue;
        known.add(friend.id);
        friends.push(friend);
      }
      cursor = response.endCursor;
      hasMore = response.hasNext;
      writeCache();

      ui.loadingText.textContent = t("loadingCount", [String(friends.length)]);
      renderList();
      if (hasMore && !cancelLoad) await wait(LOAD_PAGE_DELAY);
    }
  } finally {
    loading = false;
    renderList();
  }
}

/** Throw the local copy away and pull the list again from scratch. */
async function reload() {
  if (running) return;
  cancelLoad = true;
  ui.reloadButton.classList.add("spinning");
  await clearCache();
  friends = [];
  selected = new Set();
  cursor = null;
  hasMore = true;
  renderLimit = RENDER_STEP;
  hideBreakage();
  renderList();
  // Let a page still in flight finish before the fresh loop starts.
  while (loading) await wait(120);
  ui.reloadButton.classList.remove("spinning");
  await loadFriends();
}

/* ------------------------------------------------------------------ export */

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function exportCsv() {
  // Whatever is ticked, in the order the list is currently sorted — including
  // picks the active filter happens to be hiding.
  const ordered = filters.sortAz ? [...friends].sort((a, b) => a.name.localeCompare(b.name)) : friends;
  const rows = ordered.filter(friend => selected.has(friend.id));
  if (!rows.length) return;
  // Over the free allowance the upgrade prompt answers for itself.
  if (!access.unlimited && rows.length > FREE_EXPORT_LIMIT) {
    openUpgrade(false);
    return;
  }

  const header = [t("csvName"), t("csvProfile"), t("csvDetails"), t("csvHasPhoto")];
  const body = rows.map(friend =>
    [friend.name, friend.url, friend.meta || "", friend.avatar ? t("yes") : t("no")]
      .map(csvCell)
      .join(",")
  );
  // The BOM is what makes Excel read the accents in a friend's name correctly.
  const csv = `﻿${[header.map(csvCell).join(","), ...body].join("\r\n")}\r\n`;

  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `facebook-friends-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ------------------------------------------------------------------ speeds */

function renderSpeeds() {
  ui.speedGrid.textContent = "";
  const current = activeSpeed().id;
  for (const speed of SPEEDS) {
    const locked = speed.pro && !access.unlimited;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `speed-option${speed.id === current ? " active" : ""}${locked ? " locked" : ""}`;
    button.disabled = running;
    if (locked) button.title = t("speedLockedHint");

    const emoji = document.createElement("span");
    emoji.className = "speed-emoji";
    emoji.textContent = speed.emoji;
    const name = document.createElement("span");
    name.className = "speed-name";
    name.textContent = t(`speed_${speed.id}`);
    const pace = document.createElement("span");
    pace.className = "speed-pace";
    pace.textContent = locked ? "🔒" : t("secondsEach", [String(speed.delayMs / 1000)]);

    button.append(emoji, name, pace);
    button.addEventListener("click", () => {
      if (locked) {
        openUpgrade(false);
        return;
      }
      speedId = speed.id;
      chrome.storage.local.set({ [SETTINGS_STORAGE]: { speed: speedId } });
      renderSpeeds();
    });
    ui.speedGrid.append(button);
  }
  ui.speedHint.textContent = access.unlimited ? t("speedHintPaid") : t("speedHintFree");
}

/* ----------------------------------------------------------------- licence */

function renderAccess() {
  const limit = access.limit || 20;
  const used = Math.min(limit, Math.max(0, access.used || 0));
  ui.accessBadge.textContent = access.unlimited ? t("unlimitedBadge") : t("getUnlimited");
  ui.accessBadge.classList.toggle("unlimited", access.unlimited);
  ui.accessBadge.disabled = access.unlimited;
  ui.quotaCard.hidden = access.unlimited;
  ui.quotaCount.textContent = `${used}/${limit}`;
  ui.quotaFill.style.width = `${Math.min(100, (used / limit) * 100)}%`;
  ui.quotaCard.classList.toggle("limit", used >= limit);
  renderSpeeds();
}

async function refreshAccess(force = false, licenseKey) {
  const response = await send({
    type: force ? "CHECK_LICENSE" : "GET_ACCESS_STATE",
    licenseKey
  });
  if (response?.ok && response.access) {
    access = response.access;
    renderAccess();
  }
  return access;
}

function openUpgrade(limitReached) {
  if (access.unlimited) return;
  ui.upgradeEyebrow.textContent = limitReached ? t("freePlanLimit") : t("upgradeEyebrow");
  ui.upgradeTitle.textContent = limitReached ? t("dailyLimitTitle") : t("upgradeTitle");
  ui.upgradeDescription.textContent = limitReached
    ? t("dailyLimitDescription")
    : t("upgradeDescription");
  ui.licenseMessage.textContent = "";
  ui.licenseMessage.className = "license-message";
  if (!ui.upgradeDialog.open) ui.upgradeDialog.showModal();
}

function startLicensePolling() {
  if (licensePoll) return;
  licensePoll = setInterval(async () => {
    const state = await refreshAccess(true);
    if (!state.unlimited) return;
    clearInterval(licensePoll);
    licensePoll = null;
    ui.licenseMessage.textContent = t("licenseActivated");
    ui.licenseMessage.className = "license-message success";
    setTimeout(() => ui.upgradeDialog.open && ui.upgradeDialog.close(), 700);
  }, 4000);
}

/* ------------------------------------------------------------- the removal */

function renderRunProgress(processed, total) {
  ui.runProgress.hidden = !total;
  ui.runCount.textContent = `${processed}/${total}`;
  ui.runFill.style.width = `${total ? Math.min(100, (processed / total) * 100) : 0}%`;
}

async function confirmRemoval(count) {
  ui.confirmTitle.textContent = t("confirmTitleCount", [String(count)]);
  ui.confirmCheckbox.checked = false;
  ui.confirmRemoveButton.disabled = true;
  ui.confirmDialog.showModal();
  const result = await new Promise(resolve => {
    ui.confirmDialog.addEventListener("close", () => resolve(ui.confirmDialog.returnValue), {
      once: true
    });
  });
  return result === "confirm";
}

async function runRemoval() {
  if (running || !selected.size) return;

  const state = await refreshAccess();
  if (!state.unlimited && state.remaining <= 0) {
    openUpgrade(true);
    return;
  }

  const batch = friends.filter(friend => selected.has(friend.id));
  if (!(await confirmRemoval(batch.length))) return;

  // Loading and removing at once would be two streams of requests into the same
  // rate limit; the load resumes by itself when the batch is done.
  cancelLoad = true;
  while (loading) await wait(120);

  running = true;
  stopRequested = false;
  errorShown = false;
  ui.stopButton.hidden = false;
  renderSpeeds();
  renderList();

  setStep(ui.runStep, "active");
  ui.runBadge.className = "step-badge";
  ui.runBadge.textContent = t("working");

  const speed = activeSpeed();
  let processed = 0;
  let failed = 0;
  let limitReached = false;
  let failureCode = null;

  renderRunProgress(0, batch.length);

  for (const friend of batch) {
    if (stopRequested) break;
    setStatus(t("working"), t("removingName", [friend.name]), { busy: true });

    const response = await send({ type: "UNFRIEND", friend });
    if (response?.access) {
      access = response.access;
      renderAccess();
    }

    if (response?.status === "limit") {
      limitReached = true;
      break;
    }
    if (response?.status === "success") {
      processed += 1;
      selected.delete(friend.id);
      friends = friends.filter(item => item.id !== friend.id);
      writeCache();
      renderList();
    } else {
      failed += 1;
      failureCode = breakageCode(response?.message) || failureCode;
      if (response?.message === "not_logged_in" || response?.message === "missing_token") {
        setStatus(t("error"), describeError(response.message));
        break;
      }
    }

    renderRunProgress(processed + failed, batch.length);
    const last = friend === batch[batch.length - 1];
    if (!last && !stopRequested) await waitWithCountdown(speed.delayMs, t("working"));
  }

  stopCountdown();
  running = false;
  stopRequested = false;
  ui.stopButton.hidden = true;
  renderSpeeds();
  renderList();

  // Failures Facebook itself refused are worth telling the developer about;
  // ones the user can fix are not.
  if (failureCode) showBreakage(failureCode);

  if (limitReached) {
    ui.runBadge.className = "step-badge waiting";
    ui.runBadge.textContent = t("freePlanLimit");
    setStatus(t("freePlanLimit"), t("limitStoppedBatch", [String(processed)]));
    openUpgrade(true);
  } else {
    ui.runBadge.className = failed ? "step-badge waiting" : "step-badge ok";
    ui.runBadge.textContent = failed ? t("finishedWithIssues") : t("complete");
    setStatus(
      failed ? t("finishedWithIssues") : t("complete"),
      failed
        ? t("removedWithFailures", [String(processed), String(failed)])
        : t("removedCount", [String(processed)])
    );
    if (processed > 0) await celebrate(processed);
  }

  // Pick the rest of the list back up where the batch interrupted it.
  if (hasMore && loggedIn) loadFriends();
}

// A finished batch is the moment to say well done — and the only moment we ask
// for a review. The prompt is shown once per install.
async function celebrate(processed) {
  const stored = await chrome.storage.local.get(REVIEW_OPENED_KEY).catch(() => ({}));
  const alreadyReviewed = Boolean(stored[REVIEW_OPENED_KEY]);

  document.querySelector("#summaryRemoved").textContent = String(processed);
  document.querySelector("#summaryRemaining").textContent = hasMore
    ? `${friends.length}+`
    : String(friends.length);
  document.querySelector("#congratsTitle").textContent = t("congratsTitle");
  document.querySelector("#congratsMessage").textContent = t("congratsMessage", [String(processed)]);

  ui.reviewButton.hidden = alreadyReviewed;
  if (ui.reviewDescription) ui.reviewDescription.hidden = alreadyReviewed;
  ui.reviewLaterButton.textContent = alreadyReviewed ? t("close") : t("maybeLater");
  ui.reviewLaterButton.className = alreadyReviewed ? "primary-button" : "secondary-button";
  ui.reviewLaterButton.style.gridColumn = alreadyReviewed ? "1 / -1" : "";

  setTimeout(() => {
    if (!ui.upgradeDialog.open && !ui.reviewDialog.open) ui.reviewDialog.showModal();
  }, 450);
}

/* ------------------------------------------------------------------ session */

function renderSession() {
  const online = loggedIn === true;
  ui.sessionDot.classList.toggle("online", online);
  ui.offlineView.hidden = loggedIn !== false;
  ui.controlsView.hidden = !online;
  ui.connectBadge.className = online ? "step-badge ok" : "step-badge waiting";
  ui.connectBadge.textContent =
    loggedIn === null ? t("checking") : online ? t("connected") : t("notConnected");
  ui.sessionTitle.textContent =
    loggedIn === null ? t("checkingSession") : online ? t("sessionReady") : t("sessionMissing");
  setStep(ui.connectCard, online ? "done" : "active");
}

async function start() {
  const response = await send({ type: "SESSION_STATE" });
  loggedIn = Boolean(response?.loggedIn);
  userId = response?.userId || null;
  renderSession();
  if (!loggedIn) return;

  const cache = await readCache();
  if (cache) {
    friends = cache.friends;
    cursor = cache.cursor ?? null;
    hasMore = Boolean(cache.hasMore);
    renderList();
  }
  // Either the first load, or the rest of one that was cut short.
  await loadFriends();
}

/* ------------------------------------------------------------------- events */

ui.refreshButton.addEventListener("click", () => {
  if (running) return;
  loggedIn = null;
  renderSession();
  refreshAccess();
  start();
});

ui.openFacebookButton.addEventListener("click", () => send({ type: "OPEN_FACEBOOK" }));
ui.reloadButton.addEventListener("click", () => reload());
ui.exportButton.addEventListener("click", () => exportCsv());

ui.searchInput.addEventListener("input", () => {
  search = ui.searchInput.value.trim().toLocaleLowerCase();
  renderLimit = RENDER_STEP;
  ui.friendList.scrollTop = 0;
  renderList();
});

// "/" jumps to the search box, as the placeholder promises.
document.addEventListener("keydown", event => {
  if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  event.preventDefault();
  ui.searchInput.focus();
});

for (const chip of ui.filterChips) {
  chip.addEventListener("click", () => {
    const key = chip.dataset.filter;
    filters[key] = !filters[key];
    // Mutual and Non-mutual are opposites; holding both would show nothing.
    if (key === "mutual" && filters.mutual) filters.nonMutual = false;
    if (key === "nonMutual" && filters.nonMutual) filters.mutual = false;
    for (const other of ui.filterChips) {
      other.setAttribute("aria-pressed", String(filters[other.dataset.filter]));
    }
    renderLimit = RENDER_STEP;
    ui.friendList.scrollTop = 0;
    renderList();
  });
}

ui.selectAllCheckbox.addEventListener("change", () => {
  const list = visibleFriends();
  if (ui.selectAllCheckbox.checked) for (const friend of list) selected.add(friend.id);
  else for (const friend of list) selected.delete(friend.id);
  renderList();
});

ui.removeButton.addEventListener("click", () => runRemoval());

ui.stopButton.addEventListener("click", () => {
  stopRequested = true;
  setStatus(t("stopping"), t("stoppingNote"), { busy: true });
});

ui.confirmCheckbox.addEventListener("change", () => {
  ui.confirmRemoveButton.disabled = !ui.confirmCheckbox.checked;
});

// Sends the failure code and nothing else, in the background, with no mail
// client and no form for the user to fill in.
ui.reportButton.addEventListener("click", async () => {
  ui.reportButton.disabled = true;
  ui.reportStatus.textContent = t("reportSending");
  ui.reportStatus.className = "report-status";
  const response = await send({ type: "REPORT_ISSUE", code: reportedCode || "load_failed" });
  if (response?.ok) {
    reportSent = true;
    ui.reportButton.hidden = true;
    ui.reportStatus.textContent = t("reportSent");
    ui.reportStatus.className = "report-status success";
    return;
  }
  ui.reportButton.disabled = false;
  ui.reportStatus.textContent = t("reportFailed");
  ui.reportStatus.className = "report-status error";
});

ui.accessBadge.addEventListener("click", () => openUpgrade(false));
ui.upgradeButton.addEventListener("click", () => openUpgrade(false));

ui.purchaseButton.addEventListener("click", async () => {
  await send({ type: "OPEN_PURCHASE" });
  startLicensePolling();
});

ui.unlockButton.addEventListener("click", async () => {
  const key = ui.licenseInput.value.trim();
  if (!key) return;
  ui.unlockButton.disabled = true;
  ui.licenseMessage.textContent = t("checkingLicense");
  ui.licenseMessage.className = "license-message";
  const state = await refreshAccess(true, key);
  ui.unlockButton.disabled = false;
  if (state.unlimited) {
    ui.licenseMessage.textContent = t("licenseActivated");
    ui.licenseMessage.className = "license-message success";
    setTimeout(() => ui.upgradeDialog.open && ui.upgradeDialog.close(), 700);
  } else {
    ui.licenseMessage.textContent = t("licenseInvalid");
    ui.licenseMessage.className = "license-message error";
  }
});

ui.reviewButton.addEventListener("click", async () => {
  await chrome.storage.local.set({ [REVIEW_OPENED_KEY]: true });
  await send({ type: "OPEN_REVIEW" });
  ui.reviewDialog.close();
});

chrome.runtime.onMessage.addListener(message => {
  if (message?.type === "ACCESS_STATE_CHANGED" && message.access) {
    access = message.access;
    renderAccess();
  }
});

/* --------------------------------------------------------------------- boot */

localize();
ui.extensionVersion.textContent = `v${chrome.runtime.getManifest().version}`;
chrome.storage.local.get(SETTINGS_STORAGE).then(stored => {
  const saved = stored[SETTINGS_STORAGE]?.speed;
  if (SPEEDS.some(speed => speed.id === saved)) speedId = saved;
  renderSpeeds();
});
renderSession();
renderList();
refreshAccess().then(start);
