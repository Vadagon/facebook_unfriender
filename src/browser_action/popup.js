var a = {
    purchased: undefined
}

class PopupActions {
    constructor() {
        browser.runtime.sendMessage({type: 'data'}).then((e)=>{
            a = e;
            this.pageFacebook = a.url;
            this.initAction();
        })
    }

    isMessagePage(url) {
        // if(url.includes("facebook.com/")){
        if(url.includes(this.pageFacebook.split('facebook.com')[1])){
            return true;
        } else {
            return false;
        }
    }

    removeMessages() {
        browser.runtime.sendMessage({event: 'popup', what: '2 step'})
        browser.tabs.query({currentWindow: true, active: true}).then((activeTabs)=>{
            activeTabs.map((tab)=>{
                browser.tabs.executeScript(tab.id, {file:"/js/browser-polyfill.min.js"});
                browser.tabs.executeScript(tab.id, {file:"/js/jquery.min.js"});
                browser.tabs.insertCSS(tab.id, {file:"/inject/main.css"})
                browser.tabs.executeScript(tab.id, {file:"/inject/main.js"});
            });
        });
    }



    openPage() {
        browser.runtime.sendMessage({event: 'popup', what: '1 step'})
        console.log(this.pageFacebook)
        browser.tabs.create({url: this.pageFacebook});
        window.close()
    }


    initAction() {
        browser.tabs.query({currentWindow: true, active: true}).then(function (tab) {
            this.currentUrl = tab[0].url;
            if (this.isMessagePage(this.currentUrl) == true) {
                $("#removeMessages").on("click", this.removeMessages.bind(this));
                $("#openMessenger").addClass('disabled');
                $("#openMessenger").attr('disabled', 'disabled');
                $("#openMessenger").on("click", function (e) {
                    e.preventDefault();
                })
            } else {
                $("#openMessenger").on("click", this.openPage.bind(this))
                $("#removeMessages").addClass('disabled');
                $("#removeMessages").attr('disabled', 'disabled');
                $("#removeMessages").on("click", function (e) {
                    e.preventDefault();
                    window.close()
                    return
                })
            }
        }.bind(this));

        $('#link').click(()=>{
            browser.runtime.sendMessage({event: 'popup', what: '5 stars'})
        })
        $("#link").attr('href', `https://browser.google.com/webstore/detail/${browser.runtime.id}`);

    }
}

$(function () {
    let actions = new PopupActions();
});
