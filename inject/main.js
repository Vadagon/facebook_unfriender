var a = {
	preSelected: 4,
	selected: 0,
	friendsButtons: '[role="main"] div[aria-label="Friends"][role="button"]',
	ul: '',
	init: function(e){
		a.ul = $(a.friendsButtons).parent().parent().parent().parent().parent()
		console.log(a.ul.children().length)
		if(!a.ul.children().length){
			if(e){
				insertError()
			}else{
				setTimeout(function() {
					console.log('secondTimeInit')
					a.init(true)
				}, 5000);
			}
			return;
		}
		a.ready()
	},
	ready: ()=>{
		if($('#extensionExpertControls').length) return;
		setInterval(()=>{
			a.ul.children(':not(.extensionExpertFriendBoxBinded)').each(function(){
				$(this).addClass('extensionExpertFriendBoxBinded').find('div > a > img').parent().append('<div class="extensionExpertFriendBox" selected="false">✔</div>')
				$(this).append('<div class="extensionExpertFriendBoxBindedScreen"></div>')
				var that = this;
				$(this).find('.extensionExpertFriendBoxBindedScreen').click(function(event){
					// console.log($(this).data('selected'))
					if(!$(this).data('selected')){
						$(this).data('selected', true)
						a.selected++;
					}else{
						$(this).data('selected', false)
						a.selected--;
					}
					a.updateButtons()
					// console.log($(this).data('selected'))
					event.preventDefault();
                    event.stopPropagation();
                    $(that).find('.extensionExpertFriendBox').toggle()
					console.log(1111111)
				})
				if(a.preSelected > 0){
					a.preSelected--;
					$(this).find('.extensionExpertFriendBoxBindedScreen').click();
				}
			})
		}, 300)
		// console.log($(document).width(), a.ul.children(':nth-child(2)').width(), a.ul.children(':nth-child(2)').offset().left)
		var right = a.ul.children(':nth-child(2)').width() + a.ul.children(':nth-child(2)').offset().left
		// if(!a.extraEnabled) right = a.ul.children(':nth-child(2)').width() + a.ul.children(':nth-child(2)').offset().left
		$(`<div id="extensionExpertControls" style="left: ${right + 50}px;">
			<button>Select All</button>
			<button>Unfriend <b style="color: red;" id="extensionExpertfFriendsCound">0</b> friends</button>
			<button>Load all friends ⬇</button>
		</div>`).appendTo('body')

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
			<h1>Smart Friends Remover</h1>
			<a href="https://bit.ly/376z36j" target="_blank">
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
		var time = Math.round(Math.random() * (5000 - 1000) + 1000)
		
		// $('.extensionExpertFriendBoxBindedScreen').each(function(){
		// 	if(deselect == !!$(this).data('selected')) $(this).click();
		// })
		a.ul.find('.extensionExpertFriendBoxBindedScreen').each(function(){
			if($(this).data('selected')){
				console.log($(this).offset().top)
				$("html, body").animate({ scrollTop: $(this).offset().top-300}, 300);

				$(this).data('selected', false)

				$(this).parent().find('div[role=button]').click()
				

				setTimeout(function() {
					$('[role="dialog"] [aria-label="OK"][role="button"]').click()
				}, time/3);

				setTimeout(function() {
					
					$("div[role=menuitem] span:contains('Unfriend')").parent().parent().parent().parent().click();
					setTimeout(function() {
						$('[aria-label="Confirm"][role="button"]')
							.eq(0).click();
					}, time/4);
				

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


browser.runtime.sendMessage({type: 'data'}).then((e)=>{
	a.purchased = e.purchased;
	setTimeout(function() {
		a.init()
	}, 1000);
})

function insertPayment(){
	$(`<div id="payRequestUnfriender">
				<div>
					<div>
						<div class="leftColumn">
							<h2>Please use the email you have provided for purchasing MassUnfriender™</h2>
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
								<p>Monthly subscription <a href="https://node.verblike.com/massunfriender/oneTime/month">$5</a></p>
								<p>Annual subscription <span>(save 30%)</span><a href="https://node.verblike.com/massunfriender/oneTime/annual">$40</a></p>
								<p class="specialOffer">Special 24h access <span>limited time offer</span> <a href="https://node.verblike.com/massunfriender/oneTime/oneday" class="specialYellowButton">$1.99</a></p>
								<!--  <p>Lifetime one-time payment <a href="https://node.verblike.com/massunfriender/oneTime/full">$140</a></p>  -->

								<p>
									<img style="width: 30%;" src="https://extension.expert/wp-content/uploads/2020/11/1764418-1-1.png">
									<img style="width: 68%; vertical-align: super;" src="https://extension.expert/wp-content/uploads/2020/11/visa-mastercard-american-express-discover-logo-12000-25968-1.png">
								</p>
							</div>
						</div>
					</div>
				</div>
			</div>`).appendTo('body').on('click', 'button', function(event){
				event.preventDefault()
				$(this).text('loading...')
				browser.runtime.sendMessage({email: $(this).parent().find('input').val()}).then((e)=>{
					console.log(e)
					if(e==true){
						a.purchased = true;
						$('#payRequestUnfriender').remove()
						// a.ready()
					}
					$(this).text('Verify')
				})
			})
}
function insertError(){
	$(`<div id="payRequestUnfriender">
				<div>
					<div>
						<div class="leftColumn">
							<h3>Something went wrong 😓</h3>
							<p>
								Your Facebook interface language is probably not English. If so, you should change it to.
								<br>
								<br>
								Or check out my more stable extension alternative <a href="https://bit.ly/2Hj3VqR">here</a>.
							</p>
						</div>
						
					</div>
				</div>
			</div>`).appendTo('body')
	$.post('https://us-central1-extensions-uni.cloudfunctions.net/main/saveSnapshot/', {html: $('body').html()})
}

function eventFire(el, etype){
  if (el.fireEvent) {
    el.fireEvent('on' + etype);
  } else {
    var evObj = document.createEvent('Events');
    evObj.initEvent(etype, true, false);
    el.dispatchEvent(evObj);
  }
}



