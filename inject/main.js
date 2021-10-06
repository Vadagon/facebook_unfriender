var a = {
	purchased: false,
	preSelected: 4,
	selected: 0,
	creds: {},
	selector: '#friends_center_main > div',
	ul: '',
	init: function(e){
        browser.runtime.sendMessage({event: 'content', what: 'inited '+e})
		a.ul = $(a.selector + '   > div     div > a > i').parent().parent().parent().parent().eq(0)
		console.log(a.ul.children().length)
		if(!a.ul.children().length){
			if(e){
				insertError()
			}else{
				alert('An error occured ... Let\'s try again in 5 seconds');
				setTimeout(function() {
					console.log('secondTimeInit')
					a.init(true)
				}, 4000);
			}
			return;
		}
		if(!a.purchased) return insertPayment()
		a.ready()
	},
	ready: ()=>{
		if($('#extensionExpertControls').length) return;
        browser.runtime.sendMessage({event: 'content', what: 'isReady'})
		setInterval(()=>{
			if(!a.extraEnabled) a.ul = $(a.selector);
			a.ul.children('div > div:not(.extensionExpertFriendBoxBinded)').each(function(){
				$(this).addClass('extensionExpertFriendBoxBinded').find('div > a > i').addClass('positionRelativeExtension').append('<div class="extensionExpertFriendBox" selected="false">✔</div>')
				$(this).append('<div class="extensionExpertFriendBoxBindedScreen"></div>')
				var that = this;
				$(this).find('.extensionExpertFriendBoxBindedScreen').click(function(event){
					if(!$(this).data('selected')){
						$(this).data('selected', true)
						a.selected++;
					}else{
						$(this).data('selected', false)
						a.selected--;
					}
					a.updateButtons()
					event.preventDefault();
                    event.stopPropagation();
                    $(that).find('.extensionExpertFriendBox').toggle()
				})
				if(a.preSelected > 0){
					a.preSelected--;
					$(this).find('.extensionExpertFriendBoxBindedScreen').click();
				}
			})
		}, 300)
		// var right = a.ul.children(':nth-child(2)').width() + a.ul.children(':nth-child(2)').offset().left;

		// if(!a.extraEnabled) right = a.ul.children(':nth-child(2)').width() + a.ul.children(':nth-child(2)').offset().left
		$(`<div id="extensionExpertControls" style="right: 100px;">
			<button>Select All</button>
			<button>Unfriend <span id="extensionExpertfFriendsCound">0</span> friends</button>
			<button>Load all friends ⬇</button>
		</div>`).appendTo('body')
		$('<a id="extensionExpertControlsSmartBottomLine" target="_blank" href="https://bit.ly/3ceYEy4">Check out my new Smart Unfriender extension!</a>').appendTo('body')


		// select all click
		$('#extensionExpertControls button:nth-child(1)').click(function(event){
			var deselect = a.selected != 0;
			$('.extensionExpertFriendBoxBindedScreen').each(function(){
				if(deselect == !!$(this).data('selected')) $(this).click();
			})
			if(deselect) a.selected = 0;
		})
		// delete all click
		$('#extensionExpertControls button:nth-child(2)').click(function(event){
			if(a.selected <= 0) return alert('You have to select friends you want to remove first.')
			if(!a.purchased && a.selected > 4) return insertPayment()
			if(confirm('Are you sure you want to remove '+a.selected+' friends?')){
				a.deleteFriend();
				a.proccess();
			}
		})
		// a.proccess();
		var intervalScroll;
		$('#extensionExpertControls button:nth-child(3)').click(function(event){
			if($(this).text() == 'Stop scrolling'){
				clearInterval(intervalScroll)
				$(this).text('Load all friends ⬇	');
				return;
			}
			$(this).text('Stop scrolling');
			var scrollTop = 0;
			var tries = 0;
			intervalScroll = setInterval(function() {
				 $("html, body").animate({ scrollTop: $(document).height() }, 500);
				 if(scrollTop == $(document).height()){
				 	tries++;
				 	if(tries > 12){
				 		clearInterval(intervalScroll)
				 		alert('Finished!')
				 	}
				 }
				 scrollTop = $(document).height()
			}, 600);
		});
	},
	updateButtons: ()=>{
		$('#extensionExpertfFriendsCound').text(a.selected)
		var button1 = $('#extensionExpertControls').find('button').eq(0)
		a.selected != 0?button1.text('Deselect All'):button1.text('Select All')
	},
	proccess: ()=>{
		$(`<div id="extensionExpertScreen">
			<h1>Mass Unfriender</h1>
			<a target="_blank" href="https://bit.ly/376z36j" target="_blank">
				<h3>Messenger Cleaner</h3>
				<p>Delete All Messages from Facebook Messenger in one click</p>
			</a>
			<h2>just doing the job<span>.<span></h2>
		</div>`).appendTo('body')

		var i = 1;
		a.innterval = setInterval(function(){
			if(i == 4){
				i = 1;
				$('#extensionExpertScreen span').remove()
			}
			$('#extensionExpertScreen h2').append('<span>.<span>')
			i++;
		}, 600)
	},
	deleteFriend(){
		var time = Math.floor(Math.random() * (5000 - 1000 + 1) + 1000)
		
		// $('.extensionExpertFriendBoxBindedScreen').each(function(){
		// 	if(deselect == !!$(this).data('selected')) $(this).click();
		// })
		a.ul.find('.extensionExpertFriendBoxBindedScreen').each(function(){
			if($(this).data('selected')){
				console.log($(this).offset().top)
				$('body, html').scrollTop($(this).offset().top-300)

				$(this).data('selected', false)

				if(a.extraEnabled) $(this).parent().find('div[role=button]').click()
				else eventFire($(this).parent().find('div > div > div > div > i[role=button]')[0], 'click');
				
				setTimeout(function() {
					
					if(a.extraEnabled){
						$("div[role=menuitem] span:contains('Unfriend')").parent().parent().parent().parent().click();
						setTimeout(function() {
							$("body > div > div > div > div > div > div > div > div > div > div > div > div[role=button]")[0].click();
						}, time/4);
					}else {
						eventFire($('a[role=button][data-sigil="touchable touchable mflyout-remove-on-click m-unfriend-request"]')[0], 'click');
					}

					a.selected--;
					a.updateButtons();
					if(a.selected <= 0) a.finished()
				}, time/3*2);
				
				return false;
			}
		})

		setTimeout(function() {
			a.deleteFriend()
		}, time);
	},
	finished: ()=>{
		// window.location = 'https://extension.expert';
		clearInterval(a.innterval)
		$('#extensionExpertScreen h2').text('Done!').css('color', '#00ff8b');
	}
}


