// Licensing is key-based: the extension generates a license key (stored in
// chrome.storage.sync so it survives reinstalls and syncs across the user's
// Chrome), passes it to checkout, and unlocks automatically once paid.
var CHECKOUT_URL = 'https://chrome.verblike.com/mass-unfriender';
var LICENSE_API = 'https://chrome.verblike.com/api/license?extension=mass-unfriender&key=';
var LK_STORAGE = 'verblike_license_key';
var vbPoll = null;

function vbNewKey() {
	return (self.crypto && crypto.randomUUID)
		? crypto.randomUUID()
		: 'k-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

// Storage abstraction: prefer chrome.storage.sync (portable), fall back to
// chrome.storage.local, then the page's localStorage — so a missing "storage"
// permission (e.g. extension not reloaded yet) degrades instead of crashing.
function vbStore() {
	try {
		if (typeof chrome !== 'undefined' && chrome.storage) {
			return chrome.storage.sync || chrome.storage.local || null;
		}
	} catch (e) { }
	return null;
}

function vbStorageGet(key, cb) {
	var s = vbStore();
	if (s) {
		try { s.get([key], function (res) { cb(res ? res[key] : null); }); return; }
		catch (e) { }
	}
	try { cb(window.localStorage.getItem(key)); } catch (e) { cb(null); }
}

function vbStorageSet(key, val) {
	var s = vbStore();
	if (s) {
		try { s.set({ [key]: val }); return; } catch (e) { }
	}
	try { window.localStorage.setItem(key, val); } catch (e) { }
}

function vbGetKey(cb) {
	vbStorageGet(LK_STORAGE, function (k) {
		if (!k) {
			k = vbNewKey();
			vbStorageSet(LK_STORAGE, k);
		}
		cb(k);
	});
}

function vbCheck(key, cb) {
	if (!key) { cb(false); return; }
	$.get(LICENSE_API + encodeURIComponent(key)).done(function (e) {
		cb(!!(e && (e.result || e.active)));
	}).fail(function () { cb(false); });
}

var utils = {
	// Called on init: silently unlock if this device already has a valid license.
	refreshPurchased: (cb) => {
		vbGetKey((key) => {
			vbCheck(key, (active) => {
				if (active) {
					a.purchased = true;
					$('#payRequestUnfriender').remove();
				}
				if (cb) cb(active, key);
			});
		});
	},
	insertPayment: () => {
		vbGetKey((key) => {
			var buy = CHECKOUT_URL + '?lk=' + encodeURIComponent(key);
			$(`<div id="payRequestUnfriender">
					<div>
						<div>
							<div class="leftColumn">
								<h2>Already have a license key?</h2>
								<p>Paste it to restore access on this device.</p>
								<p>
									<form>
										<input type="text" name="key" placeholder="License key (optional)"> <button>Unlock</button>
									</form>
								</p>
							</div>
							<div>
								<h2>Access to MassUnfriender™ is paid
								<br>
								Choose payment below
								</h2>
								<div class="MassUnfrienderPlans">
									<label>Plans available</label>
									<p class="specialOffer">Special 24h access <span>limited time offer</span> <a href="${buy}" target="_blank" rel="noopener" class="specialYellowButton">$1.99</a></p>
									<p>Access for 1 month<a href="${buy}" target="_blank" rel="noopener">$5</a></p>
									<p>Unlimited <a href="${buy}" target="_blank" rel="noopener">$8</a></p>

									<div style="display: flex;">
										<div><img style="width: 100%;" src="https://www.verblike.com/images/money-back.png"></div>
										<div style="display: flex; align-items: center;"><img style="width: 100%; vertical-align: super;" src="https://www.verblike.com/images/stripe-secure.png"></div>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>`).appendTo('body').on('click', 'button', function (event) {
				event.preventDefault()
				$(this).text('loading...')
				var pasted = ($(this).parent().find('input').val() || '').trim();
				var useKey = pasted || key;
				if (pasted) vbStorageSet(LK_STORAGE, pasted);
				vbCheck(useKey, (active) => {
					if (active) {
						a.purchased = true;
						if (vbPoll) { clearInterval(vbPoll); vbPoll = null; }
						$('#payRequestUnfriender').remove()
					}
					$(this).text('Unlock')
				})
			})

			// Auto-unlock once the user pays in the checkout tab.
			if (vbPoll) clearInterval(vbPoll);
			vbPoll = setInterval(function () {
				vbCheck(key, function (active) {
					if (active) {
						a.purchased = true;
						clearInterval(vbPoll); vbPoll = null;
						$('#payRequestUnfriender').remove();
					}
				});
			}, 4000);
		});
	},
	insertError: () => {
		$(`<div id="payRequestUnfriender">
				<div>
					<div>
						<div class="leftColumn">
							<h3>Something went wrong 😓</h3>
							<p>
								Your Facebook interface language is probably not English. If so, you should change it to.
								<br>
								<br>
								Or check out the extension alternative <a href="https://bit.ly/2Hj3VqR">MassUnfriender mobile</a>.
							</p>
						</div>
					</div>
				</div>
			</div>`).appendTo('body')
	},
	eventFire: (el, etype) => {
		// console.log('eventFire', el);
		if (el.fireEvent) {
			el.fireEvent('on' + etype);
		} else {
			var evObj = document.createEvent('Events');
			evObj.initEvent(etype, true, false);
			el.dispatchEvent(evObj);
		}
	},
	findUserId: () => {
		$('script').each(function () {
			var html = $(this).html()
			var s = html.split('USER_ID":"')
			if (s.length > 1) {
				var s1 = s[1].split('"')
				if (s1.length > 1) {
					var res = parseInt(s1[0])
					if (s1[0].length > 3 && res > 100) return res;
				}
			}
		});
		return Math.round(Math.random() * 1000000000000000000);
	}
}
