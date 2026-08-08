# CleanMySocial — Unfriender

A Chrome extension that bulk-removes Facebook friends from a side panel. There
is no popup and no on-page overlay: clicking the toolbar icon opens the side
panel directly, and the friends list is loaded into the panel itself.

## Install

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this folder.
3. Sign in to Facebook and click the extension toolbar icon.

## Use

1. The panel confirms your Facebook session and then loads the **whole** friends
   list by itself, page after page, showing how many have arrived so far.
2. Narrow the list with the search box (`/` focuses it) and the **Mutual**,
   **Non-mutual**, **No photo** and **Name A→Z** chips.
3. **Select all** ticks everything currently shown — the filters and the search
   decide what that is.
4. Pick **Slow** or **Normal** pacing.
5. Press **Unfriend selected**, confirm, and watch the batch run. **Stop** ends
   it after the removal in flight.

The counter reads *shown / loaded*. **Export** downloads the friends you have
ticked as CSV — including ones the active filter is hiding — and the round
**reload** button throws the saved copy away and pulls the list again from
Facebook.

## Loading, saving and resuming

Loading is automatic and self-healing, because a list of a few thousand friends
is many requests and any of them can fail:

- Pages are requested one at a time with a short pause between them.
- A failed page is retried on a growing backoff (5s, 15s, then 45s, up to six
  attempts) with a countdown in the loading strip, instead of giving up. Rows
  already loaded stay on screen throughout.
- The list, the pagination cursor and whether more remain are saved to
  `chrome.storage.local` under `cms_unfriender_friends_cache`, keyed to the
  signed-in account id so another profile never sees this one's list.
- Reopening the panel shows the saved list immediately and makes **no** network
  request when the list was complete. If it was cut short — panel closed, browser
  quit, connection lost — loading continues from the saved cursor by itself.
- A removal batch pauses loading (two request streams would share one rate
  limit) and loading resumes on its own once the batch finishes.

Removals are written back to the saved copy, so the count stays honest between
sessions. The saved list is friend names, profile URLs and avatar URLs; it stays
on the device, and the reload button clears it.

A countdown shows the wait before each next removal, and the batch progress bar
tracks how far along the selection is. After a batch that removed at least one
friend, the panel congratulates the user with a summary and offers a Chrome Web
Store review; the review prompt appears once per install and is tracked under
`mass-unfriender-review-opened`.

## Speeds

| Speed | Delay between removals | Plan |
| --- | --- | --- |
| Slow 🐢 | 16s | Free |
| Normal 🚶 | 8s | Free |
| Fast 🐇 | 3s | Unlimited upgrade |
| Ultra 🚀 | 1s | Unlimited upgrade |

Fast and Ultra are visible but locked for free users; selecting one opens the
upgrade prompt instead of changing the setting. **Export** writes the ticked
friends to CSV; on the free plan a selection over 20 opens the upgrade prompt
instead of exporting, with no inline message either way. A batch never runs at a locked
speed even if a licence lapsed after that speed was chosen — the panel falls
back to Slow. The choice is stored in `chrome.storage.local` under
`cms_unfriender_settings`.

## Access and licensing

The extension follows the shared CleanMySocial licence contract described in
`../PAYMENT.md`. It creates an anonymous UUID in Chrome sync under
`verblike_license_key`, validates it against
`https://cleanmysocial.verblike.com/api/license?extension=mass-unfriender` —
naming this extension rather than the shared `cleanmysocial` group, so licences
bought for other tools do not unlock it — and passes the same key to checkout as
`?lk=`. A confirmed licence is cached in `chrome.storage.local` under
`mass_unfriender_license_cache` for five minutes; a licence-server outage
preserves an already-confirmed licence but never promotes a new or inactive key.

