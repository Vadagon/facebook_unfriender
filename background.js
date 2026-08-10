// CleanMySocial — Unfriender : service worker
//
// The side panel is the whole interface: it opens straight from the toolbar icon
// (no popup). This worker owns everything the panel is not allowed to do itself:
//
//   * the Facebook GraphQL session (fb_dtsg token, actor id, request headers),
//   * loading the friends list page by page,
//   * the friend-removal mutation,
//   * the shared CleanMySocial licence and the free daily removal quota.
//
// No content script and no visible Facebook tab are needed. Requests are made
// from the extension with the signed-in Facebook cookies, so the friend list
// never leaves the browser.

const FACEBOOK_ORIGIN = "https://www.facebook.com";
const FACEBOOK_URL = "https://www.facebook.com/";
const GRAPHQL_URL = "https://www.facebook.com/api/graphql/";
// Any logged-in Facebook page carries an fb_dtsg token; this one is small and
// stable, so it is the fallback when no Facebook tab is open to read it from.
const DTSG_FALLBACK_URL =
  "https://www.facebook.com/help/contact/1417759018475333?helpref=faq_content&refid=69";

const PURCHASE_URL = "https://cleanmysocial.verblike.com/mass-unfriender";
const REVIEW_URL =
  "https://chromewebstore.google.com/detail/fegkbiinmaoipoonnlhekdoefgebmdnj/reviews";
// Identify this extension specifically, so the server can tell which tool is
// asking. Asking as "cleanmysocial" means any purchase unlocks everything.
const LICENSE_API =
  "https://cleanmysocial.verblike.com/api/license?extension=mass-unfriender&key=";
const REPORT_API = "https://cleanmysocial.verblike.com/api/report";
const EXTENSION_SLUG = "mass-unfriender";

const SHARED_LICENSE_TOKEN = "verblike_license_key";
const ENTITLEMENT_VAULT = "friend_sweep_v2_entitlement";
const DAILY_METER_VAULT = "friend_sweep_v2_daily_meter";
const PREFERENCES_VAULT = "friend_sweep_v2_preferences";
const LEGACY_VAULT = {
  entitlement: "mass_unfriender_license_cache",
  dailyMeter: "mass_unfriender_daily_usage",
  preferences: "cms_unfriender_settings"
};

async function migrateWorkerVault() {
  const legacyKeys = Object.values(LEGACY_VAULT);
  const stored = await chrome.storage.local.get([
    ENTITLEMENT_VAULT,
    DAILY_METER_VAULT,
    PREFERENCES_VAULT,
    ...legacyKeys
  ]);
  const additions = {};
  if (stored[ENTITLEMENT_VAULT] == null && stored[LEGACY_VAULT.entitlement] != null) {
    additions[ENTITLEMENT_VAULT] = stored[LEGACY_VAULT.entitlement];
  }
  if (stored[DAILY_METER_VAULT] == null && stored[LEGACY_VAULT.dailyMeter] != null) {
    additions[DAILY_METER_VAULT] = stored[LEGACY_VAULT.dailyMeter];
  }
  if (stored[PREFERENCES_VAULT] == null && stored[LEGACY_VAULT.preferences] != null) {
    additions[PREFERENCES_VAULT] = stored[LEGACY_VAULT.preferences];
  }
  if (Object.keys(additions).length) await chrome.storage.local.set(additions);
  await chrome.storage.local.remove(legacyKeys);
}

const workerVaultReady = migrateWorkerVault().catch(error => {
  console.error("[FriendSweep] storage migration failed:", error);
});
const LICENSE_CACHE_TTL = 5 * 60 * 1000;
const SESSION_TTL = 15 * 60 * 1000;
const DAILY_LIMIT = 20;
const FRIENDS_PAGE_SIZE = 30;
const FB_HEADER_RULE_ID = 2;

