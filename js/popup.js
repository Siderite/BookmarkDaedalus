(function ($) {

    const global = this;
    const context = global.testContext && global.testContext.document || global.document;
    const chrome = global.testContext && global.testContext.chrome ? global.testContext.chrome : global.chrome;
    const api = new ApiWrapper(chrome);

    $( () => {

        const btnPrev = $('#btnPrev', context);
        const btnSkip = $('#btnSkip', context);
        const btnNext = $('#btnNext', context);
        const btnManage = $('#btnManage', context);
        const btnSettings = $('#divHeader img', context);
        const divFolder = $('#divFolder', context);

        btnPrev.click(async () => {
            await api.sendMessage('prevBookmark');
        });
        btnSkip.click(async () => {
            await api.sendMessage('skipBookmark');
        });
        btnNext.click(async () => {
            await api.sendMessage('nextBookmark');
        });
        btnManage.click(async () => {
            await api.sendMessage('manage');
            setTimeout(window.close, 1000);
        });
        btnSettings.click(async () => {
            await api.sendMessage('settings');
            setTimeout(window.close, 1000);
        });

        async function refresh() {
            const browser = ApiWrapper.getBrowser();
            const settings = await api.getSettings();
            btnSkip.toggle(!settings.hideSkipButton);
            const tab = await api.getCurrentTab();
            const tabInfo = await api.sendMessage({ action: 'getInfo', url: tab.url });
            let data = await api.sendMessage({ action: 'handleDuplicates', arr: tabInfo?.result, tab: tab });
            data = data.result;
            if (data?.folder) {
                divFolder.text(data.folder.title);
                divFolder.attr('title', `${data.path} : ${data.index}`);
                btnManage.show();
            } else {
                divFolder.text('Not bookmarked');
                divFolder.attr('title', 'Current page not found in bookmarks');
            }

            if (data?.prev) {
                btnPrev.prop('disabled', false);
                btnPrev.data('url', data.prev.url);
                const shortcutText = browser.isChrome ?
                    '(Ctrl-Shift-K)' :
                    '(Ctrl-Shift-O)';
                btnPrev.attr('title', `${data.prev.title || ''}\r\n${data.prev.url}\r\n${shortcutText}`);
            } else {
                btnPrev.prop('disabled', true);
                btnPrev.removeData('url')
                btnPrev.attr('title', 'No previous bookmark');
            }

            if (data?.next) {
                btnNext.prop('disabled', false);
                btnSkip.prop('disabled', false);
                btnNext.data('url', data.next.url);
                btnNext.attr('title', `${data.next.title || ''}\r\n${data.next.url}\r\n(Ctrl-Shift-L)`);
                btnSkip.attr('title', 'Skip bookmark (move it to the end of folder)');
            } else {
                btnNext.prop('disabled', true);
                btnSkip.prop('disabled', true);
                btnNext.removeData('url');
                btnNext.attr('title', 'No next bookmark');
                btnSkip.attr('title', 'No next bookmark');
            }
        }

        refresh();
        api.onUpdatedTab(refresh);

    });

})(jQuery);