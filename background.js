// CleanMySocial — Unfriender : service worker
//
// The side panel is the whole interface: it opens straight from the toolbar icon
// (no popup). This worker owns everything the panel is not allowed to do itself:
//
//   * the Facebook GraphQL session (fb_dtsg token, actor id, request headers),
//   * loading the friends list page by page,
//   * the unfriend mutation,
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

const LICENSE_KEY_STORAGE = "verblike_license_key";
const LICENSE_CACHE_STORAGE = "mass_unfriender_license_cache";
const DAILY_USAGE_STORAGE = "mass_unfriender_daily_usage";
const SETTINGS_STORAGE = "cms_unfriender_settings";
const LICENSE_CACHE_TTL = 5 * 60 * 1000;
const SESSION_TTL = 15 * 60 * 1000;
const DAILY_LIMIT = 20;
const FRIENDS_PAGE_SIZE = 30;
const FB_HEADER_RULE_ID = 2;

const FRIENDS_QUERY = {
  docId: "29498081956473146",
  friendly: "FriendingCometFriendsListPaginationQuery",
  variables: (cursor, count) => ({ count, cursor, name: null, scale: 2 })
};

const UNFRIEND_MUTATION = {
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
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  await chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: true }).catch(() => {});
  const stored = await chrome.storage.local.get(SETTINGS_STORAGE);
  if (!stored[SETTINGS_STORAGE]) {
    await chrome.storage.local.set({ [SETTINGS_STORAGE]: { speed: "slow" } });
  }
  await getLicenseKey().catch(() => {});
  await applyFacebookHeaderRule();
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  await chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: true }).catch(() => {});
  await applyFacebookHeaderRule();
});

/* --------------------------------------------------------- request headers */

// Facebook rejects GraphQL calls whose Origin/Referer are the extension. A
// session rule rewrites both on requests made from the extension itself
// (tabIds: [-1]) without touching anything the user's own tabs send.
let headerRuleReady = applyFacebookHeaderRule();

async function applyFacebookHeaderRule() {
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

async function getActorId() {
  try {
    const cookie = await chrome.cookies.get({ url: FACEBOOK_URL, name: "c_user" });
    return cookie?.value || null;
  } catch {
    return null;
  }
}

// Cheapest source first: any open Facebook tab already holds the token.
async function readTokenFromTab() {
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

function firstMatch(text, pattern) {
  return text.match(pattern)?.[1] || "";
}

async function fetchTokenFromPage(attempt = 0) {
  try {
    const html = await (await fetch(DTSG_FALLBACK_URL, { credentials: "include" })).text();
    // Facebook sometimes answers with its "switch back to the full site" page.
    if (html.includes("fast_switch_site")) {
      if (attempt >= 1) return null;
      const switchUrl =
        /"(https:\/\/m\.facebook\.com\/a\/preferences\.php\?fast_switch_site[^"]+)"/.exec(html);
      if (!switchUrl) return null;
      await fetch(switchUrl[1].replace(/&amp;/g, "&"), { credentials: "include" });
      return fetchTokenFromPage(attempt + 1);
    }
    return (
      firstMatch(html, /name="fb_dtsg"\s+value="([^"]+)"/) ||
      firstMatch(html, /"DTSGInitialData",\[\],\{"token":"([^"]+)"/) ||
      firstMatch(html, /"DTSGInitData",\[\],\{"token":"([^"]+)"/) ||
      null
    );
  } catch {
    return null;
  }
}

async function getSession() {
  const userId = await getActorId();
  if (!userId) throw new Error("not_logged_in");
  if (sessionCache?.userId === userId && Date.now() - sessionCachedAt < SESSION_TTL) {
    return sessionCache;
  }
  const token = (await readTokenFromTab()) ?? (await fetchTokenFromPage());
  if (!token) throw new Error("missing_token");
  sessionCache = { dtsg: token, userId };
  sessionCachedAt = Date.now();
  return sessionCache;
}

/* ---------------------------------------------------------------- GraphQL */

function graphqlBody(session, friendly, docId, variables) {
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

async function callGraphql(session, friendly, docId, variables) {
  await headerRuleReady;
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-fb-friendly-name": friendly
    },
    body: graphqlBody(session, friendly, docId, variables)
  });
  const text = await response.text();
  let json;
  try {
    // Responses are prefixed with an anti-JSON-hijacking guard and may stream
    // several objects; the first line is the one that matters here.
    json = JSON.parse((text.startsWith("for (;;);") ? text.slice(9) : text).split("\n")[0]);
  } catch {
    throw new Error(`bad_response http=${response.status}`);
  }
  if (json?.errors?.length) throw new Error(json.errors[0]?.message || "graphql_error");
  return json;
}

function profileHandle(url) {
  try {
    const parsed = new URL(url, FACEBOOK_ORIGIN);
    const id = parsed.searchParams.get("id");
    if (parsed.pathname.startsWith("/profile.php") && id) return `id-${id}`;
    return parsed.pathname.replace(/^\/|\/$/g, "") || parsed.hostname;
  } catch {
    return url;
  }
}

function toFriend(node) {
  if (!(node?.id && node.name && node.url)) return null;
  const friend = {
    id: node.id,
    name: node.name,
    url: node.url,
    avatar: node.profile_picture?.uri ?? null,
    handle: profileHandle(node.url)
  };
  const context = node.social_context?.text;
  if (typeof context === "string" && context.trim()) friend.meta = context.trim();
  return friend;
}

