# CleanMySocial — Unfriender

A local-only Chrome extension that adds friend-selection controls directly to
your own Facebook Friends page. There is no separate collection table.

## Install

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this folder.
3. Log in to Facebook and click the extension toolbar icon.

The extension opens or focuses Facebook's Friends page and shows a floating
control panel.

## Use

1. Click the checkbox on each friend card you want to remove, or use **Select all**.
2. Use **Load all** to scroll through and render the rest of the friends list.
3. Click **Unfriend selected**, review the confirmation, and confirm.
4. **Stop** safely ends loading or unfriending after the current operation.

Facebook may rate-limit rapid changes, so unfriending uses a conservative random
20–45 second delay by default. Existing `cms_settings` in extension storage can
override the minimum and maximum delay.

## Access and licensing

The extension follows the shared CleanMySocial license contract. It creates an
anonymous UUID in Chrome sync under `verblike_license_key`, validates it against
`https://cleanmysocial.verblike.com/api/license?extension=cleanmysocial`, and
passes the same key to checkout. A confirmed license is cached locally under
`mass_unfriender_license_cache` for five minutes.

Large free removal batches stop after a short sample and then offer the lifetime
CleanMySocial package. Paid users can process the full selected batch. Checkout
is polled every four seconds after it opens, and an existing license key can be
entered in the upgrade prompt to restore access on another browser.

After a successful standard-size batch, the extension congratulates the user
and offers an optional Chrome Web Store review. It stores only whether the review
page was opened, under `mass-unfriender-review-opened`, to avoid repeated prompts.

## Stability approach

- Friend cards are detected from repeated Facebook profile URLs, an avatar, and
  the surrounding card structure.
- The extension does not depend on translated labels or Facebook's generated CSS
  class names, so different Facebook languages are supported.
- Username, numeric `profile.php`, `/people/.../ID`, and numeric-path profile URLs
  are normalized.
- Selection is keyed by profile rather than DOM nodes, so it survives Facebook's
  React re-renders while scrolling.
- Numeric friend IDs are learned from the JSON and GraphQL data Facebook already
  loads for its own Friends page.

## Privacy

Friend-list processing and unfriend requests run locally in the browser using
the signed-in Facebook session. No friend list or Facebook personal data is sent
to a CleanMySocial server. Only the anonymous license key is sent to the
CleanMySocial license endpoint for purchase validation.

## Files

| File | Role |
| --- | --- |
| `content.js` | Runs on facebook.com. Detects friend cards, renders the shadow-DOM control panel, resolves numeric ids, and performs the unfriend calls. |
| `inject.js` | Runs in the page's main world; captures the friend data Facebook's own UI fetches over GraphQL. |
| `background.js` | Opens/focuses the Friends page, validates the shared license, and opens checkout or the review page after explicit user actions. |
| `manifest.json` | MV3 config. Permissions: `storage`, `tabs`; hosts: Facebook and the CleanMySocial license site. |
