// CleanMySocial — Unfriender : service worker
//
// Opens the on-page Unfriender controls in a Facebook tab and, crucially, only
// activates the controls in the ONE tab the user launched from. Activation is a
// message (OPEN_FRIEND_SELECTOR) delivered to that specific tab; content.js never
// shows the panel on its own, so other Facebook tabs stay untouched.

const FACEBOOK_URLS = ["https://www.facebook.com/*", "https://web.facebook.com/*"];
const FRIENDS_URL = "https://www.facebook.com/me/friends";
const PURCHASE_URL = "https://cleanmysocial.verblike.com/mass-unfriender";
const REVIEW_URL = "https://chromewebstore.google.com/detail/fegkbiinmaoipoonnlhekdoefgebmdnj/reviews";
const LICENSE_API = "https://cleanmysocial.verblike.com/api/license?extension=cleanmysocial&key=";
const LICENSE_KEY_STORAGE = "verblike_license_key";
const LICENSE_CACHE_STORAGE = "mass_unfriender_license_cache";
const LICENSE_CACHE_TTL = 5 * 60 * 1000;

function createLicenseKey() {
  return crypto.randomUUID?.() || `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function getLicenseKey() {
  const stored = await chrome.storage.sync.get(LICENSE_KEY_STORAGE);
  if (stored[LICENSE_KEY_STORAGE]) return stored[LICENSE_KEY_STORAGE];
  const key = createLicenseKey();
  await chrome.storage.sync.set({ [LICENSE_KEY_STORAGE]: key });
  return key;
}

async function setLicenseKey(value) {
  const key = String(value || "").trim();
  if (!key) return getLicenseKey();
  await chrome.storage.sync.set({ [LICENSE_KEY_STORAGE]: key });
  await chrome.storage.local.remove(LICENSE_CACHE_STORAGE);
  return key;
}

async function checkLicense({ force = false, key: suppliedKey } = {}) {
  const key = suppliedKey ? await setLicenseKey(suppliedKey) : await getLicenseKey();
  const stored = await chrome.storage.local.get(LICENSE_CACHE_STORAGE);
  const cache = stored[LICENSE_CACHE_STORAGE];
  if (!force && cache?.key === key && Date.now() - cache.checkedAt < LICENSE_CACHE_TTL) {
    return { active: Boolean(cache.active), key };
  }

  try {
    const response = await fetch(`${LICENSE_API}${encodeURIComponent(key)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`License server returned ${response.status}`);
    const body = await response.json();
    const active = Boolean(body?.active || body?.result);
    await chrome.storage.local.set({
      [LICENSE_CACHE_STORAGE]: { key, active, checkedAt: Date.now() }
    });
    return { active, key };
  } catch (error) {
    return {
      active: Boolean(cache?.key === key && cache.active),
      key,
      error: error instanceof Error ? error.message : "Could not check the license."
    };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  getLicenseKey().catch(() => {});
});

// Deliver the activation message to a specific tab, retrying until its content
// script is present (a freshly created / navigated tab needs a moment to load).
async function activateTab(tabId, attempt = 0) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "OPEN_FRIEND_SELECTOR" });
  } catch {
    if (attempt >= 25) return; // ~10s of retries, then give up quietly
    setTimeout(() => activateTab(tabId, attempt + 1), 400);
  }
}

async function openFriendSelector() {
  // Prefer the Facebook tab the user is currently looking at.
  const [activeFacebook] = await chrome.tabs.query({ active: true, lastFocusedWindow: true, url: FACEBOOK_URLS });
  const existing = activeFacebook || (await chrome.tabs.query({ url: FACEBOOK_URLS }))[0];

  if (!existing) {
    const tab = await chrome.tabs.create({ url: FRIENDS_URL, active: true });
    activateTab(tab.id);
    return tab;
  }

  await chrome.windows.update(existing.windowId, { focused: true });
  const tab = await chrome.tabs.update(existing.id, { active: true });
  activateTab(tab.id);
  return tab;
}

chrome.action.onClicked.addListener(() => {
  openFriendSelector().catch(() => {
    chrome.tabs.create({ url: FRIENDS_URL, active: true }).catch(() => {});
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_LICENSE_STATE" || message?.type === "CHECK_LICENSE") {
    checkLicense({
      force: message.type === "CHECK_LICENSE",
      key: message.licenseKey
    }).then(license => sendResponse({ ok: true, license }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "OPEN_PURCHASE") {
    getLicenseKey().then(key => {
      const url = new URL(PURCHASE_URL);
      url.searchParams.set("lk", key);
      return chrome.tabs.create({ url: url.toString() });
    }).then(tab => sendResponse({ ok: true, tabId: tab.id }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "OPEN_REVIEW") {
    chrome.tabs.create({ url: REVIEW_URL })
      .then(tab => sendResponse({ ok: true, tabId: tab.id }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});
