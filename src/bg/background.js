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

// function getAccessTocken(data) {
//     catcher(()=>{user.uid = data.split('USER_ID\\":\\"')[1].split('\\",')[0]})
//     catcher(()=>{user.uid = data.split('\\"uid\\":')[1].split(',')[0]})
//     catcher(()=>{
//         user.path = data.split('path\\":\\"\\\\\\/')[1].split('\\"')[0];
//     })
//     try{
//         const config = {};
//         let o = data.match(/accessToken\\":\\"([^\\]+)/);
//         let t = {};
//         config.access_token = o[1];
//         let n = data.match(/{\\"dtsg\\":{\\"token\\":\\"([^\\]+)/);
//         config.dt = n[1];
//         let r = data.match(/\\"NAME\\":\\"([^"]+)/);
//         r = r[1].slice(0, -1).replace(/\\\\/g, "\\");
//         r = decodeURIComponent(JSON.parse(`"${r}"`));
//         config.name = r;
//         return config;
//     }catch(err){
//         console.log(err)
//     }
// }
// function getCreds(cb){
//     return new Promise(async (resolve) => {
//         let url = 'https://m.facebook.com/composer/ocelot/async_loader/?publisher=feed';
//         let response = await fetch(url);
//         let text = await response.text();

//         user.creds = getAccessTocken(text);
//         gather()
//         cb&&cb()
//         resolve()
//     });
// }
// getCreds()

function gather(){
	// $.get(`https://graph.facebook.com/v5.0/me/friends?limit=5000&access_token=${user.creds.access_token}`).done((data)=>{
	//     catcher(()=>{
 //            user.maximumFriends = data.summary.total_count;
	//     })
	// }).fail((err)=>{
	//     // _gaq.push(['_trackEvent', 'httpErr', err]);
	// });
}


function generateLink(){
	// getCreds();

    // var link = "https://facebook.com/"+user.path+"/friends"
    // if(user.path.includes('profile.php'))
    //     link = "https://facebook.com/profile.php?id="+user.uid+"&sk=friends";
    link = 'https://m.facebook.com/friends/center/friends/'

    console.log(link)
    chrome.tabs.create({url: link}, function(tab){
        chrome.tabs.executeScript(tab.id, {file:"/js/jquery.min.js"});
        chrome.tabs.insertCSS(tab.id, {file:"/inject/main.css"})
        chrome.tabs.executeScript(tab.id, {file:"/inject/main.js"});
    })
}

chrome.browserAction.onClicked.addListener(generateLink);




chrome.extension.onMessage.addListener(function(request, sender, sendResponse) {
    if(request.type == 'data')  
        sendResponse(user)
    if(request.email) 
        checkPayment(request.email, (e)=>{
            sendResponse(e);
        }) 
    return true;
});







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

function checkPayment(email, cb){
  $.get('https://us-central1-margarita-1.cloudfunctions.net/DBinsert/isMember?email='+email).done((e)=>{
    cb(e && e.result)
  }).fail(()=>{
    cb(false)
  })
}
