var a = {
    purchased: undefined
}

class PopupActions {
    constructor() {
        this.pageFacebook = 'https://www.facebook.com/friends/list';
        this.initAction();
    }

    isMessagePage(url) {
        if (url.includes('facebook') && url.includes('friends')) {
            return true;
        } else {
            return false;
        }
    }

    removeMessages() {
        browser.tabs.query({ currentWindow: true, active: true }).then((activeTabs) => {
            activeTabs.map((tab) => {
                chrome.scripting.insertCSS({
                    target: { tabId: tab.id },
                    files: ["/inject/main.css"]
                });
                chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: [
                        "/js/browser-polyfill.min.js",
                        "/js/jquery.min.js",
                        "/inject/utils.js",
                        "/inject/main.js"
                    ]
                })
            });
        });
    }



    openPage() {
        console.log(this.pageFacebook)
        browser.tabs.create({ url: this.pageFacebook });
        window.close()

    }


    initAction() {
        browser.tabs.query({ currentWindow: true, active: true }).then(function (tab) {
            this.currentUrl = tab[0].url;
            if (this.isMessagePage(this.currentUrl) == true) {
                $("#removeMessages").on("click", this.removeMessages.bind(this));
                $("#openMessenger").addClass('disabled');
                $("#openMessenger").attr('disabled', 'disabled');
                $("#openMessenger").on("click", function (e) {
                    window.close()
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
        $("#link").attr('href', `https://chrome.google.com/webstore/detail/${browser.runtime.id}`);

    }
}
$(function () {
    let actions = new PopupActions();
});
