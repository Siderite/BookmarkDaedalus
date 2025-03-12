(function() {

    const global = this;

    class BookmarkExplorer {
        constructor(api, noInitialRefresh) {
            if (!api || typeof(api) != "object")
                throw ('BookmarkExplorer needs an ApiWrapper instance as the first constructor parameter');
            this.api = api;
            this.inviteToBlogIntervalInDays = 100;
            this.lastExploredFolderId = null;
            this.init(noInitialRefresh);
        }

        init(noInitialRefresh) {
            const self = this;
            const refresh = self.refresh.bind(self);
            if (self.api.onUpdatedTab) {
                self.api.onUpdatedTab(async (tabId, changeInfo, tab) => {
                    refresh();
                    if (changeInfo?.status == 'complete') {
                        const tabInfo = await self.getInfo(tab.url);
                        const data = await self.handleDuplicates(tabInfo, tab);
                        if (tab.url == data?.current?.url) {
                            self.api.notify(data.notifications);
                        }
                    }
                });
            }

            if (self.api.onCreatedTab) {
                self.api.onCreatedTab(() => {
                    refresh();
                });
            }
            if (self.api.onRemovedTab) {
                self.api.onRemovedTab(() => {
                    refresh();
                });
            }
            if (self.api.onActivatedTab) {
                self.api.onActivatedTab(() => {
                    refresh();
                });
            }

            if (self.api.onCreatedBookmark) {
                self.api.onCreatedBookmark(async (id, bm) => {
                    const settings = await self.api.getSettings();
                    if (bm.url && settings.cleanUrls) {
                        const newUrl = ApiWrapper.cleanUrl(bm.url);
                        if (newUrl != bm.url) {
                            await self.api.updateBookmark(id, {
                                url: newUrl
                            });
                            refresh(true);
                        }
                    } else {
                        refresh(true);
                    }
                });
            }

            if (self.api.onRemovedBookmark) {
                const bookmarksToStore = [];
                const removeBookmarksThrottled = ApiWrapper.throttle(async () => {
                    await self.api.addDeletedBookmarks(bookmarksToStore);
                    bookmarksToStore.splice(0, 10000);
                    refresh(true);
                });
                self.api.onRemovedBookmark(async (id, data) => {
                    const settings = await self.api.getSettings();
                    if (settings.storeAllDeletedBookmarks) {
                        if (data?.node) {
                            const bookmark = data.node;
                            bookmark.index = data.index;
                            bookmark.parentId = data.parentId;
                            const f = bm => {
                                if (bm.url) {
                                    bookmarksToStore.push(bm);
                                } else if (bm.children?.length) {
                                    bm.children.forEach(f);
                                }
                            };
                            f(bookmark);
                            removeBookmarksThrottled();
                        }
                    } else {
                        refresh(true);
                    }
                    
                });
            }
            if (self.api.onChangedBookmark) {
                self.api.onChangedBookmark(() => {
                    refresh(true);
                });
            }
            if (self.api.onMovedBookmark) {
                self.api.onMovedBookmark(() => {
                    refresh(true);
                });
            }
            if (self.api.onChildrenReorderedBookmark) {
                self.api.onChildrenReorderedBookmark(() => {
                    refresh(true);
                });
            }
            if (self.api.onImportEndedBookmark) {
                self.api.onImportEndedBookmark(() => {
                    refresh(true);
                });
            }

            if (self.api.onCommand) {
                self.api.onCommand(function() {
                    self.execute(...arguments);
                });
            }

            if (self.api.onMessage) {
                self.api.onMessage(data=>{
                    if (typeof(data)=='string') {
                      return self.execute(data);
                    } else {
                      return self.execute(data.action,data);
                    }
                });
            }

            if (!noInitialRefresh) {
                refresh();
            }
        }

        dispose() {
            if (!this.api)
                return;
            this.api.dispose();
            this.api = null;
        }

        async openManage(url) {
            const self = this;
            const manageUrl = self.api.getExtensionUrl('html/manage.html');
            const tabInfo = await self.getInfo(url);
            const currentTab = await self.api.getCurrentTab();
            const data = await self.handleDuplicates(tabInfo, currentTab);
            await self.api.selectOrNew(manageUrl);
            self.api.sendMessage({ action: 'refresh', data:data});
        }

        openSettings(url) {
            const self = this;
            self.api.openOptions();
        }

        openDeleted(url) {
            const self = this;
            const deletedUrl = self.api.getExtensionUrl('html/deleted.html');
            self.api.selectOrNew(deletedUrl);
        }

        async refresh(forced) {
            const self = this;
            const tab = await self.api.getCurrentTab();
            if (tab.url) {
                self.refreshIconAndMenu(tab);
                self.refreshManage(tab, forced);
            }
        }

        async refreshManage(currentTab, forced) {
            const self = this;
            const manageUrl = self.api.getExtensionUrl('html/manage.html');
            const ownUrls = [manageUrl, self.api.getExtensionUrl('html/deleted.html'), self.api.getExtensionUrl('html/settings.html'), self.api.getOptionsUrl()];
            if (ownUrls.includes(currentTab.url) || currentTab.url.startsWith('chrome:') || currentTab.url.startsWith('moz-extension:') || currentTab.url.startsWith('opera:')) {
                if (forced || currentTab.url != manageUrl) {
                    self.api.sendMessage("current");
                }
                return;
            }
            const tabInfo = await self.getInfo(currentTab.url);
            const data = await self.handleDuplicates(tabInfo, currentTab);
            self.api.sendMessage({ action: 'refresh', data:data});
        }

        async refreshIconAndMenu(currentTab) {
            const self = this;
            const manageUrl = self.api.getExtensionUrl('html/manage.html');
            const browser = ApiWrapper.getBrowser();
            const settings = await self.api.getSettings();
            const tabInfo = await self.getInfo(currentTab.url);
            const data = await self.handleDuplicates(tabInfo, currentTab);
            if (settings.manageContext) {
                self.api.createMenuItem('manage', 'Manage bookmark folder');
            } else {
                self.api.removeMenuItem('manage');
            }
            self.api.setIcon(currentTab.id, data ? 'images/icon.png' : 'images/icon-gray.png');
            self.api.toggleIcon(currentTab.id, true);
            if (data?.prev && settings.prevNextContext) {
                let text = 'Navigate to previous bookmark ';
                if (browser.isChrome) {
                    text += '(Ctrl-Shift-K)';
                } else {
                    text += '(Ctrl-Shift-O)';
                }
                self.api.createMenuItem('prevBookmark', 'Navigate to previous bookmark (Ctrl-Shift-O)');
            } else {
                self.api.removeMenuItem('prevBookmark');
            }
            if (data?.next && settings.prevNextContext) {
                self.api.createMenuItem('nextBookmark', 'Navigate to next bookmark (Ctrl-Shift-L)');
            } else {
                self.api.removeMenuItem('nextBookmark');
            }
            if (data?.next && settings.prevNextContext) {
                self.api.createMenuItem('skipBookmark', 'Skip bookmark (move it to the end of the folder)');
            } else {
                self.api.removeMenuItem('skipBookmark');
            }
            self.api.removeMenuItem('readLinkLater');
            self.api.removeMenuItem('readPageLater');
            if (settings.readLaterContext) {
                self.api.createMenuItem({
                    id: 'readLinkLater',
                    title: 'Read link later',
                    contexts: ["link"]
                });
                if (settings.enableBookmarkPage) {
                    self.api.createMenuItem({
                        id: 'readPageLater',
                        title: 'Read page later',
                        contexts: ["page"]
                    });
                }
                const n = {};
                (settings.readLaterFolderName || 'Read Later').split(/,/).forEach(name => {
                    if (name)
                        n[name] = true;
                });
                const names = Object.keys(n);
                if (names.length > 1) {
                    names.forEach(name => {
                        self.api.createMenuItem({
                            id: `readLinkLater ${name}`,
                            title: name,
                            parentId: 'readLinkLater',
                            contexts: ["link"]
                        });
                        self.api.createMenuItem({
                            id: `readPageLater ${name}`,
                            title: name,
                            parentId: 'readPageLater',
                            contexts: ["page", "frame", "selection", "editable", "image", "video", "audio"]
                        });
                    });
                }
            }
            if (settings.showCurrentIndex && data) {
                self.api.setBadge(currentTab.id, data.index + 1, '#909090');
                self.api.setTitle(currentTab.id, `${data.path} : ${data.index + 1}/${data.length}`);
            } else {
                self.api.setBadge(currentTab.id, '');
                self.api.setTitle(currentTab.id, 'Bookmark Surfer Daedalus');
            }
            if (settings.preloadNext && data?.next) {
                self.preload(currentTab.id, data.next.url);
            }
        }

        async addReadLaterBookmark(bm, folderName) {
            const self = this;
            const bar = await self.api.getBookmarksBar();
            const bms = await self.api.getBookmarksByTitle(folderName);
            const rl = bms.filter(itm => itm.parentId == bar.id)[0];
            if (!rl) {
                await self.api.createBookmarks({
                    parentId: bar.id,
                    title: folderName
                })
                return await self.addReadLaterBookmark(bm, folderName);
            }
            const existing = self.api.getBookmarksByUrl(bm.url, {
                params: true
            }, rl);
            if (existing?.length) {
                self.api.notify('URL already added to the Read Later list');
                return existing;
            } else {
                bm.parentId = rl.id;
                return await self.api.createBookmarks(bm);
            }
            
        }

        async readLater(url, folderName) {
            const self = this;
            const data = {
                url,
                title: url
            };
            const bm = await self.addReadLaterBookmark(data, folderName);
            const tab = await self.api.newTab(url, true);
            const settings = await self.api.getSettings();
            let tm = null;
            let eh = null;
            const endOperation = timeout => {
                clearTimeout(tm);
                tm = setTimeout(() => {
                  eh?.remove();
                  self.api.closeTab(tab.id);
                }, timeout);
            };
            eh = self.api.onUpdatedTab(async (tabId, changeInfo, updatedTab) => {
                if (tab.id != tabId || !changeInfo || (!changeInfo.url && !changeInfo.title)) return;
                let timeout = null;
                if (data.url != updatedTab.url) {
                    data.url = updatedTab.url;
                    timeout = 0.6 * settings.readLaterPageTimeout;
                }
                if (data.title != updatedTab.title) {
                    data.title = updatedTab.title;
                    timeout = 0.3 * settings.readLaterPageTimeout;
                }
                if (timeout) {
                  clearTimeout(tm);
                  await self.api.updateBookmark(bm.id,{ title:data.title, url:data.url });
                  endOperation(timeout);
                }
            });
            endOperation(settings.readLaterPageTimeout);
        }

        async execute(command, info) {
            const self = this;
            const tab = await self.api.getCurrentTab();
            const m = /^(readLinkLater|readPageLater)/.exec(command);
            if (m) {
                if (!info) return;
                const folderName = command.substr(m[0].length).trim() || 'Read Later';
                if (info.linkUrl) {
                    self.readLater(info.linkUrl, folderName);
                    return;
                }
                const settings = await self.api.getSettings();
                if (!info.pageUrl) return;
                const confirmed = !settings.confirmBookmarkPage || await self.confirm(tab.id, 'No link selected. Do you want me to bookmark the current page?');
                if (confirmed) {
                  self.addReadLaterBookmark({
                    url: tab.url,
                    title: tab.title
                  }, folderName);
                }
                return;
            }
            switch (command) {
                case 'manage':
                    self.openManage(tab.url);
                    return true;
                case 'settings':
                    self.openSettings();
                    return true;
                case 'deleted':
                    self.openDeleted();
                    return true;
            }
            const tabInfo = await self.getInfo(tab.url);
            const data = await self.handleDuplicates(tabInfo, tab);
            switch (command) {
                case 'prevBookmark':
                    if (!data?.prev) {
                        const url = await self.api.getLastTabBookmarkedUrl(tab.id);
                        const urlInfo = await self.getInfo(url);
                        const dupData = await self.handleDuplicates(urlInfo, tab);
                        if (!dupData) {
                            self.api.notify('Page not bookmarked');
                            return;
                        }
                        if (!dupData.prev) {
                            self.api.notify('Reached the start of the bookmark folder');
                            return;
                        }
                        const settings = await self.api.getSettings();
                        const confirmed = settings.skipPageNotBookmarkedOnNavigate || await self.confirm(tab.id, 'Page not bookmarked. Continue from last bookmarked page opened in this tab?');
                        if (confirmed) {
                            self.api.setUrl(tab.id, dupData.prev.url);
                        }
                    } else {
                        self.api.setUrl(tab.id, data.prev.url);
                    }
                    break;
                case 'nextBookmark':
                    if (!data?.next) {
                        const url = await self.api.getLastTabBookmarkedUrl(tab.id);
                        const urlInfo = await self.getInfo(url);
                        const dupData = await self.handleDuplicates(urlInfo, tab);
                        if (!dupData) {
                            self.api.notify('Page not bookmarked');
                            return;
                        }
                        if (!dupData.next) {
                            self.api.notify('Reached the end of the bookmark folder');
                            return;
                        }
                        const settings = await self.api.getSettings();
                        const confirmed = settings.skipPageNotBookmarkedOnNavigate || await self.confirm(tab.id, 'Page not bookmarked. Continue from last bookmarked page opened in this tab?');
                        if (confirmed) {
                            self.api.setUrl(tab.id, dupData.next.url);
                        }
                    } else {
                        self.api.setUrl(tab.id, data.next.url);
                    }
                    break;
                case 'skipBookmark':
                    if (!data) {
                        self.api.notify('Page not bookmarked');
                        return;
                    }
                    if (!data.next) {
                        self.api.notify('Reached the end of the bookmark folder');
                        return;
                    }
                    const bm = ApiWrapper.clone(data.current);
                    delete bm.index;
                    self.api.createBookmarks(bm)
                    self.api.removeBookmarksById([bm.id]);
                    self.api.setUrl(tab.id, data.next.url);
                    break;
                case 'getInfo':
                    if (!info.url) {
                        self.api.notify('No url sent to getInfo');
                        return;
                    }
                    if (info.url == tab.url) {
                      return tabInfo;
                    }
                    return await self.getInfo(info.url);
                case 'handleDuplicates':
                    return self.handleDuplicates(info.arr, info.tab);
            }
        }

        async inviteToBlog() {
            const self = this;
            const settings = await self.api.getSettings();
            if (!settings.showBlogInvitation) return;
            const browser = ApiWrapper.getBrowser();
            const now = Date.now();
            const firstTime = !settings.lastShownBlogInvitation;
            if (settings.lastShownBlogInvitation && now - settings.lastShownBlogInvitation < self.inviteToBlogIntervalInDays * 86400000) return;
            settings.lastShownBlogInvitation = now;
            await self.api.setSettings(settings);
            let notification;
            if (browser.isFirefox) {
                notification = {
                    title: "Visit Siderite's Blog",
                    message: "Use this link to ask for features, report bugs or discuss the extension:\r\nhttps://siderite.dev/blog/bookmark-surfer-daedalus/",
                };
                settings.showBlogInvitation = false;
                if (!firstTime) {
                    await self.api.setSettings(settings);
                    setTimeout(() => {
                        self.api.notify('Find the blog entry link in the extension Options');
                    }, 10000);
                }
            } else {
                notification = {
                    title: "Visit Siderite's Blog",
                    message: "Click on the link below to ask for features, report bugs or discuss the extension",
                    buttons: [{
                            title: 'https://siderite.dev/blog/bookmark-surfer-daedalus/',
                            async clicked() {
                                await self.api.selectOrNew(this.title);
                            }
                        },
                        {
                            title: 'Never show this again',
                            async clicked() {
                                self.api.closeNotification(notification.notificationId);
                                settings.showBlogInvitation = false;
                                await self.api.setSettings(settings);
                                self.api.notify('Find the blog entry link in the extension Options');
                            }
                        }
                    ],
                    requireInteraction: true
                };
                if (firstTime) {
                    notification.buttons.splice(1, 1);
                }
            }
            self.api.notify(notification);
        }

        async getInfo(url) {
            const self = this;
            const schema = await self.api.getUrlComparisonSchema();
            function walk(tree, path) {
                let result = [];

                function setResult(r, itm) {
                    result = result.concat(r);
                }

                if (tree.title) {
                    if (path) {
                        path += ` -> ${tree.title}`;
                    } else {
                        path = tree.title;
                    }
                }
                const arr = tree.children || tree;
                const urlOptions = ApiWrapper.getUrlOptions(url, schema);
                arr.forEach((itm, idx) => {
                    if (itm.children) {
                        const r = walk(itm, path);
                        if (r)
                            setResult(r, itm);
                    }
                    const itmUrlOptions = ApiWrapper.getUrlOptions(itm.url, schema);
                    if (!ApiWrapper.compareUrlOptions(itmUrlOptions, urlOptions).different) {
                        let prev = null;
                        for (let i = idx - 1; i >= 0; i--) {
                            if (arr[i].url) {
                                prev = arr[i];
                                break;
                            }
                        }
                        let next = null;
                        for (let i = idx + 1; i < arr.length; i++) {
                            if (arr[i].url) {
                                next = arr[i];
                                break;
                            }
                        }
                        setResult({
                            folder: tree,
                            prev,
                            current: itm,
                            next,
                            index: idx,
                            length: arr.length,
                            path,
                            notifications: []
                        }, itm);
                    }
                });
                return result;
            }

            self.inviteToBlog();

            const tree = await self.api.getTree();
            const info = walk(tree);
            return info;
        }

        preload(tabId, url) {
            const self = this;
            const time = BookmarkExplorer.preloadedUrls[url];
            const now = (new Date()).getTime();
            BookmarkExplorer.preloadedUrls[url] = now;
            if (time && now - time < 86400000)
                return;
            self.api.sendTabMessage(tabId, { action: 'preload', url: url});
        }

        async confirm(tabId, message) {
            const self = this;
            const data = await self.api.sendTabMessage(tabId, { action: 'confirm', message: message, sendOnce: true });
            return data.result;
        }

        async handleDuplicates(arr, tab) {
            const self = this;
            if (!tab) {
                const currentTab = await self.api.getCurrentTab();
                return await self.handleDuplicates(arr, currentTab);
            }

            function max(str, size) {
                if (!str)
                    return '';
                if (str.length <= size - 1)
                    return str;
                return `${str.substr(0, size)}\u2026`;
            }

            let result;
            switch (arr?.length || 0) {
                case 0:
                    return null;
                case 1:
                    result = arr[0];
                    self.lastExploredFolderId = result.folder.id;
                    return result;
                default:
                    const schema = await self.api.getUrlComparisonSchema();
                    const urls = await self.api.getListOfUrls(tab.id);
                    result = [];
                    if (self.lastExploredFolderId) {
                        result = arr.filter(itm => itm.folder.id == self.lastExploredFolderId);
                        if (result.length > 1) {
                            arr = result;
                        }
                    }
                    if (result.length != 1) {
                        if (urls?.length) {
                            for (let i = 1; i < 5; i++) {
                                const url = urls[urls.length - i];
                                result = arr.filter(itm => (itm.prev && !ApiWrapper.compareUrls(itm.prev.url, url, schema).different) ||
                                    (itm.next && !ApiWrapper.compareUrls(itm.next.url, url, schema).different));
                                if (result.length)
                                    break;
                            }
                        }
                    }
                    result = result[0] || arr[0];
                    self.lastExploredFolderId = result.folder.id;
                    const settings = await self.api.getSettings();
                    if (settings.showDuplicateNotifications) {
                        result.notifications.push('Duplicate bookmarks found:');

                        arr.forEach(r => result.notifications.push(`- "${max(r.current.title, 50)}" in "${max(r.folder.title, 20)}" (${max(r.current.url, 50)})`));
                        result.notifications.push(`Using the one in "${max(result.folder.title, 20)}"@${result.index + 1}`);
                    }
                    return result;
            }
        }
    }
    BookmarkExplorer.preloadedUrls = {};

    global.BookmarkExplorer = BookmarkExplorer;
})();