const ROSTER_PAGE_OPERATION = {
  docId: "29498081956473146",
  friendly: "FriendingCometFriendsListPaginationQuery",
  variables: (cursor, count) => ({ count, cursor, name: null, scale: 2 })
};

const FRIEND_REMOVAL_OPERATION = {
  docId: "24028849793460009",
  friendly: "FriendingCometUnfriendMutation",
  variables: (friend, session) => ({
    input: {
      source: "bd_profile_button",
      unfriended_user_id: friend.id,
      actor_id: session.userId,
      client_mutation_id: "1"
    },
    scale: 2
  })
};

/* ------------------------------------------------------------------ panel */

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(async () => {
  await migrateWorkerVault();
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  await chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: true }).catch(() => {});
  const stored = await chrome.storage.local.get(PREFERENCES_VAULT);
  if (!stored[PREFERENCES_VAULT]) {
    await chrome.storage.local.set({ [PREFERENCES_VAULT]: { speed: "slow" } });
  }
  await resolveLicenseToken().catch(() => {});
  await installFacebookRequestHeaders();
});

chrome.runtime.onStartup.addListener(async () => {
  await migrateWorkerVault();
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  await chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: true }).catch(() => {});
  await installFacebookRequestHeaders();
});

/* --------------------------------------------------------- request headers */

// Facebook rejects GraphQL calls whose Origin/Referer are the extension. A
// session rule rewrites both on requests made from the extension itself
// (tabIds: [-1]) without touching anything the user's own tabs send.
let headerRuleReady = installFacebookRequestHeaders();

async function installFacebookRequestHeaders() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [FB_HEADER_RULE_ID] });
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [FB_HEADER_RULE_ID],
      addRules: [
        {
          id: FB_HEADER_RULE_ID,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              { header: "origin", operation: "set", value: FACEBOOK_ORIGIN },
              { header: "referer", operation: "set", value: FACEBOOK_URL }
            ]
          },
          condition: {
            urlFilter: "||facebook.com/api/graphql/",
            resourceTypes: ["xmlhttprequest"],
            tabIds: [-1]
          }
        }
      ]
    });
  } catch (error) {
    console.error("[Unfriender] header rule failed:", error);
  }
}

/* ------------------------------------------------------- Facebook session */

let sessionCache = null;
let sessionCachedAt = 0;

async function resolveSignedInAccount() {
  try {
    const cookie = await chrome.cookies.get({ url: FACEBOOK_URL, name: "c_user" });
    return cookie?.value || null;
  } catch {
    return null;
  }
}

// Cheapest source first: any open Facebook tab already holds the token.
async function discoverTokenInOpenTab() {
  try {
    const tabs = (await chrome.tabs.query({ url: "*://*.facebook.com/*" })).filter(
      tab => tab.id != null
    );
    if (!tabs.length) return null;
    return await Promise.any(
      tabs.map(tab =>
        chrome.scripting
          .executeScript({
            target: { tabId: tab.id },
            world: "MAIN",
            func: () => {
              try {
                const req = globalThis.require;
                return (typeof req === "function" ? req("DTSGInitialData") : null)?.token ?? null;
              } catch {
                return null;
              }
            }
          })
          .then(results => {
            const token = results[0]?.result;
            if (typeof token === "string" && token) return token;
            throw new Error("no token");
          })
      )
    );
  } catch {
    return null;
  }
}

function captureFirst(text, pattern) {
  return text.match(pattern)?.[1] || "";
}

async function discoverTokenFromFallbackPage(attempt = 0) {
  try {
    const html = await (await fetch(DTSG_FALLBACK_URL, { credentials: "include" })).text();
    // Facebook sometimes answers with its "switch back to the full site" page.
    if (html.includes("fast_switch_site")) {
      if (attempt >= 1) return null;
      const switchUrl =
        /"(https:\/\/m\.facebook\.com\/a\/preferences\.php\?fast_switch_site[^"]+)"/.exec(html);
      if (!switchUrl) return null;
      await fetch(switchUrl[1].replace(/&amp;/g, "&"), { credentials: "include" });
      return discoverTokenFromFallbackPage(attempt + 1);
    }
    return (
      captureFirst(html, /name="fb_dtsg"\s+value="([^"]+)"/) ||
      captureFirst(html, /"DTSGInitialData",\[\],\{"token":"([^"]+)"/) ||
      captureFirst(html, /"DTSGInitData",\[\],\{"token":"([^"]+)"/) ||
      null
    );
  } catch {
    return null;
  }
}

