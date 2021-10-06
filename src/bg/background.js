// GOOGLE ANALYSTICS
var _gaq = _gaq || [];
_gaq.push(['_setAccount', 'UA-131310674-9']);
_gaq.push(['_trackPageview']);
_gaq.push(['_trackEvent', 'd: flow', 'background']);

(function() {
  var ga = document.createElement('script');
  ga.type = 'text/javascript';
  ga.async = true;
  ga.src = 'https://ssl.google-analytics.com/ga.js';
  var s = document.getElementsByTagName('script')[0];
  s.parentNode.insertBefore(ga, s);
})();


// // if you checked "fancy-settings" in extensionizr.com, uncomment this lines

// // var settings = new Store("settings", {
// //     "sample_setting": "This is how you use Store.js to remember values"
// // });


// //example of using a message handler from the inject scripts
// chrome.extension.onMessage.addListener(
//   function(request, sender, sendResponse) {
//   	chrome.pageAction.show(sender.tab.id);
//     sendResponse();
//   });


var user = {
    purchased: false
}

function getAccessTocken(data) {
    const config = {};
    catcher(()=>{
        config.path = data.split('path\\":\\"\\\\\\/')[1].split('\\"')[0];
    })
    catcher(()=>{
      let id = data.match(/\\"USER_ID\\":\\"([^\\]+)/);
      config.uid = id[1];
    })
    try{
        let o = data.match(/accessToken\\":\\"([^\\]+)/);
        let t = {};
        config.access_token = o[1];
        let n = data.match(/{\\"dtsg\\":{\\"token\\":\\"([^\\]+)/);
        config.dt = n[1];
        let r = data.match(/\\"NAME\\":\\"([^"]+)/);
        r = r[1].slice(0, -1).replace(/\\\\/g, "\\");
        r = decodeURIComponent(JSON.parse(`"${r}"`));
        config.name = r;
        return config;
    }catch(err){
        console.log(err)
    }
}
function getCreds(cb){
    return new Promise(async (resolve) => {
        let url = 'https://m.facebook.com/composer/ocelot/async_loader/?publisher=feed';
        let response = await fetch(url);
        let text = await response.text();

        user.creds = getAccessTocken(text);
        console.log(user);
        gather()
        cb&&cb()
        resolve()
    });
}
getCreds(()=>{
  if(user.creds.uid)
    checkPayment(user.creds.uid, (e)=>{
      // user.purchased = e
    })
})

function gather(){
	// $.get(`https://graph.facebook.com/v5.0/me/friends?limit=5000&access_token=${user.creds.access_token}`).done((data)=>{
	//     catcher(()=>{
 //            user.maximumFriends = data.summary.total_count;
	//     })
	// }).fail((err)=>{
	//     // _gaq.push(['_trackEvent', 'httpErr', err]);
	// });
}


async function generateLink(){
    if(!user.creds.uid) await getCreds();

    // var link = "https://facebook.com/"+user.creds.path+"/friends"
    // if(user.creds.path.includes('profile.php'))
        link = "https://facebook.com/profile.php?id="+user.creds.uid+"&sk=friends";

	getCreds();
    user.url = link;
    return link;
    // chrome.tabs.create({url: link}, function(tab){
    //     chrome.tabs.executeScript(tab.id, {file:"/js/jquery.min.js"});
    //     chrome.tabs.insertCSS(tab.id, {file:"/inject/main.css"})
    //     chrome.tabs.executeScript(tab.id, {file:"/inject/main.js"});
    // })
}

// chrome.browserAction.onClicked.addListener(generateLink);









browser.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if(request.type == 'data') {
        generateLink();
        sendResponse(user)
    } 
    if(request.email) 
        checkPayment(request.email, (e)=>{
            sendResponse(e);
            user.purchased = e;
        }) 
    if(request.event){
        console.log(request.event, request.what)
        _gaq.push(['_trackEvent', 'd: '+request.event, request.what]);
    }
    return true;
});

// tesEmail2@gmail.com
function checkPayment(email, cb){
  $.get(`https://us-central1-extensions-uni.cloudfunctions.net/main/${email.includes('@')?'isRegisteredEmail':'getUserByUID'}/`+email).done((e)=>{
  // $.get('https://us-central1-extensions-uni.cloudfunctions.net/main/getUserByEmail/'+email).done((e)=>{
    cb(e && e.result)
  }).fail(()=>{
    cb(false)
  })
}




function catcher(f){
    try{
        f()
        return true;
    }catch(err){
        console.log(err)
        // _gaq.push(['_trackEvent', 'catcher', err]);
        return false;
    }
}