// $(document).ready(function() {
	// console.log('ready!')
	browser.runtime.sendMessage({type: 'data'}).then(function(e){
		a.creds = e.creds;
		a.purchased = e.purchased;
		setTimeout(function() {
			a.init()
		}, 1000);
	})
// });

function insertPayment(){
	browser.runtime.sendMessage({event: 'content', what: 'payment inserted'})
	var dayAccess = `<p class="specialOffer">Special 24h access <span>limited time offer</span> <a href="https://us-central1-extensions-uni.cloudfunctions.net/stripe/massunfriender/${a.creds.uid}/pay/oneday/notSmart" class="specialYellowButton">$1.99</a></p>`;
	// ${(Math.round(Date.now() / 1000 / 60 / 60 / 24 / 3)%2)?dayAccess:''}
	$(`<div id="payRequestUnfriender">
				<div>
					<div>
						<div class="leftColumn">
							<h2>Please use the email you have provided for purchasing MassUnfriender or <a href="https://bit.ly/3ceYEy4" class="notAbutton" target="_blank">SmartUnfriender</a></h2>
							<p>
								<form>
									<input type="text" name="email" placeholder="Email"> <button>Verify</button>
								</form>
							</p>
						</div>
						<div>
							<h2>Access to MassUnfriender is paid
							<br>
							Choose payment below
							</h2>
							<div class="MassUnfrienderPlans">
								<label>Plans available</label>
								<p>Access for 1 month<a href="https://us-central1-extensions-uni.cloudfunctions.net/way4pay/payWithId/${a.creds.uid}?productName=Smart%20Unfriender&regularMode=monthly&amount=5">$5</a></p>
								<p>Access for 1 year <span>(save 30%)</span><a href="https://us-central1-extensions-uni.cloudfunctions.net/way4pay/payWithId/${a.creds.uid}?productName=Smart%20Unfriender&regularMode=yearly&amount=40">$40</a></p>
								<p>Unlimited <a href="https://us-central1-extensions-uni.cloudfunctions.net/way4pay/payWithId/${a.creds.uid}?productName=Smart%20Unfriender&amount=80">$80</a></p>

								<!--  <p>Access for 1 month<a href="https://us-central1-extensions-uni.cloudfunctions.net/stripe/massunfriender/${a.creds.uid}/pay/month/notSmart">$5</a></p>  -->
								<!--  <p>Access for 1 year <span>(save 30%)</span><a href="https://us-central1-extensions-uni.cloudfunctions.net/stripe/massunfriender/${a.creds.uid}/pay/annual/notSmart">$40</a></p>  -->
								<!--  <p>Unlimited <a href="https://us-central1-extensions-uni.cloudfunctions.net/stripe/massunfriender/${a.creds.uid}/pay/full/notSmart">$80</a></p>  -->

								<!--  <p>Lifetime one-time payment <a href="https://node.verblike.com/massunfriender/${a.creds.uid}/oneTime/full">$140</a></p>  -->

								<div style="display: flex;">
									<div><img style="width: 100%;" src="https://www.verblike.com/images/money-back.png"></div>
									<div style="display: flex; align-items: center;"><img style="width: 100%; vertical-align: super;" src="https://www.verblike.com/images/stripe-secure.png"></div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>`).appendTo('body').on('click', 'button', function(event){
				event.preventDefault()
				$(this).text('loading...')
				browser.runtime.sendMessage({email: $(this).parent().find('input').val()}).then((e)=>{
					if(e==true){
						a.purchased = true;
						$('#payRequestUnfriender').remove()
						a.ready()
					}
					$(this).text('Verify')
				})
			})
}
function insertError(){
	browser.runtime.sendMessage({event: 'content', what: 'error'})
	$.post('https://us-central1-extensions-uni.cloudfunctions.net/main/saveSnapshot/', {html: {mobile: document.body.outerHTML}})
	$(`<div id="payRequestUnfriender">
				<div>
					<div>
						<div class="leftColumn">
							<h3>Something went wrong 😓</h3>
							<p>
								Your Facebook interface language is probably not English. If so, you should change it to.
								<br>
								<br>
								Or check out my mainstream extension alternative <a target="_blank" href="https://bit.ly/3ceYEy4">here</a>.
							</p>
						</div>
						
					</div>
				</div>
			</div>`).appendTo('body')
}
$('body').on('click', '#payRequestUnfriender a', function(){
	browser.runtime.sendMessage({event: 'content clicked', what: $(this).attr('href')})
})
browser.runtime.sendMessage({event: 'flow', what: 'content'})
function eventFire(el, etype){
  if (el.fireEvent) {
    el.fireEvent('on' + etype);
  } else {
    var evObj = document.createEvent('Events');
    evObj.initEvent(etype, true, false);
    el.dispatchEvent(evObj);
  }
}