async function acquireFacebookSession() {
  const userId = await resolveSignedInAccount();
  if (!userId) throw new Error("session_absent_v2");
  if (sessionCache?.userId === userId && Date.now() - sessionCachedAt < SESSION_TTL) {
    return sessionCache;
  }
  const token = (await discoverTokenInOpenTab()) ?? (await discoverTokenFromFallbackPage());
  if (!token) throw new Error("session_token_unavailable_v2");
  sessionCache = { dtsg: token, userId };
  sessionCachedAt = Date.now();
  return sessionCache;
}

/* ---------------------------------------------------------------- GraphQL */

function encodeFacebookPayload(session, friendly, docId, variables) {
  const body = new URLSearchParams({
    av: session.userId,
    __user: session.userId,
    __a: "1",
    fb_dtsg: session.dtsg,
    fb_api_caller_class: "RelayModern",
    fb_api_req_friendly_name: friendly,
    variables: JSON.stringify(variables),
    server_timestamps: "true",
    doc_id: docId
  });
  return body.toString();
}

async function executeFacebookOperation(session, friendly, docId, variables) {
  await headerRuleReady;
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-fb-friendly-name": friendly
    },
    body: encodeFacebookPayload(session, friendly, docId, variables)
  });
  const text = await response.text();
  let json;
  try {
    // Responses are prefixed with an anti-JSON-hijacking guard and may stream
    // several objects; the first line is the one that matters here.
    json = JSON.parse((text.startsWith("for (;;);") ? text.slice(9) : text).split("\n")[0]);
  } catch {
    throw new Error(`facebook_payload_invalid_v2 http=${response.status}`);
  }
  if (json?.errors?.length) {
    throw new Error(json.errors[0]?.message || "facebook_graphql_error_v2");
  }
  return json;
}

function deriveProfileHandle(url) {
  try {
    const parsed = new URL(url, FACEBOOK_ORIGIN);
    const id = parsed.searchParams.get("id");
    if (parsed.pathname.startsWith("/profile.php") && id) return `id-${id}`;
    return parsed.pathname.replace(/^\/|\/$/g, "") || parsed.hostname;
  } catch {
    return url;
  }
}

function normalizeFriendNode(node) {
  if (!(node?.id && node.name && node.url)) return null;
  const friend = {
    id: node.id,
    name: node.name,
    url: node.url,
    avatar: node.profile_picture?.uri ?? null,
    handle: deriveProfileHandle(node.url)
  };
  const context = node.social_context?.text;
  if (typeof context === "string" && context.trim()) friend.meta = context.trim();
  return friend;
}

async function fetchRosterPage(cursor) {
  const session = await acquireFacebookSession();
  const json = await executeFacebookOperation(
    session,
    ROSTER_PAGE_OPERATION.friendly,
    ROSTER_PAGE_OPERATION.docId,
    ROSTER_PAGE_OPERATION.variables(cursor ?? null, FRIENDS_PAGE_SIZE)
  );
  const connection = json?.data?.viewer?.all_friends;
  if (!connection) throw new Error("roster_payload_missing_v2");
  const records = [];
  for (const edge of connection.edges ?? []) {
    const friend = normalizeFriendNode(edge?.node);
    if (friend) records.push(friend);
  }
  const pageInfo = connection.page_info ?? {};
  const endCursor = pageInfo.end_cursor ?? null;
  return { records, nextCursor: endCursor, more: Boolean(pageInfo.has_next_page && endCursor) };
}