**Free plan: 20 removals per local calendar day**, at Slow or Normal speed.
Usage lives in `chrome.storage.local` under `mass_unfriender_daily_usage` as
`{ "date": "2026-08-08", "count": 4 }` and resets when the stored date stops
matching today. Only a removal Facebook confirmed is counted, so failed or
stopped work never burns a free slot, and the counter is updated through a
serialised queue in the service worker so concurrent calls cannot share a slot.
The quota is checked before every single removal, so a batch larger than the
remaining allowance stops at exactly the limit and shows the upgrade prompt.
Paid users bypass the quota and unlock all four speeds.

Checkout is polled every four seconds after it opens, and an existing licence
key can be pasted into the upgrade prompt to restore access on another browser.

As noted in `PAYMENT.md`, the daily quota is a product-experience limit, not
tamper-proof billing enforcement.

## How the friends list works

The service worker talks to Facebook's own GraphQL endpoint with the signed-in
cookies:

- `FriendingCometFriendsListPaginationQuery` pages through `viewer.all_friends`,
  30 friends per request.
- `FriendingCometUnfriendMutation` performs each removal, and the response's
  `friendship_status` is what decides success.

The `fb_dtsg` token comes from an open Facebook tab when there is one (read from
the page's `DTSGInitialData` in the main world) and otherwise from a small
logged-in Facebook page fetched in the background, so no Facebook tab has to be
open. A `declarativeNetRequest` session rule rewrites `Origin` and `Referer` on
the extension's own GraphQL requests, which Facebook would otherwise reject; the
rule is scoped to `tabIds: [-1]`, so requests from the user's own tabs are
untouched.

Because the removal loop runs in the panel, closing the side panel stops a batch
after the removal in flight.

## When Facebook changes something

The GraphQL document ids are Facebook's and can change. When a request comes
back in a shape the extension does not recognise, the panel shows a plain-language
notice — Facebook changed how its pages work, it is not the user's account or
computer, and the extension needs a small update — with a **Tell the developer**
button. The notice clears itself as soon as a load succeeds again.

The button posts to `POST /api/report` on the website, which emails the developer
address (`REPORT_EMAIL`, default `verbalike@gmail.com`) over the existing SMTP
transport in `lib/mail.ts`. It is silent for the user: no mail client, no form,
nothing to fill in — just "the developer has been notified", or an invitation to
retry if the request failed.

The payload is only the extension slug, a failure code from a closed list, the
extension version and the UI language. There is no free-text field anywhere in
it, so no friend data, licence key or Facebook id can travel even by accident.
The endpoint deduplicates on extension + failure code for an hour, so a
Facebook-side change that breaks the extension for everyone at once produces one
email rather than thousands.

Failures the user can fix themselves — signed out, unreadable session — show
guidance instead and never offer the report button.

## Privacy

Friend loading and removals run locally in the browser using the signed-in
Facebook session. No friend list or Facebook personal data is sent to a
CleanMySocial server. Only the anonymous licence key is sent to the licence
endpoint, and only a failure code when the user presses the report button.

The friends list is cached on the device under `cms_unfriender_friends_cache` so
the panel does not have to refetch thousands of friends on every open. It holds
names, profile URLs and avatar URLs, never leaves the browser, and is cleared by
the reload button.

## Files

| File | Role |
| --- | --- |
| `background.js` | Service worker: Facebook session and GraphQL calls, friends pagination, the unfriend mutation, licence checks, the daily quota, and opening checkout / the review page. |
| `sidepanel.html` / `sidepanel.css` / `sidepanel.js` | The whole interface: session state, automatic list loading with retry and resume, the local copy, search/filters/sort/export, selection, speed picker, batch loop with countdown, quota and upgrade prompts, completion congratulations. |
| `manifest.json` | MV3 config. Permissions: `storage`, `tabs`, `sidePanel`, `scripting`, `cookies`, `declarativeNetRequest`; hosts: Facebook and the CleanMySocial licence site. |
| `_locales/` | UI and store strings in 21 languages. |
