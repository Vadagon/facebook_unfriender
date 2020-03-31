// if you checked "fancy-settings" in extensionizr.com, uncomment this lines

// var settings = new Store("settings", {
//     "sample_setting": "This is how you use Store.js to remember values"
// });


//example of using a message handler from the inject scripts
chrome.extension.onMessage.addListener(
  function(request, sender, sendResponse) {
  	chrome.pageAction.show(sender.tab.id);
    sendResponse();
  });


var user = {}

function getAccessTocken(data) {
    catcher(()=>{user.uid = data.split('USER_ID\\":\\"')[1].split('\\",')[0]})
    catcher(()=>{user.uid = data.split('\\"uid\\":')[1].split(',')[0]})
    catcher(()=>{
        user.path = data.split('path\\":\\"\\\\\\/')[1].split('\\"')[0];
        // console.log(user.path, user.uid)
        // generateLink()
        // $('body').append("<iframe src='https://www.facebook.com/"+user.path+"/friends' width='454' height='668'></iframe>");
    })
    try{
        const config = {};
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

        cb&&cb()
        resolve()
    });
}
getCreds()



function generateLink(){
	getCreds();

    var link = "https://facebook.com/"+user.path+"/friends"
    if(user.path.includes('profile.php'))
        link = "https://facebook.com/profile.php?id="+user.uid+"&sk=friends";

    console.log(link)
    chrome.tabs.create({url: link}, function(tab){
        chrome.tabs.executeScript(tab.id, {file:"/inject/main.js"});
        chrome.tabs.insertCSS(tab.id, {file:"/inject/main.css"})
    })
}

chrome.browserAction.onClicked.addListener(generateLink);













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