async function commitFriendRemoval(friend) {
  const session = await acquireFacebookSession();
  const json = await executeFacebookOperation(
    session,
    FRIEND_REMOVAL_OPERATION.friendly,
    FRIEND_REMOVAL_OPERATION.docId,
    FRIEND_REMOVAL_OPERATION.variables(friend, session)
  );
  const person = json?.data?.friend_remove?.unfriended_person;
  if (!person) return { outcome: "failed", reason: "removal_payload_unexpected_v2" };
  if (person.friendship_status && person.friendship_status === "ARE_FRIENDS") {
    return { outcome: "failed", reason: "friendship_unchanged_v2" };
  }
  return { outcome: "success" };
}

/* ----------------------------------------------------- licence and quota */

let usageQueue = Promise.resolve();

function createLicenseToken() {
  return crypto.randomUUID?.() || `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function resolveLicenseToken() {
  const stored = await chrome.storage.sync.get(SHARED_LICENSE_TOKEN);
  if (stored[SHARED_LICENSE_TOKEN]) return stored[SHARED_LICENSE_TOKEN];
  const key = createLicenseToken();
  await chrome.storage.sync.set({ [SHARED_LICENSE_TOKEN]: key });
  return key;
}

async function storeLicenseToken(value) {
  const key = String(value || "").trim();
  if (!key) return resolveLicenseToken();
  await chrome.storage.sync.set({ [SHARED_LICENSE_TOKEN]: key });
  await chrome.storage.local.remove(ENTITLEMENT_VAULT);
  return key;
}

async function verifyLicenseToken({ force = false, key: suppliedKey } = {}) {
  const key = suppliedKey ? await storeLicenseToken(suppliedKey) : await resolveLicenseToken();
  const stored = await chrome.storage.local.get(ENTITLEMENT_VAULT);
  const cache = stored[ENTITLEMENT_VAULT];
  if (!force && cache?.key === key && Date.now() - cache.checkedAt < LICENSE_CACHE_TTL) {
    return { active: Boolean(cache.active), key };
  }

  try {
    const response = await fetch(`${LICENSE_API}${encodeURIComponent(key)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`License server returned ${response.status}`);
    const body = await response.json();
    const active = Boolean(body?.active || body?.result);
    await chrome.storage.local.set({
      [ENTITLEMENT_VAULT]: { key, active, checkedAt: Date.now() }
    });
    return { active, key };
  } catch (error) {
    // A network failure must never promote a key, but it must not demote a
    // purchase that was already confirmed on this device either.
    return {
      active: Boolean(cache?.key === key && cache.active),
      key,
      error: error instanceof Error ? error.message : "license_unreachable"
    };
  }
}

function currentMeterDate() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

async function readDailyMeter() {
  const today = currentMeterDate();
  const stored = await chrome.storage.local.get(DAILY_METER_VAULT);
  const usage = stored[DAILY_METER_VAULT];
  if (usage?.date === today && Number.isFinite(usage.count)) {
    return { date: today, count: Math.max(0, Math.min(DAILY_LIMIT, usage.count)) };
  }
  const fresh = { date: today, count: 0 };
  await chrome.storage.local.set({ [DAILY_METER_VAULT]: fresh });
  return fresh;
}

async function readEntitlementSnapshot(options = {}) {
  const [license, usage] = await Promise.all([verifyLicenseToken(options), readDailyMeter()]);
  return {
    unlimited: license.active,
    licenseKey: license.key,
    used: usage.count,
    limit: DAILY_LIMIT,
    remaining: license.active ? null : Math.max(0, DAILY_LIMIT - usage.count),
    date: usage.date,
    licenseError: license.error || ""
  };
}

function emitEntitlementUpdate(access) {
  chrome.runtime.sendMessage({ type: "ENTITLEMENT_UPDATED", entitlement: access }).catch(() => {});
}

