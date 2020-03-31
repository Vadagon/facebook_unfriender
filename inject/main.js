var a = {
	preSelected: 3,
	selected: 0,
	selector: '.uiList li',
	init: ()=>{
		setInterval(()=>{
			$(a.selector+':not(.extensionExpertFriendBoxBinded)').each(function(){
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
		console.log($(document).width(), $(a.selector+':nth-child(2)').width(), $(a.selector+':nth-child(2)').offset().left)
		var right = $('.uiList li:nth-child(2)').width() + $('.uiList li:nth-child(2)').offset().left
		$(`<div id="extensionExpertControls" style="left: ${right + 50}px;">
			<button>Select All</button>
			<button>Unfriend <span id="extensionExpertfFriendsCound">0</span> friends</button>
		</div>`).appendTo('body')

		// select all click
		$('#extensionExpertControls button:nth-child(1)').click(function(event){
			var deselect = a.selected != 0;
			$('.extensionExpertFriendBoxBindedScreen').each(function(){
				if(deselect == !!$(this).data('selected')) $(this).click();
			})
		})
		// delete all click
		$('#extensionExpertControls button:nth-child(2)').click(function(event){
			if(a.selected <= 0) return;
			a.deleteFriend();
			a.proccess();
		})
	},
	updateButtons: ()=>{
		$('#extensionExpertfFriendsCound').text(a.selected)
		var button1 = $('#extensionExpertControls').find('button').eq(0)
		a.selected != 0?button1.text('Deselect All'):button1.text('Select All')
	},
	proccess: ()=>{
		$(`<div id="extensionExpertScreen">
			<h1>Smart Friends Remover</h1>
			<a href="https://bit.ly/39yAUjs" target="_blank">
				<h3>Take a Break Timer</h3>
				<p>Extremely simple and smart Chrome Extension that tell you when you need to take a break</p>
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




		$('.uiList li .extensionExpertFriendBoxBindedScreen').each(function(){
			if($(this).data('selected')){
				console.log($(this).offset().top)
				$('body, html').scrollTop($(this).offset().top-300)

				$(this).data('selected', false)

				eventFire($(this).parent().find('a.friendButton')[0], 'click');
				
				setTimeout(function() {
					eventFire($('.uiContextualLayer .FriendListActionMenu .FriendListUnfriend > a')[0], 'click');
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

a.init()


function eventFire(el, etype){
  if (el.fireEvent) {
    el.fireEvent('on' + etype);
  } else {
    var evObj = document.createEvent('Events');
    evObj.initEvent(etype, true, false);
    el.dispatchEvent(evObj);
  }
}



