# Mass Unfriender for Facebook

A Chrome extension (Manifest V3) that lets you **unfriend people on Facebook in
bulk** from your desktop — select many friends at once and remove them, instead
of clicking through profiles one by one.

Chrome Web Store:
<https://chromewebstore.google.com/detail/mass-unfriender-for-faceb/imobgpikmofiapbnijmebknbkmkncdkl>

> **Note:** this is the same project as **Mass Friends Remover for Facebook**
> (a separate store listing built for a different Facebook UI, maintained on
> another branch). They share the same Paddle product and license, so one
> purchase unlocks either.

## What it does

- Adds selectable checkboxes to your Facebook friends list.
- **Select All / Load all friends** helpers, then **Unfriend N friends** removes
  the selected people in bulk with randomized timing.
- Runs entirely in your own logged-in browser session.

## How to use

1. Open your Facebook friends list (`facebook.com/friends/list`).
2. Click the toolbar icon → **Remove**.
3. Select the friends to remove (or **Select All**), then click
   **Unfriend N friends**.
4. If not yet unlocked, a plans panel appears; once licensed, removal proceeds.

## Licensing (Paddle)

Paid access is handled by **[chrome.verblike.com](https://chrome.verblike.com)**
with Paddle as Merchant of Record. It's **key-based and auto-unlocking**:

- On first run the extension generates a **license key** stored in
  `chrome.storage.sync` (survives reinstalls, syncs across the user's Chrome).
- On load it silently checks the license (`utils.refreshPurchased()`), so paying
  users never see the paywall.
- The plans panel opens checkout at `chrome.verblike.com/mass-unfriender?lk=<key>`;
  after payment the extension **polls `/api/license` and unlocks automatically**.
- The success page shows the key as a restore code; paste it into the panel to
  restore access on another browser/computer.

Plans: **$1.99 (24-hour)**, **$5/month**, or **$8 unlimited** (one-time). Because
the license is shared with Mass Friends Remover, either extension checks access
with `extension=mass-unfriender`.

## How it works (code)

Injected into the friends-list tab from the popup
(`src/browser_action/popup.js` → `chrome.scripting.executeScript`):

| File | Role |
| --- | --- |
| `inject/main.js` | UI + selection + bulk-unfriend logic; gated on `a.purchased` |
| `inject/utils.js` | Licensing: key generation/storage, `insertPayment()` plans panel, auto-unlock polling, restore |
| `inject/main.css` | Injected styles |
| `src/browser_action/` | Toolbar popup that injects the content scripts |
| `js/` | Bundled jQuery + webextension-polyfill |
| `_locales/` | Localized strings |
| `manifest.json` | MV3; permissions: `activeTab`, `scripting`, `storage`; host: `chrome.verblike.com` |

## Privacy

The extension acts only on actions you initiate in your own session. It does not
collect or transmit your friend list. The only network call is an anonymous
license check keyed by the random license key (no personal data).
