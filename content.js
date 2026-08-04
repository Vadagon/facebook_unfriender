// CleanMySocial — Unfriender (Facebook friends-page controls)
//
// The UI is rendered directly on the user's own Facebook Friends page. Friend
// cards are identified by repeated profile URLs and structural signals, never
// by Facebook's generated class names or translated button text.

(function () {
  if (window.__cmsContentLoaded) return;
  window.__cmsContentLoaded = true;

  const creds = { fb_dtsg: null, uid: null, jazoest: null };
  const friends = new Map(); // numeric id -> Facebook metadata
  const friendIndex = new Map(); // normalized profile key -> metadata
  const knownProfiles = new Map(); // normalized profile key -> visible card data
  const selected = new Set();
  const harvestedScripts = new WeakSet();
  const RESERVED_PATHS = new Set([
    "", "about", "ads", "bookmarks", "events", "friends", "gaming", "groups",
    "help", "home.php", "login", "marketplace", "me", "memories", "messages",
    "notifications", "pages", "privacy", "reel", "reels", "saved", "settings",
    "stories", "watch"
  ]);
  const FREE_SELECTION_THRESHOLD = 20;
  const FREE_REMOVAL_COUNT = 5;
  const REVIEW_OPENED_KEY = "mass-unfriender-review-opened";

  let host = null;
  let shadow = null;
  let pageStyle = null;
  let observer = null;
  let scanQueued = false;
  let loadingAll = false;
  let unfriending = false;
  let stopRequested = false;
  let licensePoll = null;

  function readCredsFromPage() {
    const html = document.documentElement.innerHTML;
    if (!creds.fb_dtsg) {
      const match =
        html.match(/"DTSGInitData",\[\],\{"token":"([^"]+)"/) ||
        html.match(/\["DTSGInitialData",\[\],\{"token":"([^"]+)"/) ||
        html.match(/name="fb_dtsg"\s+value="([^"]+)"/);
      if (match) creds.fb_dtsg = match[1];
    }
    if (!creds.jazoest) {
      const match = html.match(/name="jazoest"\s+value="(\d+)"/) || html.match(/"jazoest":"(\d+)"/);
      if (match) creds.jazoest = match[1];
    }
    if (!creds.uid) {
      const cookie = document.cookie.match(/(?:^|;\s*)c_user=(\d+)/);
      const embedded = html.match(/"USER_ID":"(\d+)"/);
      creds.uid = cookie?.[1] || embedded?.[1] || null;
    }
  }

  function waitForCreds(timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      (function tick() {
        readCredsFromPage();
        if (creds.fb_dtsg && creds.uid) return resolve(creds);
        if (Date.now() - started > timeoutMs) return reject(new Error("Sign in to Facebook, then try again."));
        setTimeout(tick, 350);
      })();
    });
  }

  function isOwnFriendsPage() {
    const path = location.pathname.replace(/\/+$/, "");
    if (/^\/[^/]+\/friends(?:_all)?$/i.test(path)) return true;
    return path === "/profile.php" && /(?:^|&)sk=friends(?:&|$)/.test(location.search.slice(1));
  }

  function profileIdentity(href) {
    try {
      const url = new URL(href, location.origin);
      if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return null;
      if (url.pathname === "/profile.php") {
        const id = url.searchParams.get("id");
        return /^\d+$/.test(id || "") ? { key: `id:${id}`, id, url: `https://www.facebook.com/profile.php?id=${id}` } : null;
      }
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0]?.toLowerCase() === "people" && /^\d+$/.test(parts.at(-1) || "")) {
        const id = parts.at(-1);
        return { key: `id:${id}`, id, url: `https://www.facebook.com/profile.php?id=${id}` };
      }
      if (parts.length !== 1) return null;
      const slug = decodeURIComponent(parts[0]).toLowerCase();
      if (RESERVED_PATHS.has(slug)) return null;
      if (/^\d+$/.test(slug)) {
        if (slug === creds.uid) return null;
        return { key: `id:${slug}`, id: slug, url: `https://www.facebook.com/profile.php?id=${slug}` };
      }
      return { key: `path:${slug}`, id: null, url: `https://www.facebook.com/${parts[0]}` };
    } catch {
      return null;
    }
  }

  function parseMutual(node) {
    if (typeof node?.mutual_friends?.count === "number") return node.mutual_friends.count;
    return null;
  }

  function indexFriend(friend) {
    friendIndex.set(`id:${friend.id}`, friend);
    const identity = profileIdentity(friend.url);
    if (identity) friendIndex.set(identity.key, friend);
  }

  function collectUsers(value) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(collectUsers);
      return;
    }
    if (value.__typename === "User" && /^\d+$/.test(value.id || "") && typeof value.name === "string") {
      if ((!value.friendship_status || value.friendship_status === "ARE_FRIENDS") && value.id !== creds.uid) {
        const existing = friends.get(value.id) || {};
        const friend = {
          ...existing,
          id: value.id,
          name: value.name,
          url: value.url || existing.url || `https://www.facebook.com/profile.php?id=${value.id}`,
          mutual: parseMutual(value)
        };
        friends.set(friend.id, friend);
        indexFriend(friend);
      }
    }
    Object.values(value).forEach(child => {
      if (child && typeof child === "object") collectUsers(child);
    });
  }

  function parseGraphqlPayloads(text) {
    if (!text) return [];
    try { return [JSON.parse(text)]; } catch {}
    return text.split("\n").map(line => {
      try { return JSON.parse(line.trim()); } catch { return null; }
    }).filter(Boolean);
  }

  function harvestFromPageBlobs() {
    document.querySelectorAll('script[type="application/json"]').forEach(script => {
      if (harvestedScripts.has(script)) return;
      harvestedScripts.add(script);
      const text = script.textContent || "";
      if (!text.includes('"__typename":"User"')) return;
      if (!/AppCollection|friendship_status|pageItems/.test(text)) return;
      try { collectUsers(JSON.parse(text)); } catch {}
    });
  }

  function injectPageHook() {
    if (document.getElementById("cms-inject")) return;
    const script = document.createElement("script");
    script.id = "cms-inject";
    script.src = chrome.runtime.getURL("inject.js");
    (document.head || document.documentElement).appendChild(script);
  }

  function onInjectedMessage(event) {
    const data = event.data;
    if (!data || data.source !== "CMS_INJECT") return;
    if (data.kind === "token" && data.fb_dtsg) creds.fb_dtsg = data.fb_dtsg;
    if (data.kind === "uid" && data.uid) creds.uid ||= data.uid;
    if (data.kind !== "graphql") return;
    if (!/AppCollection|Friends|friendship_status/.test(`${data.body || ""}${data.response || ""}`)) return;
    parseGraphqlPayloads(data.response || "").forEach(collectUsers);
    queueCardScan();
  }

  function identitiesInside(element) {
    const identities = new Map();
    element.querySelectorAll('a[href]').forEach(anchor => {
      const identity = profileIdentity(anchor.href);
      if (identity) identities.set(identity.key, identity);
    });
    return identities;
  }

  function findFriendCard(anchors, identity) {
    let node = anchors[0]?.parentElement;
    let candidate = null;
    for (let depth = 0; node && depth < 11 && node !== document.body; depth++, node = node.parentElement) {
      if (node.id === "cms-unfriender-controls") break;
      if (!anchors.some(anchor => anchor !== anchors[0] && node.contains(anchor))) continue;
      const identities = identitiesInside(node);
      if (identities.size > 1) break;
      if (identities.size !== 1 || !identities.has(identity.key)) continue;
      const image = anchors.map(link => link.querySelector("img")).find(Boolean) || node.querySelector("img");
      const rect = node.getBoundingClientRect();
      if (image && rect.width >= 180 && rect.height >= 52 && rect.height <= 300) candidate = node;
    }
    return candidate;
  }

  function displayName(card, key) {
    const names = [...card.querySelectorAll('a[href]')]
      .filter(anchor => profileIdentity(anchor.href)?.key === key && anchor.getAttribute("aria-hidden") !== "true")
      .map(anchor => anchor.textContent.trim())
      .filter(Boolean);
    return names.sort((a, b) => b.length - a.length)[0] || "Facebook friend";
  }

  function addSelector(card, profile) {
    if (card.querySelector(":scope > .cms-friend-selector")) return;
    card.classList.add("cms-friend-card");
    card.dataset.cmsProfileKey = profile.key;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cms-friend-selector";
    button.setAttribute("aria-label", `Select ${profile.name}`);
    button.setAttribute("aria-pressed", selected.has(profile.key) ? "true" : "false");
    button.title = `Select ${profile.name}`;
    button.textContent = "✓";
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      if (unfriending) return;
      if (selected.has(profile.key)) selected.delete(profile.key);
      else selected.add(profile.key);
      refreshSelectionStyles();
      updateControls();
    }, true);
    card.prepend(button);
  }

  function scanFriendCards() {
    if (!isOwnFriendsPage()) return;
    harvestFromPageBlobs();
    const groupedAnchors = new Map();
    document.querySelectorAll('a[href]').forEach(anchor => {
      const identity = profileIdentity(anchor.href);
      if (!identity) return;
      const group = groupedAnchors.get(identity.key) || { identity, anchors: [] };
      group.anchors.push(anchor);
      groupedAnchors.set(identity.key, group);
    });
    groupedAnchors.forEach(({ identity, anchors }) => {
      if (anchors.length < 2) return;
      const card = findFriendCard(anchors, identity);
      if (!card) return;
      const metadata = friendIndex.get(identity.key) || (identity.id ? friends.get(identity.id) : null);
      const profile = {
        key: identity.key,
        id: identity.id || metadata?.id || null,
        name: metadata?.name || displayName(card, identity.key),
        url: metadata?.url || identity.url
      };
      knownProfiles.set(identity.key, { ...(knownProfiles.get(identity.key) || {}), ...profile });
      addSelector(card, profile);
    });
    refreshSelectionStyles();
    updateControls();
  }

  function queueCardScan() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(() => {
      scanQueued = false;
      scanFriendCards();
    });
  }

  function refreshSelectionStyles() {
    document.querySelectorAll(".cms-friend-card").forEach(card => {
      const key = card.dataset.cmsProfileKey;
      const isSelected = selected.has(key);
      card.classList.toggle("cms-selected", isSelected);
      card.querySelector(":scope > .cms-friend-selector")?.setAttribute("aria-pressed", String(isSelected));
    });
  }

  function setStatus(message, kind = "") {
    if (!shadow) return;
    const status = shadow.getElementById("status");
    status.textContent = message;
    status.dataset.kind = kind;
  }

  function closePrompt() {
    if (!shadow) return;
    shadow.getElementById("promptBackdrop").hidden = true;
    shadow.getElementById("reviewPrompt").hidden = true;
    shadow.getElementById("upgradePrompt").hidden = true;
  }

  async function showReviewPrompt(done) {
    const stored = await chrome.storage.local.get(REVIEW_OPENED_KEY);
    if (stored[REVIEW_OPENED_KEY]) return;
    shadow.getElementById("reviewCount").textContent = String(done);
    shadow.getElementById("promptBackdrop").hidden = false;
    shadow.getElementById("reviewPrompt").hidden = false;
  }

  function showUpgradePrompt(done) {
    shadow.getElementById("upgradeCount").textContent = String(done);
    shadow.getElementById("licenseMessage").textContent = "";
    shadow.getElementById("promptBackdrop").hidden = false;
    shadow.getElementById("upgradePrompt").hidden = false;
  }

  function stopLicensePolling() {
    if (!licensePoll) return;
    clearInterval(licensePoll);
    licensePoll = null;
  }

  function startLicensePolling() {
    stopLicensePolling();
    licensePoll = setInterval(async () => {
      const response = await chrome.runtime.sendMessage({ type: "CHECK_LICENSE" }).catch(() => null);
      if (!response?.license?.active) return;
      stopLicensePolling();
      shadow.getElementById("licenseMessage").textContent = "CleanMySocial unlocked. You can now remove all selected friends.";
      setTimeout(closePrompt, 900);
    }, 4000);
  }

  function updateControls() {
    if (!shadow) return;
    const validSelected = [...selected].filter(key => knownProfiles.has(key));
    shadow.getElementById("counts").textContent = `${knownProfiles.size} loaded · ${validSelected.length} selected`;
    const everySelected = knownProfiles.size > 0 && [...knownProfiles.keys()].every(key => selected.has(key));
    shadow.getElementById("selectAll").disabled = unfriending || knownProfiles.size === 0 || everySelected;
    shadow.getElementById("deselectAll").disabled = unfriending || validSelected.length === 0;
    shadow.getElementById("unfriend").disabled = unfriending || validSelected.length === 0;
    const loadButton = shadow.getElementById("loadAll");
    loadButton.disabled = loadingAll || unfriending;
    loadButton.textContent = loadingAll ? "Loading…" : "Load all";
    shadow.getElementById("stop").hidden = !loadingAll && !unfriending;
  }

  function installPageStyle() {
    if (pageStyle?.isConnected) return;
    pageStyle = document.createElement("style");
    pageStyle.id = "cms-unfriender-page-style";
    pageStyle.textContent = `
      .cms-friend-card { position: relative !important; transition: box-shadow .15s ease, background-color .15s ease !important; }
      .cms-friend-card.cms-selected { box-shadow: inset 0 0 0 3px #1877f2 !important; background: rgba(24,119,242,.08) !important; border-radius: 12px !important; }
      .cms-friend-selector { position: absolute !important; z-index: 999 !important; top: 8px !important; left: 8px !important; width: 30px !important; height: 30px !important; border: 2px solid #1877f2 !important; border-radius: 9px !important; background: #fff !important; color: transparent !important; font: 800 18px/26px Arial,sans-serif !important; cursor: pointer !important; box-shadow: 0 2px 8px rgba(0,0,0,.22) !important; }
      .cms-friend-selector[aria-pressed="true"] { color: #fff !important; background: #1877f2 !important; }
      .cms-friend-card.cms-unfriended { opacity: .48 !important; }
      .cms-friend-card.cms-unfriend-failed { box-shadow: inset 0 0 0 3px #e0245e !important; }
    `;
    document.documentElement.appendChild(pageStyle);
  }

  function installControls() {
    if (host?.isConnected) return;
    installPageStyle();
    host = document.createElement("div");
    host.id = "cms-unfriender-controls";
    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .panel { position: fixed; right: 22px; bottom: 22px; z-index: 2147483647; width: min(390px, calc(100vw - 32px)); padding: 15px; border: 1px solid rgba(255,255,255,.14); border-radius: 16px; background: #18191a; color: #f5f6f7; box-shadow: 0 14px 44px rgba(0,0,0,.38); font: 14px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
        .top { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }
        .brand { font-size:15px; font-weight:800; } .brand i { color:#2d88ff; font-style:normal; }
        #counts { color:#b0b3b8; font-size:12px; white-space:nowrap; }
        .actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
        button { min-height:40px; border:0; border-radius:10px; padding:8px 11px; background:#3a3b3c; color:#f5f6f7; font:700 13px/1.2 inherit; cursor:pointer; }
        button:hover:not(:disabled) { filter:brightness(1.14); } button:disabled { opacity:.45; cursor:not-allowed; }
        #unfriend { background:#e0245e; } #loadAll { background:#2374e1; }
        #stop { grid-column:1/-1; background:transparent; border:1px solid #5c5d5e; }
        #status { min-height:18px; margin-top:10px; color:#b0b3b8; font-size:12px; }
        #status[data-kind="error"] { color:#ff8fa8; } #status[data-kind="success"] { color:#74d88a; }
        [hidden] { display:none !important; }
        .backdrop { position:fixed; inset:0; z-index:2; display:grid; place-items:center; padding:18px; background:rgba(0,0,0,.62); }
        .prompt { width:min(340px,calc(100vw - 48px)); padding:20px; border:1px solid rgba(255,255,255,.15); border-radius:16px; background:#242526; box-shadow:0 20px 60px rgba(0,0,0,.5); text-align:center; }
        .prompt h2 { margin:0 0 8px; font-size:20px; } .prompt p { margin:0 0 14px; color:#d5d7da; }
        .prompt .primary { width:100%; background:#2374e1; } .prompt .secondary { width:100%; margin-top:8px; background:transparent; border:1px solid #5c5d5e; }
        .prompt input { box-sizing:border-box; width:100%; min-height:40px; margin-top:10px; padding:8px 10px; border:1px solid #5c5d5e; border-radius:9px; background:#18191a; color:#fff; }
        .license-message { min-height:16px; margin-top:8px !important; color:#74d88a !important; font-size:12px; }
      </style>
      <section class="panel" aria-label="CleanMySocial Unfriender controls">
        <div class="top"><span class="brand"><i>●</i> Unfriender</span><span id="counts">0 loaded · 0 selected</span></div>
        <div class="actions">
          <button id="loadAll" type="button">Load all</button>
          <button id="selectAll" type="button" disabled>Select all</button>
          <button id="deselectAll" type="button" disabled>Deselect all</button>
          <button id="unfriend" type="button" disabled>Unfriend selected</button>
          <button id="stop" type="button" hidden>Stop</button>
        </div>
        <div id="status">Select friends directly on this page.</div>
        <div id="promptBackdrop" class="backdrop" hidden>
          <div id="reviewPrompt" class="prompt" role="dialog" aria-modal="true" aria-labelledby="reviewTitle" hidden>
            <h2 id="reviewTitle">Nice work! 🎉</h2>
            <p>You successfully removed <strong id="reviewCount">0</strong> friends. Would you leave CleanMySocial a quick review?</p>
            <button id="leaveReview" class="primary" type="button">Leave a review</button>
            <button class="secondary dismissPrompt" type="button">Maybe later</button>
          </div>
          <div id="upgradePrompt" class="prompt" role="dialog" aria-modal="true" aria-labelledby="upgradeTitle" hidden>
            <h2 id="upgradeTitle">Great start! 🎉</h2>
            <p><strong id="upgradeCount">5</strong> friends were successfully removed. Get the CleanMySocial package to finish your cleanup with unlimited access to all premium tools.</p>
            <button id="buyPackage" class="primary" type="button">Get CleanMySocial</button>
            <input id="licenseInput" type="text" autocomplete="off" placeholder="Already purchased? Enter license key">
            <button id="unlockLicense" class="secondary" type="button">Unlock purchase</button>
            <p id="licenseMessage" class="license-message"></p>
            <button class="secondary dismissPrompt" type="button">Not now</button>
          </div>
        </div>
      </section>
    `;
    document.documentElement.appendChild(host);
    shadow.getElementById("loadAll").addEventListener("click", loadAll);
    shadow.getElementById("selectAll").addEventListener("click", selectAll);
    shadow.getElementById("deselectAll").addEventListener("click", deselectAll);
    shadow.getElementById("unfriend").addEventListener("click", confirmUnfriend);
    shadow.getElementById("stop").addEventListener("click", () => {
      stopRequested = true;
      setStatus("Stopping safely after the current action…");
    });
    shadow.querySelectorAll(".dismissPrompt").forEach(button => button.addEventListener("click", closePrompt));
    shadow.getElementById("leaveReview").addEventListener("click", async () => {
      await chrome.storage.local.set({ [REVIEW_OPENED_KEY]: true });
      await chrome.runtime.sendMessage({ type: "OPEN_REVIEW" });
      closePrompt();
    });
    shadow.getElementById("buyPackage").addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "OPEN_PURCHASE" });
      startLicensePolling();
    });
    shadow.getElementById("unlockLicense").addEventListener("click", async () => {
      const button = shadow.getElementById("unlockLicense");
      const licenseKey = shadow.getElementById("licenseInput").value.trim();
      if (!licenseKey) return;
      button.disabled = true;
      shadow.getElementById("licenseMessage").textContent = "Checking license…";
      const response = await chrome.runtime.sendMessage({ type: "CHECK_LICENSE", licenseKey }).catch(() => null);
      button.disabled = false;
      if (response?.license?.active) {
        shadow.getElementById("licenseMessage").textContent = "CleanMySocial unlocked. You can now remove all selected friends.";
        setTimeout(closePrompt, 900);
      } else {
        shadow.getElementById("licenseMessage").textContent = "That license is not active yet.";
      }
    });
    updateControls();
  }

  function selectAll() {
    for (const key of knownProfiles.keys()) selected.add(key);
    refreshSelectionStyles();
    updateControls();
  }

  function deselectAll() {
    selected.clear();
    refreshSelectionStyles();
    updateControls();
  }

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function loadAll() {
    if (loadingAll || unfriending) return;
    loadingAll = true;
    stopRequested = false;
    updateControls();
    setStatus("Loading all friends… keep this Facebook tab visible.");
    injectPageHook();
    harvestFromPageBlobs();
    let stable = 0;
    let lastHeight = 0;
    let lastCount = 0;
    for (let pass = 0; pass < 400 && !stopRequested; pass++) {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" });
      window.dispatchEvent(new Event("scroll"));
      await sleep(1200);
      harvestFromPageBlobs();
      scanFriendCards();
      const height = document.body.scrollHeight;
      const count = knownProfiles.size;
      setStatus(`Loading all friends… ${count} found so far.`);
      stable = height === lastHeight && count === lastCount ? stable + 1 : 0;
      lastHeight = height;
      lastCount = count;
      if (stable >= 5) break;
    }
    loadingAll = false;
    updateControls();
    setStatus(stopRequested ? `Stopped with ${knownProfiles.size} friends loaded.` : `Loaded ${knownProfiles.size} friends. Select the people you want to remove.`, stopRequested ? "" : "success");
  }

  async function removeFriend(id) {
    const form = new FormData();
    form.append("__a", "1");
    form.append("fb_dtsg", creds.fb_dtsg);
    if (creds.uid) form.append("__user", creds.uid);
    if (creds.jazoest) form.append("jazoest", creds.jazoest);
    form.append("uid", id);
    const response = await fetch("https://www.facebook.com/ajax/profile/removefriendconfirm.php?dpr=1", {
      method: "POST", body: form, credentials: "include"
    });
    const text = await response.text();
    if (/You are not currently friends with/i.test(text)) return { ok: true, already: true };
    let payload = null;
    try { payload = JSON.parse(text.replace(/^for\s*\(;;\);/, "")); } catch {}
    if (!response.ok) return { ok: false, error: payload?.errorSummary || payload?.errorDescription || `HTTP ${response.status}` };
    if (payload) {
      const code = Number(payload.error || 0);
      const error = payload.errorSummary || payload.errorDescription || (Number.isFinite(code) && code !== 0 ? `Facebook error ${code}` : "");
      if (error) return { ok: false, error };
      return { ok: true };
    }
    if (/<!doctype|<html|login_form|checkpoint/i.test(text)) return { ok: false, error: "Facebook returned a sign-in or checkpoint page." };
    return { ok: true };
  }

  function markProfile(key, state) {
    document.querySelectorAll(".cms-friend-card").forEach(card => {
      if (card.dataset.cmsProfileKey !== key) return;
      card.classList.toggle("cms-unfriended", state === "ok");
      card.classList.toggle("cms-unfriend-failed", state === "fail");
    });
  }

  async function confirmUnfriend() {
    if (unfriending || loadingAll) return;
    const profiles = [...selected].map(key => {
      const visible = knownProfiles.get(key);
      const metadata = friendIndex.get(key) || (visible?.id ? friends.get(visible.id) : null);
      return visible ? { ...visible, id: visible.id || metadata?.id || null } : null;
    }).filter(Boolean);
    const resolvable = profiles.filter(profile => /^\d+$/.test(profile.id || ""));
    const unresolved = profiles.length - resolvable.length;
    if (unresolved) {
      setStatus(`${unresolved} selected profile${unresolved === 1 ? "" : "s"} still need an ID. Click Load all, then try again.`, "error");
      return;
    }
    if (!resolvable.length) return;
    const preview = resolvable.slice(0, 5).map(profile => profile.name).join(", ");
    if (!confirm(`Start removing selected friends?\n\n${preview}${resolvable.length > 5 ? "…" : ""}\n\nThis cannot be undone.`)) return;
    const licenseResponse = await chrome.runtime.sendMessage({ type: "GET_LICENSE_STATE" }).catch(() => null);
    const unlimited = Boolean(licenseResponse?.license?.active);
    const limitedBatch = !unlimited && resolvable.length > FREE_SELECTION_THRESHOLD;
    const operationProfiles = resolvable;
    unfriending = true;
    stopRequested = false;
    updateControls();
    const settings = (await chrome.storage.local.get("cms_settings")).cms_settings || {};
    const minDelay = Math.max(1, Number(settings.minDelay) || 20);
    const maxDelay = Math.max(minDelay, Number(settings.maxDelay) || 45);
    let done = 0;
    let failed = 0;
    await waitForCreds();
    for (let index = 0; index < operationProfiles.length && !stopRequested; index++) {
      if (limitedBatch && done >= FREE_REMOVAL_COUNT) break;
      const profile = operationProfiles[index];
      setStatus(`Unfriending ${profile.name}…`);
      let result;
      try { result = await removeFriend(profile.id); }
      catch (error) { result = { ok: false, error: error.message }; }
      if (result.ok) {
        done++;
        selected.delete(profile.key);
        markProfile(profile.key, "ok");
      } else {
        failed++;
        markProfile(profile.key, "fail");
        setStatus(`${profile.name}: ${result.error || "Facebook rejected the request."}`, "error");
      }
      refreshSelectionStyles();
      updateControls();
      if (index < operationProfiles.length - 1 && !stopRequested && !(limitedBatch && done >= FREE_REMOVAL_COUNT)) {
        const delay = Math.round((minDelay + Math.random() * (maxDelay - minDelay)) * 1000);
        await sleep(delay);
      }
    }
    unfriending = false;
    updateControls();
    const completedNormally = !stopRequested && done > 0;
    setStatus(`${stopRequested ? "Stopped." : "Congratulations!"} ${done} friend${done === 1 ? "" : "s"} successfully removed${failed ? ` · ${failed} failed` : ""}.`, failed ? "error" : "success");
    if (completedNormally && limitedBatch && done >= FREE_REMOVAL_COUNT) showUpgradePrompt(done);
    else if (completedNormally && resolvable.length <= FREE_SELECTION_THRESHOLD) showReviewPrompt(done);
  }

  function activateOnFriendsPage() {
    if (!isOwnFriendsPage()) return;
    installControls();
    injectPageHook();
    harvestFromPageBlobs();
    queueCardScan();
    if (!observer) {
      observer = new MutationObserver(queueCardScan);
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  // Activation is per-tab. The flag lives in sessionStorage, which is scoped to
  // this one tab and survives same-origin reloads/navigations (including the one
  // we trigger to reach the friends page) — but is never shared with other tabs.
  // Without it, content.js stays dormant, so the panel only appears in the tab
  // the user launched from, not on every open Facebook tab.
  const ACTIVATION_KEY = "cms_unfriender_active";
  let activationInterval = null;

  function isActivated() {
    try { return sessionStorage.getItem(ACTIVATION_KEY) === "1"; } catch { return false; }
  }

  function beginActivation() {
    try { sessionStorage.setItem(ACTIVATION_KEY, "1"); } catch {}
    activateOnFriendsPage();
    if (!activationInterval) {
      // Re-activate after Facebook's client-side navigation lands on the friends page.
      activationInterval = setInterval(() => {
        if (isOwnFriendsPage()) activateOnFriendsPage();
      }, 1000);
    }
  }

  async function openSelector() {
    if (isOwnFriendsPage()) {
      beginActivation();
      return { ok: true };
    }
    // Persist the flag first, so after the navigation reload we re-activate.
    try { sessionStorage.setItem(ACTIVATION_KEY, "1"); } catch {}
    await waitForCreds();
    location.href = `https://www.facebook.com/${creds.uid}/friends_all`;
    return { ok: true, navigating: true };
  }

  window.addEventListener("message", onInjectedMessage);
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === "OPEN_FRIEND_SELECTOR") {
      openSelector().then(respond).catch(error => respond({ ok: false, error: error.message }));
      return true;
    }
    return false;
  });

  readCredsFromPage();
  // Only resume if this tab was previously activated by the user.
  if (isActivated()) beginActivation();
})();