// Serialised so two overlapping removals can never share one quota slot.
function recordRemovalUsage() {
  const task = usageQueue.then(async () => {
    const access = await readEntitlementSnapshot();
    if (access.unlimited) return { allowed: true, access };
    if (access.used >= DAILY_LIMIT) return { allowed: false, access };

    const next = { date: currentMeterDate(), count: access.used + 1 };
    await chrome.storage.local.set({ [DAILY_METER_VAULT]: next });
    const nextAccess = {
      ...access,
      used: next.count,
      remaining: Math.max(0, DAILY_LIMIT - next.count),
      date: next.date
    };
    emitEntitlementUpdate(nextAccess);
    return { allowed: true, access: nextAccess };
  });
  usageQueue = task.catch(() => {});
  return task;
}

/* --------------------------------------------------------------- messages */

const handlers = {
  // The id is what the panel keys its local friends copy to, so one profile's
  // list can never show up under another account.
  async PANEL_SESSION_PROBE() {
    const accountId = await resolveSignedInAccount();
    return { ok: true, loggedIn: Boolean(accountId), accountId };
  },

  async FRIEND_PAGE_FETCH(message) {
    try {
      const page = await fetchRosterPage(message.pageCursor ?? null);
      return { ok: true, ...page };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  // One removal, quota checked before the call and only counted when Facebook
  // confirmed it, so a stopped or failed batch never burns a free slot.
  async FRIEND_REMOVE_COMMIT(message) {
    const friend = message.target;
    if (!friend?.id) return { ok: false, outcome: "failed", reason: "removal_target_missing_v2" };

    const entitlement = await readEntitlementSnapshot();
    if (!entitlement.unlimited && entitlement.remaining <= 0) {
      return { ok: true, outcome: "limit", entitlement };
    }

    let result;
    try {
      result = await commitFriendRemoval(friend);
    } catch (error) {
      return {
        ok: false,
        outcome: "failed",
        reason: error instanceof Error ? error.message : String(error),
        entitlement
      };
    }

    if (result.outcome !== "success") return { ok: true, ...result, entitlement };
    const metered = await recordRemovalUsage();
    return { ok: true, outcome: "success", entitlement: metered.access };
  },

  async ENTITLEMENT_READ() {
    return { ok: true, entitlement: await readEntitlementSnapshot() };
  },

  async ENTITLEMENT_VERIFY(message) {
    const entitlement = await readEntitlementSnapshot({ force: true, key: message.licenseToken });
    emitEntitlementUpdate(entitlement);
    return { ok: true, entitlement };
  },

  async CHECKOUT_LAUNCH() {
    const key = await resolveLicenseToken();
    const url = new URL(PURCHASE_URL);
    url.searchParams.set("lk", key);
    const tab = await chrome.tabs.create({ url: url.toString() });
    return { ok: true, tabId: tab.id };
  },

  async REVIEW_LAUNCH() {
    const tab = await chrome.tabs.create({ url: REVIEW_URL });
    return { ok: true, tabId: tab.id };
  },

  // The user pressed "tell the developer" on a breakage notice. Only the
  // failure code, extension version and UI language travel — no friend data, no
  // licence key, no Facebook ids — and the site drops duplicates so a
  // Facebook-side change does not flood the mailbox.
  async DIAGNOSTIC_SUBMIT(message) {
    const code = String(message.code || "roster_load_exhausted_v2");
    try {
      const response = await fetch(REPORT_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          extension: EXTENSION_SLUG,
          code,
          version: chrome.runtime.getManifest().version,
          locale: chrome.i18n.getUILanguage()
        })
      });
      if (!response.ok) throw new Error(`report_rejected_${response.status}`);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  async FACEBOOK_FRIENDS_OPEN() {
    const tab = await chrome.tabs.create({ url: `${FACEBOOK_URL}me/friends` });
    return { ok: true, tabId: tab.id };
  }
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) return false;
  workerVaultReady
    .then(() => handler(message))
    .then(sendResponse)
    .catch(error =>
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
    );
  return true;
});
