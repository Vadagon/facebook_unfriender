var a = {
	preSelected: 4,
	selected: 0,
	uniqueMenuButtons: 'body div[aria-label="All friends"] div[aria-label="More"][role="button"]',
	getElements: () => $(a.uniqueMenuButtons).parent().parent().parent().parent().parent().parent().parent(),
	elementsImage: '[role="img"]',
	getUl: () => a.getElements().parent(),
	getContainer: () => a.getUl().parent().parent().parent(),
	ul: '',
	deletionQueue: (time) => {
		setTimeout(function () {
			$(a.uniqueMenuButtons).eq(0).click()
		}, time / 3);

		setTimeout(function () {
			$("div[role=menuitem] span:contains('Unfriend')").parent().parent().parent().parent().click();
			setTimeout(function () {
				$('[aria-label="Confirm"][role="button"]').eq(0).click();
			}, time / 4);
			a.selected--;
			a.updateButtons();
			if (a.selected <= 0) a.finished()
		}, time / 3 * 2);
	},
	init: function (e) {
		console.log('a.uniqueMenuButtons', a.uniqueMenuButtons);
		console.log('a.getElements', a.getElements());
		console.log('a.getUl', a.getUl());
		console.log('a.getContainer()', a.getContainer());
		a.ul = a.getUl();
		console.log(a.ul.children().length)
		if (!a.ul.children().length) {
			if (e) {
				utils.insertError()
			} else {
				alert('An error occured ... Let\'s try again in 5 seconds');
				setTimeout(function () {
					console.log('secondTimeInit')
					a.init(true)
				}, 4000);
			}
			return;
		}
		a.ready()
	},
	ready: () => {
		if ($('#extensionExpertControls').length) return;
		setInterval(() => {
			a.getElements().filter(':not(.extensionExpertFriendBoxBinded)').each(function () {
				$(this).addClass('extensionExpertFriendBoxBinded').find(a.elementsImage).parent().append('<div class="extensionExpertFriendBox" selected="false">✔</div>')
				$(this).append('<div class="extensionExpertFriendBoxBindedScreen"></div>')
				var that = this;
				$(this).find('.extensionExpertFriendBoxBindedScreen').click(function (event) {
					console.log($(this));
					// console.log($(this).data('selected'))
					if (!$(this).data('selected')) {
						$(this).data('selected', true)
						a.selected++;
					} else {
						$(this).data('selected', false)
						a.selected--;
					}
					a.updateButtons()
					event.preventDefault();
					event.stopPropagation();
					$(that).find('.extensionExpertFriendBox').toggle()
					console.log(1111111)
				})
				if (a.preSelected > 0) {
					a.preSelected--;
					$(this).find('.extensionExpertFriendBoxBindedScreen').click();
				}
			})
		}, 300)
		// console.log($(document).width(), a.ul.children(':nth-child(2)').width(), a.ul.children(':nth-child(2)').offset().left)
		// if(!a.extraEnabled) right = a.ul.children(':nth-child(2)').width() + a.ul.children(':nth-child(2)').offset().left
		$(`<div id="extensionExpertControls" style="right: 100px;">
			<button>Select All</button>
			<button>Unfriend <span id="extensionExpertfFriendsCound">0</span> friends</button>
			<button>Load all friends ⬇</button>
		</div>`).appendTo('body')
		$('<a id="extensionExpertControlsSmartBottomLine" target="_blank" href="https://bit.ly/376z36j">Need to clean messages too? Check out Facebook Messenger Cleaner!</a>').appendTo('body')

		// select all click
		$('#extensionExpertControls button:nth-child(1)').click(function (event) {
			var deselect = a.selected != 0;
			$('.extensionExpertFriendBoxBindedScreen').each(function () {
				if (deselect == !!$(this).data('selected')) $(this).click();
			})
			if (deselect) a.selected = 0;
		})
		// delete all click
		$('#extensionExpertControls button:nth-child(2)').click(function (event) {
			if (a.selected <= 0) return alert('You have to select friends you want to remove first.')
			if (!a.purchased) return utils.insertPayment()
			if (confirm('Are you sure you want to remove ' + a.selected + ' friends?')) {
				a.deleteFriend();
				a.proccess();
			}
		})
		var intervalScroll;
		$('#extensionExpertControls button:nth-child(3)').click(function (event) {
			if ($(this).text() == 'Stop scrolling') {
				clearInterval(intervalScroll)
				$(this).text('Load all friends ⬇	');
				return;
			}
			$(this).text('Stop scrolling');
			var scrollTop = 0;
			var tries = 0;
			intervalScroll = setInterval(function () {
				a.getContainer().animate({ scrollTop: a.getContainer().prop('scrollHeight') }, 500);
				if (scrollTop == a.getContainer().prop('scrollHeight')) {
					tries++;
					if (tries > 12) {
						clearInterval(intervalScroll)
						alert('Finished!')
						$(this).text('Load all friends ⬇	');
					}
				}
				scrollTop = a.getContainer().prop('scrollHeight')
			}, 600);
		});

	},
	updateButtons: () => {
		$('#extensionExpertfFriendsCound').text(a.selected)
		var button1 = $('#extensionExpertControls').find('button').eq(0)
		a.selected != 0 ? button1.text('Deselect All') : button1.text('Select All')
	},
	proccess: () => {
		$(`<div id="extensionExpertScreen">
			<h1>Smart Friends Remover</h1>
			<a href="https://bit.ly/376z36j" target="_blank">
				<h3>Messenger Cleaner</h3>
				<p>Delete All Messages from Facebook Messenger in one click</p>
			</a>
			<h2>just doing the job<span>.<span></h2>
		</div>`).appendTo('body')

		var i = 1;
		a.innterval = setInterval(function () {
			if (i == 4) {
				i = 1;
				$('#extensionExpertScreen span').remove()
			}
			$('#extensionExpertScreen h2').append('<span>.<span>')
			i++;
		}, 600)
	},
	deleteFriend() {
		var time = Math.round(Math.random() * (5000 - 1000) + 1000)

		// $('.extensionExpertFriendBoxBindedScreen').each(function(){
		// 	if(deselect == !!$(this).data('selected')) $(this).click();
		// })
		a.ul.find('.extensionExpertFriendBoxBindedScreen').each(function () {
			if ($(this).data('selected')) {
				console.log($(this).offset().top)
				a.getContainer().animate({ scrollTop: $(this).offset().top - 300 }, 300);

				$(this).data('selected', false)

				// $(this).parent().find('div[role=button]').click()

				a.deletionQueue(time);

				return false;
			}
		})

		setTimeout(function () {
			a.selected--;
			a.updateButtons();
			if (a.selected <= 0) a.finished()
			a.deleteFriend()
		}, time);
	},
	finished: () => {
		// window.location = 'https://extension.expert';
		clearInterval(a.innterval)
		$('#extensionExpertScreen h2').text('Done!').css('color', '#00ff8b');
	}
}
a.init()