async function loadFriendsPage(cursor) {
  const session = await getSession();
  const json = await callGraphql(
    session,
    FRIENDS_QUERY.friendly,
    FRIENDS_QUERY.docId,
    FRIENDS_QUERY.variables(cursor ?? null, FRIENDS_PAGE_SIZE)
  );
  const connection = json?.data?.viewer?.all_friends;
  if (!connection) throw new Error("no_friend_list");
  const friends = [];
  for (const edge of connection.edges ?? []) {
    const friend = toFriend(edge?.node);
    if (friend) friends.push(friend);
  }
  const pageInfo = connection.page_info ?? {};
  const endCursor = pageInfo.end_cursor ?? null;
  return { friends, endCursor, hasNext: Boolean(pageInfo.has_next_page && endCursor) };
}

async function unfriend(friend) {
  const session = await getSession();
  const json = await callGraphql(
    session,
    UNFRIEND_MUTATION.friendly,
    UNFRIEND_MUTATION.docId,
    UNFRIEND_MUTATION.variables(friend, session)
  );
  const person = json?.data?.friend_remove?.unfriended_person;
  if (!person) return { status: "failed", message: "unexpected_response" };
  if (person.friendship_status && person.friendship_status === "ARE_FRIENDS") {
    return { status: "failed", message: "still_friends" };
  }
  return { status: "success" };
}

/* ----------------------------------------------------- licence and quota */

let usageQueue = Promise.resolve();

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
    // A network failure must never promote a key, but it must not demote a
    // purchase that was already confirmed on this device either.
    return {
      active: Boolean(cache?.key === key && cache.active),
      key,
      error: error instanceof Error ? error.message : "license_unreachable"
    };
  }
}

function localDateKey() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

async function getDailyUsage() {
  const today = localDateKey();
  const stored = await chrome.storage.local.get(DAILY_USAGE_STORAGE);
  const usage = stored[DAILY_USAGE_STORAGE];
  if (usage?.date === today && Number.isFinite(usage.count)) {
    return { date: today, count: Math.max(0, Math.min(DAILY_LIMIT, usage.count)) };
  }
  const fresh = { date: today, count: 0 };
  await chrome.storage.local.set({ [DAILY_USAGE_STORAGE]: fresh });
  return fresh;
}

async function getAccessState(options = {}) {
  const [license, usage] = await Promise.all([checkLicense(options), getDailyUsage()]);
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

function broadcastAccessState(access) {
  chrome.runtime.sendMessage({ type: "ACCESS_STATE_CHANGED", access }).catch(() => {});
}

// Serialised so two overlapping removals can never share one quota slot.
function recordMeteredAction() {
  const task = usageQueue.then(async () => {
    const access = await getAccessState();
    if (access.unlimited) return { allowed: true, access };
    if (access.used >= DAILY_LIMIT) return { allowed: false, access };

    const next = { date: localDateKey(), count: access.used + 1 };
    await chrome.storage.local.set({ [DAILY_USAGE_STORAGE]: next });
    const nextAccess = {
      ...access,
      used: next.count,
      remaining: Math.max(0, DAILY_LIMIT - next.count),
      date: next.date
    };
    broadcastAccessState(nextAccess);
    return { allowed: true, access: nextAccess };
  });
  usageQueue = task.catch(() => {});
  return task;
}

/* --------------------------------------------------------------- messages */

const handlers = {
  // The id is what the panel keys its local friends copy to, so one profile's
  // list can never show up under another account.
  async SESSION_STATE() {
    const userId = await getActorId();
    return { ok: true, loggedIn: Boolean(userId), userId };
  },

  async LOAD_FRIENDS(message) {
    try {
      const page = await loadFriendsPage(message.cursor ?? null);
      return { ok: true, ...page };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  // One removal, quota checked before the call and only counted when Facebook
  // confirmed it, so a stopped or failed batch never burns a free slot.
  async UNFRIEND(message) {
    const friend = message.friend;
    if (!friend?.id) return { ok: false, status: "failed", message: "missing_friend" };

    const access = await getAccessState();
    if (!access.unlimited && access.remaining <= 0) {
      return { ok: true, status: "limit", access };
    }

    let result;
    try {
      result = await unfriend(friend);
    } catch (error) {
      return {
        ok: false,
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
        access
      };
    }

    if (result.status !== "success") return { ok: true, ...result, access };
    const metered = await recordMeteredAction();
    return { ok: true, status: "success", access: metered.access };
  },

  async GET_ACCESS_STATE() {
    return { ok: true, access: await getAccessState() };
  },

  async CHECK_LICENSE(message) {
    const access = await getAccessState({ force: true, key: message.licenseKey });
    broadcastAccessState(access);
    return { ok: true, access };
  },

  async OPEN_PURCHASE() {
    const key = await getLicenseKey();
    const url = new URL(PURCHASE_URL);
    url.searchParams.set("lk", key);
    const tab = await chrome.tabs.create({ url: url.toString() });
    return { ok: true, tabId: tab.id };
  },

  async OPEN_REVIEW() {
    const tab = await chrome.tabs.create({ url: REVIEW_URL });
    return { ok: true, tabId: tab.id };
  },

  // The user pressed "tell the developer" on a breakage notice. Only the
  // failure code, extension version and UI language travel — no friend data, no
  // licence key, no Facebook ids — and the site drops duplicates so a
  // Facebook-side change does not flood the mailbox.
  async REPORT_ISSUE(message) {
    const code = String(message.code || "load_failed");
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

  async OPEN_FACEBOOK() {
    const tab = await chrome.tabs.create({ url: `${FACEBOOK_URL}me/friends` });
    return { ok: true, tabId: tab.id };
  }
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) return false;
  handler(message)
    .then(sendResponse)
    .catch(error =>
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
    );
  return true;
});
