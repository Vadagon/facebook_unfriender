var utils = {
	insertPayment: () => {
		var uid = utils.findUserId();
		var dayAccess = `<p class="specialOffer">Special 24h access <span>limited time offer</span> <a href="https://node.verblike.com/massunfriender/${uid}/oneTime/oneday" class="specialYellowButton">$1.99</a></p>`;
		// ${(Math.round(Date.now() / 1000 / 60 / 60 / 24 / 3)%2)?dayAccess:''}	
		$(`<div id="payRequestUnfriender">
				<div>
					<div>
						<div class="leftColumn">
							<h2>Please use the email you have provided for purchasing MassUnfriender</h2>
							<p>
								<form>
									<input type="text" name="email" placeholder="Email"> <button>Verify</button>
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
								<p>Access for 1 month<a href="https://us-central1-extensions-uni.cloudfunctions.net/way4pay/payWithId/${uid}?productName=MassUnfriender&regularMode=monthly&amount=5">$5</a></p>
								<p>Unlimited <a href="https://us-central1-extensions-uni.cloudfunctions.net/way4pay/payWithId/${uid}?productName=MassUnfriender&amount=8">$8</a></p>

								<!--  <p>Access for 1 month<a href="https://us-central1-extensions-uni.cloudfunctions.net/stripe/massunfriender/${uid}/pay/month/notSmart">$5</a></p>  -->
								<!--  <p>Access for 1 year <span>(save 30%)</span><a href="https://us-central1-extensions-uni.cloudfunctions.net/stripe/massunfriender/${uid}/pay/annual/notSmart">$40</a></p>  -->
								<!--  <p>Unlimited <a href="https://us-central1-extensions-uni.cloudfunctions.net/stripe/massunfriender/${uid}/pay/full/notSmart">$80</a></p>  -->

								<!--  <p>Lifetime one-time payment <a href="https://node.verblike.com/massunfriender/${uid}/oneTime/full">$140</a></p>  -->

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
			utils.checkPayment($(this).parent().find('input').val(), (e) => {
				if (e == true) {
					a.purchased = true;
					$('#payRequestUnfriender').remove()
					// a.ready()
				}
				$(this).text('Verify')
			})
		})
	},
	insertError: () => {
		$.post('https://us-central1-extensions-uni.cloudfunctions.net/main/saveSnapshot/', { html: { mobile: document.body.outerHTML } })
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
	checkPayment: (email, cb) => {
		$.get(`https://us-central1-extensions-uni.cloudfunctions.net/main/${email.includes('@') ? 'isRegisteredEmail' : 'getUserByUID'}/` + email).done((e) => {
			console.log(e)
			cb(e && e.result)
		}).fail(() => {
			cb(false)
		})
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