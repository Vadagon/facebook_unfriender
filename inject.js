// CleanMySocial — Unfriender : page hook (runs in the page's MAIN world)
//
// content.js lives in an isolated world, so its `fetch` is a different object from the page's.
// To read the friends data that Facebook's own UI fetches, we must hook the page's real fetch
// and XHR. We forward every GraphQL request/response to content.js via window.postMessage.
// This is read-only observation of the page's own traffic — we never originate requests here.

(function () {
  if (window.__cmsInjected) return;
  window.__cmsInjected = true;

  const RELAY = "/api/graphql";

  function post(kind, payload) {
    try {
      window.postMessage({ source: "CMS_INJECT", kind, ...payload }, "*");
    } catch (_) {}
  }

  function bodyToString(body) {
    if (typeof body === "string") return body;
    if (body instanceof URLSearchParams) return body.toString();
    return "";
  }

  // Pull fb_dtsg out of any GraphQL body so content.js always has a fresh token.
  function maybeToken(bodyStr) {
    const m = /(?:^|&)fb_dtsg=([^&]+)/.exec(bodyStr);
    if (m) post("token", { fb_dtsg: decodeURIComponent(m[1]) });
    const u = /(?:^|&)__user=(\d+)/.exec(bodyStr);
    if (u) post("uid", { uid: u[1] });
  }

  // ---- fetch --------------------------------------------------------------
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input && input.url;
    const isGql = url && url.indexOf(RELAY) !== -1;
    let bodyStr = "";
    if (isGql) {
      bodyStr = bodyToString(init && init.body);
      maybeToken(bodyStr);
    }
    const p = origFetch.apply(this, arguments);
    if (isGql) {
      p.then((res) => {
        try {
          res.clone().text().then((text) => {
            post("graphql", { url, body: bodyStr, response: text });
          }).catch(() => {});
        } catch (_) {}
      }).catch(() => {});
    }
    return p;
  };

  // ---- XMLHttpRequest -----------------------------------------------------
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__cmsUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const url = this.__cmsUrl;
    if (url && url.indexOf(RELAY) !== -1) {
      const bodyStr = bodyToString(body);
      maybeToken(bodyStr);
      this.addEventListener("load", function () {
        try {
          post("graphql", { url, body: bodyStr, response: this.responseText });
        } catch (_) {}
      });
    }
    return origSend.apply(this, arguments);
  };

  post("ready", {});
})();
