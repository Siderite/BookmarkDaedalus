(function () {
  const global = this;

  class EventHandler {
    constructor(eventRoot, listener) {
      this.disposed = false;
      this.eventRoot = eventRoot;
      this.listener = listener;
      if (eventRoot) {
        const params = Array.from(arguments);
        params.splice(0, 1);
        eventRoot.addListener(...params);
      }
    }

    remove() {
      if (this.disposed || !this.eventRoot || !this.listener)
        return;
      this.eventRoot.removeListener(this.listener);
      this.disposed = true;
    }
  }

  const regUrl = /^\s*(?:([^:]+):(?:\/\/)?)?([^\/\?#]*)[\/]?([^\?#]*?)[\/]?(\?[^#]*?)?(#.*)?\s*$/;
  class ApiWrapper {
    constructor(chr) {
      if (!chr)
        throw "ApiWrapper needs an instance of chrome as a parameter";
      this.chr = chr;
      this.debug = false;
      this.settingsKey = 'settings';
      this.deletedBookmarksKey = 'lastDeletedBookmarks';
      this.sendMessageTimeout = 5000;
      this.sendMessageInterval = null;
      this.urlHistoryKey = 'urlHistory';
      this.init();
    }

    static throttle(fn, time) {
      time =  + (time) || 500;
      let timeout = null;
      const c = () => {
        clearTimeout(timeout);
        timeout = null;
      };
      const t = fn => {
        timeout = setTimeout(fn, time);
      };
      return function () {
        const context = this;
        const args = arguments;
        const f = () => {
          fn.apply(context, args);
        };
        if (!timeout) {
          t(c);
          f();
        } else {
          c();
          t(f);
        }
      }
    }

    static clone(obj) {
      return JSON.parse(JSON.stringify(obj));
    }

    static isValidUrlComparisonSchema(text) {
      if (!text?.trim())
        return false;
      let hasDefault = false;
      let valid = true;
      text.split(/\s*[\r\n]+\s*/).forEach(line => {
        if (!line?.trim())
          return;
        if (/^#/.test(line))
          return;
        const m = /^([^\s]+)\s+((?:scheme|host|path|params|hash)(?:\s*,\s*(?:scheme|host|path|params|hash))*)\s*$/i.exec(line);
        if (!m) {
          valid = false;
        } else {
          if (m[1].toLowerCase() == ApiWrapper.urlComparisonDefault)
            hasDefault = true;
        }
      });
      return valid && hasDefault;
    }

    static refreshCache() {
      ApiWrapper._comparisonOptions = {};
      ApiWrapper._browser = null;
    }

    static getComparisonOptions(url, schema) {
      let o = ApiWrapper._comparisonOptions[url];
      if (o)
        return o;
      let def = null;
      Object.keys(schema).forEach(fragment => {
        if (fragment == ApiWrapper.urlComparisonDefault)
          def = schema[fragment];
        if (url.includes(fragment))
          o = schema[fragment];
      });
      if (!def)
        self.log('urlComparisonSchema default not set!');
      o ||= def;
      ApiWrapper._comparisonOptions[url] = o;
      return o;
    }

    static getUrlOptions(url, schema) {
      url = url?.trim()?.toLowerCase() || '';
      const result = {
        options: ApiWrapper.getComparisonOptions(url, schema),
        match: url ? regUrl.exec(url) : ['', '', '', '', '']
      };
      return result;
    }

    static compareUrlOptions(opt1, opt2, extraOptions) {
      const o1 = opt1.options;
      const o2 = opt2.options;
      const options = extraOptions || {};
      options.scheme = options.scheme || o1.scheme || o2.scheme;
      options.host = options.host || o1.host || o2.host;
      options.path = options.path || o1.path || o2.path;
      options.params = options.params || o1.params || o2.params;
      options.hash = options.hash || o1.hash || o2.hash;

      const m1 = opt1.match;
      const m2 = opt2.match;

      let result = 0;
      let different = false;
      if ((m1[1] || 'http') != (m2[1] || 'http')) {
        result += 20;
        different = different || options.scheme;
      }
      if (m1[2] != m2[2]) {
        result += 50;
        different = different || options.host;
      }
      if (m1[3] != m2[3]) {
        result += 40;
        different = different || options.path;
      }
      if (m1[4] != m2[4]) {
        result += 30;
        different = different || options.params;
      }
      if (m1[5] != m2[5]) {
        result += 10;
        different = different || options.hash;
      }
      return {
        different,
        value: result
      };
    }

    static compareUrls(u1, u2, schema, extraOptions) {
      if (!schema) {
        throw "No comparison schema set";
      }
      const opt1 = ApiWrapper.getUrlOptions(u1, schema);
      const opt2 = ApiWrapper.getUrlOptions(u2, schema);
      return ApiWrapper.compareUrlOptions(opt1, opt2, extraOptions);
    }

    static cleanUrl(url) {
      if (!url)
        return url;
      const uri = new URL(url);
      uri.search = uri.search
        .replace(/utm_[^&]+&?/g, '')
        .replace(/(wkey|wemail)=[^&]+&?/g, '')
        .replace(/(_hsenc|_hsmi|hsCtaTracking)=[^&]+&?/g, '')
        .replace(/(trk|trkEmail|midToken|fromEmail|ut|origin|anchorTopic|lipi)=[^&]+&?/g, '')
        .replace(/&$/, '')
        .replace(/^\?$/, '');
      uri.hash = uri.hash
        .replace(/#\.[a-z0-9]{9}$/g, '');
      return uri.toString();
    }

    static getBrowser() {
      if (ApiWrapper._browser)
        return ApiWrapper._browser;
      const browser = {
        isOpera: false,
        isChrome: false,
        isSafari: false,
        isFirefox: false,
        isIE: false
      };

      const ag = navigator.userAgent;
      if (ag.includes("Opera") || ag.includes('OPR')) {
        browser.isOpera = true;
      } else if (ag.includes("Chrome")) {
        browser.isChrome = true;
      } else if (ag.includes("Safari")) {
        browser.isSafari = true;
      } else if (ag.includes("Firefox")) {
        browser.isFirefox = true;
      } else if ((ag.includes("MSIE")) || !!document.documentMode) //IF IE > 10
      {
        browser.isIE = true;
      }
      ApiWrapper._browser = browser;
      return browser;
    }

    static getIconForUrl(url) {
      if (!url)
        return url;
      const m = regUrl.exec(url);
      return `${m[1]}://${m[2]}/favicon.ico`;
    }

    log() {
      if (this.debug && arguments.length) {
        for (let i = 0; i < arguments.length; i++) {
          if (typeof(arguments[i]) != 'undefined') {
            console.log(arguments.length == 1 ? arguments[0] : arguments);
          }
        }
      }
    }

    init() {
      const self = this;
      self.handlers = [];
      self.notifications = {};
      if (self.chr?.tabs?.onUpdated) {
        self.onUpdatedTab((tabId, changeInfo, tab) => {
          if (changeInfo?.status == 'complete') {
            self.pushUrlForTab(tabId, tab.url);
          }
        });
      }
      if (self.chr?.tabs?.onRemoved) {
        self.onRemovedTab(tabId => {
          self.clearUrlHistory(/*tabId*/);
        });
      }
      if (self.chr?.tabs?.onActivated) {
        self.onActivatedTab(data => {
          if (data.tabId)
            self.lastActivatedTabId = data.tabId;
        });
      }
      const browser = ApiWrapper.getBrowser();
      if (!browser.isFirefox && !browser.isOpera) {
        if (self.chr?.notifications?.onButtonClicked) {
          self.chr.notifications.onButtonClicked.addListener((notifId, btnIdx) => {
            const options = self.notifications[notifId];
            if (options?.buttons) {
              const btn = options.buttons[btnIdx];
              if (btn?.clicked) {
                btn.clicked();
              }
            }
          });
        }
      }
    }

    async getUrlComparisonSchema(text) {
      const self = this;
      const settings = await self.getSettings()
        const urlComparisonSchema = {};
      settings.urlComparisonSchema.split(/\s*[\r\n]+\s*/).forEach(line => {
        if (!line?.trim())
          return;
        if (/^#/.test(line))
          return;
        const m = /^([^\s]+)\s+((?:scheme|host|path|params|hash)(?:\s*,\s*(?:scheme|host|path|params|hash))*)$/i.exec(line);
        urlComparisonSchema[m[1].toLowerCase()] = {
          scheme: m[2].includes('scheme'),
          host: m[2].includes('host'),
          path: m[2].includes('path'),
          params: m[2].includes('params'),
          hash: m[2].includes('hash')
        };
      });
      return urlComparisonSchema;
    }

    getCurrentTab() {
      const self = this;
      const promise = new Promise((resolve, reject) => {
          if (!self.chr.tabs?.query) {
            reject("This platform doesn't support the querying tabs API!");
            return;
          };
          self.chr.tabs.query({
            'active': true,
            'lastFocusedWindow': true
          }, tabs => {
            let tab = tabs[0];
            if (tab) {
              resolve(tab);
            } else {
              if (self.lastActivatedTabId) {
                self.log('No active tab in lastActivatedWindow found, trying last activated tab id');
                self.chr.tabs.query({
                  'active': true
                }, tabs => {
                  tab = tabs.filter(t => t.id == self.lastActivatedTabId)[0];
                  if (tab) {
                    resolve(tab);
                  } else {
                    self.log('No active tab found with the lastActivatedTabId found');
                  }
                });
              } else {
                self.log('No active tab in lastActivatedWindow found and last activated tab id is not set');
              }
            }
          });
        });
      return promise;
    }

    getAllTabs() {
      const self = this;
      const promise = new Promise((resolve, reject) => {
          if (!self.chr.tabs?.query) {
            reject("This platform doesn't support the querying tabs API!");
            return;
          };
          self.chr.tabs.query({}, resolve);
        });
      return promise;
    }

    getBackgroundPage() {
      const self = this;
      const promise = new Promise((resolve, reject) => {
          if (!self.chr.runtime?.getBackgroundPage) {
            reject("This platform doesn't support the get background page API!");
            return;
          };
          self.chr.runtime.getBackgroundPage(resolve);
        });
      return promise;
    }

    setUrl(tabId, url) {
      const self = this;
      const promise = new Promise((resolve, reject) => {
          if (!self.chr.tabs?.update) {
            reject("This platform doesn't support the update tabs API!");
            return;
          };
          self.pushUrlForTab(tabId, url).then(() => {
            self.chr.tabs.update(tabId, {
              url
            }, resolve);
          });
        });
      return promise;
    }

    notify(options) {
      if (!options)
        return;
      if (typeof(options) == "string") {
        options = {
          message: options
        };
      }
      if (Array.isArray(options)) {
        if (!options.length)
          return;
        options = {
          items: options
        };
      }
      const self = this;
      const browser = ApiWrapper.getBrowser();
      const promise = new Promise((resolve, reject) => {
          if (!self.chr.notifications?.create) {
            reject("This platform doesn't support the create notifications API!");
            return;
          };
          const notifOpts = {
            type: "basic",
            title: (options.title || "Bookmark Surfer Daedalus"),
            message: (options.message || ''),
            iconUrl: "images/bigIcon.png"
          };
          if (!browser.isFirefox) {
            notifOpts.requireInteraction = !!options.requireInteraction;
          }
          if (options.items?.length) {
            notifOpts.type = "list";
            notifOpts.items = options.items.map(text => ({
                  title: '',
                  message: text
                }));
          }
          if (options.buttons?.length) {
            if (browser.isFirefox || browser.isOpera) {
              self.log("Notification buttons in Firefox and Opera do not work.");
            } else {
              notifOpts.buttons = options.buttons.map(btn => ({
                    title: btn.title,
                    iconUrl: btn.iconUrl
                  }));
            }
          }
          self.chr.notifications.create(null, notifOpts, notificationId => {
            if (options.buttons?.length) {
              self.notifications[notificationId] = options;
            }
            options.notificationId = notificationId;
            resolve(notificationId);
          });
        });
      return promise;
    }

    closeNotification(id) {
      if (!id)
        return;
      const self = this;
      const promise = new Promise((resolve, reject) => {
          if (!self.chr.notifications?.clear) {
            reject("This platform doesn't support the clear notifications API!");
            return;
          };
          self.chr.notifications.clear(id, resolve);
        });
      return promise;
    }

    getDataSize(key) {
      const self = this;
      const promise = new Promise((resolve, reject) => {
          if (!self.chr.storage?.local?.getBytesInUse) {
            reject("This platform doesn't support the local storage get bytes in use API!");
            return;
          };
          self.chr.storage.local.getBytesInUse(key, resolve);
        });
      return promise;
    }

    getData(key) {
      const self = this;
      const promise = new Promise((resolve, reject) => {
          if (!self.chr.storage?.local?.get) {
            reject("This platform doesn't support the local storage get data API!");
            return;
          };
          self.chr.storage.local.get(key, data => {
            data?.[key] ? resolve(data[key]) : resolve();
          });
        });
      return promise;
    }

    setData(key, value) {
      const self = this;
      const promise = new Promise((resolve, reject) => {
          if (!self.chr.storage?.local?.set) {
            reject("This platform doesn't support the local storage set data API!");
            return;
          };
          const obj = {};
          obj[key] = value;
          self.chr.storage.local.set(obj, resolve);
        });
      return promise;
    }

    removeData(key, value) {
      const self = this;
      const promise = new Promise((resolve, reject) => {
          if (!self.chr.storage?.local?.remove) {
            reject("This platform doesn't support the local storage remove data API!");
            return;
          };
          const obj = {};
          obj[key] = value;
          self.chr.storage.local.remove(key, resolve);
        });
      return promise;
    }

    expandSettings(settings = {}) {
      const data = {
        prevNextContext: typeof(settings.prevNextContext) == 'undefined' ? false : !!settings.prevNextContext,
        hideSkipButton: typeof(settings.hideSkipButton) == 'undefined' ? false : !!settings.hideSkipButton,
        manageContext: typeof(settings.manageContext) == 'undefined' ? false : !!settings.manageContext,
        readLaterContext: typeof(settings.readLaterContext) == 'undefined' ? true : !!settings.readLaterContext,
        readLaterFolderName: settings.readLaterFolderName || 'Read Later',
        readLaterPageTimeout:  + (settings.readLaterPageTimeout) || 10000,
        storeAllDeletedBookmarks: typeof(settings.storeAllDeletedBookmarks) == 'undefined' ? true : !!settings.storeAllDeletedBookmarks,
        daysAutoClearDeleted:  + (settings.daysAutoClearDeleted) || 0,
        enableBookmarkPage: typeof(settings.enableBookmarkPage) == 'undefined' ? false : !!settings.enableBookmarkPage,
        confirmBookmarkPage: typeof(settings.confirmBookmarkPage) == 'undefined' ? true : !!settings.confirmBookmarkPage,
        preloadNext: typeof(settings.preloadNext) == 'undefined' ? true : !!settings.preloadNext,
        showCurrentIndex: typeof(settings.showCurrentIndex) == 'undefined' ? true : !!settings.showCurrentIndex,
        showDuplicateNotifications: typeof(settings.showDuplicateNotifications) == 'undefined' ? true : !!settings.showDuplicateNotifications,
        skipPageNotBookmarkedOnNavigate: typeof(settings.skipPageNotBookmarkedOnNavigate) == 'undefined' ? false : !!settings.skipPageNotBookmarkedOnNavigate,
        urlComparisonSchema: ApiWrapper.isValidUrlComparisonSchema(settings.urlComparisonSchema) ?
        settings.urlComparisonSchema :
`${ApiWrapper.urlComparisonDefault} host, path\r\n#examples:\r\n#www.somedomain.com scheme, host, path, params, hash\r\n#/documents path, hash`,
        showBlogInvitation: typeof(settings.showBlogInvitation) == 'undefined' ? true : !!settings.showBlogInvitation,
        lastShownBlogInvitation: settings.lastShownBlogInvitation,
        cleanUrls: typeof(settings.cleanUrls) == 'undefined' ? true : !!settings.cleanUrls
      };
      return data;
    }

    async getSettings() {
      const self = this;
      let data = await self.getData(self.settingsKey)
        data = self.expandSettings(data);
      if (JSON.stringify(data) != JSON.stringify(ApiWrapper._prevSettings)) {
        ApiWrapper.refreshCache();
        ApiWrapper._prevSettings = data;
      }
      return data;
    }

    async setSettings(settings) {
      const self = this;
      ApiWrapper.refreshCache();
      const data = self.expandSettings(settings);
      await self.setData(self.settingsKey, data);
      return data;
    }

    setIcon(tabId, icon) {
      const self = this;
      const promise = new Promise((resolve, reject) => {
          const action = self.chr.browserAction || self.chr.pageAction || self.chr.action;
          if (!action?.setIcon) {
            reject("This platform doesn't support the set icon API!");
            return;
          };
          action.setIcon({
            path: {
              '19': icon
            },
            tabId
          }, function () {
            self.log(self.getError());
            return resolve.apply(this, arguments)
          });
        });
      return promise;
    }

    toggleIcon(tabId, value) {
      const self = this;
      const action = self.chr.browserAction || self.chr.pageAction || self.chr.action;
      if (action) {
        const f = value
           ? action.show || action.enable
           : action.hide || action.disable;
        f(tabId);
        self.log(self.getError());
      }
    }

    setBadge(tabId, text, color) {
      const self = this;
      color = color || 'black';
      const action = self.chr.browserAction;
      if (action) {
        const id =  + (tabId);
        if (id) {
          if (!action.setBadgeText) {
            throw new Error("This platform doesn't support the set badge text API!");
          };
          action.setBadgeText({
            text: `${text || ''}`,
            tabId: id
          });
          if (!action.setBadgeBackgroundColor) {
            throw new Error("This platform doesn't support the set badge background color API!");
          };
          action.setBadgeBackgroundColor({
            color,
            tabId: id
          });
        }
      } else {
        console.warn("This platform doesn't support browserAction");
      }
    }

    setTitle(tabId, text) {
      const self = this;
      const action = self.chr.browserAction || self.chr.pageAction || self.chr.action;
      if (!action?.setTitle) {
        throw new Error("This platform doesn't support the set title API!");
      };
      const id =  + (tabId);
      if (id) {
        action.setTitle({
          title: `${text || ''}`,
          tabId: id
        });
      }
    }

    getExtensionUrl(file) {
      const getURL = this.chr.extension?.getURL || this.chr.runtime?.getURL;
      if (!getURL) {
        console.warn("This platform doesn't support the get extension URL API!");
        return;
      };
      return getURL(file);
    }

    getOptionsUrl() {
      if (!this.chr.runtime?.id) {
        console.warn("This platform doesn't support the runtime id API!");
        return;
      };
      return `chrome://extensions/?options=${this.chr.runtime.id}`;
    }

    getTabById(tabId) {
      const self = this;
      const promise = new Promise((resolve, reject) => {
          if (!self.chr.tabs?.get) {
            reject("This platform doesn't support the get tabs API!");
            return;
          };
          self.chr.tabs.get(tabId, tab => {
            tab ? resolve(tab) : self.log(`Error getting tab ${tabId}: ${self.getError()}`);
          });
        });
      return promise;
    }

    getTabsByUrl(url) {
      const self = this;
      const promise = new Promise((resolve, reject) => {
          if (!self.chr.tabs?.query) {
            reject("This platform doesn't support the query tabs API!");
            return;
          };
          const browser = ApiWrapper.getBrowser();
          if (browser.isFirefox) {
            url = url.replace(/^moz-extension/, '*');
          }
          if (browser.isOpera) {
            url = url.replace(/^opera/, '*');
          }
          self.chr.tabs.query({
            url: `${url}*`
          }, resolve);
        });
      return promise;
    }

    newTab(url, notActive) {
      const self = this;
      const promise = new Promise((resolve, reject) => {
          if (!self.chr.tabs?.create) {
            reject("This platform doesn't support the create tabs API!");
            return;
          };
          self.chr.tabs.create({
            url,
            active: !notActive
          }, resolve);
        });
      return promise;
    }

    closeTab(tabId) {
      const self = this;
      const promise = new Promise((resolve, reject) => {
          if (!self.chr.tabs?.remove) {
            reject("This platform doesn't support the remove tabs API!");
            return;
          };
          self.chr.tabs.remove(tabId, function () {
            self.log(self.getError());
            return resolve.apply(this, arguments)
          });
        });
      return promise;
    }

    setSelected(tabId) {
      const self = this;
      const promise = new Promise((resolve, reject) => {
          if (!self.chr.tabs?.update) {
            reject("This platform doesn't support the update tabs API!");
            return;
          };
          self.chr.tabs.update(tabId, {
            active: true
          }, resolve);
        });
      return promise;
    }

    async selectOrNew(url) {
      const self = this;
      const tabs = await self.getTabsByUrl(url);
      if (!tabs?.[0]) {
        return await self.newTab(url);
      } else {
        return await self.setSelected(tabs[0].id);
      }
    }

    getTree() {
      const self = this;
      const promise = new Promise((resolve, reject) => {
          if (!self.chr.bookmarks) {
            reject("This platform doesn't support the bookmarks API!");
            return;
          }
          self.chr.bookmarks.getTree(resolve);
        });
      return promise;
    }

    async getBookmarksBar() {
      const self = this;
      const tree = await self.getTree();
      if (!tree?.[0]?.children?.length) {
        self.log('Error reading bookmarks!');
        return;
      }
      const bar = tree[0].children.filter(itm => itm.id == 'toolbar_____' || itm.id == '1')[0];
      if (!bar) {
        self.log('Couldn not find bookmars toolbar!');
        return;
      }
      return bar;
    }

    async getBookmarksByIds(ids, tree) {
      const self = this;
      if (!tree) {
        tree = await self.getTree()
      }

      function walk(tree, result) {
        const arr = tree.children || tree;
        if (!Array.isArray(arr))
          return;
        arr.forEach(itm => {
          if (itm.children) {
            walk(itm, result);
          }
          if (ids.includes(itm.id)) {
            result.push(itm);
          }
        });
      };
      const result = [];
      walk(tree, result);
      return result;
    }

    async getBookmarksByUrl(url, extraOptions, tree) {
      const self = this;
      if (!tree) {
        tree = await self.getTree();
      }
      const schema = await self.getUrlComparisonSchema();
      const result = [];

      function walk(tree) {
        const arr = tree.children || tree;
        if (!Array.isArray(arr))
          return;
        arr.forEach(itm => {
          if (itm.children) {
            walk(itm);
          }
          if (!ApiWrapper.compareUrls(url, itm.url, schema, extraOptions).different) {
            result.push(itm);
          }
        });
      }
      walk(tree);
      return result;
    }

    async getBookmarksByTitle(title, tree) {
      const self = this;
      if (!tree) {
        tree = await self.getTree();
      }

      function walk(tree, result) {
        const arr = tree.children || tree;
        if (!Array.isArray(arr))
          return;
        arr.forEach(itm => {
          if (itm.children) {
            walk(itm, result);
          }
          if (itm.title == title) {
            result.push(itm);
          }
        });
      };
      const result = [];
      walk(tree, result);
      return result;
    }

    removeBookmarksById(ids) {
      const self = this;
      if (!self.chr.bookmarks?.remove) {
        reject("This platform doesn't support the remove bookmarks API!");
        return;
      };
      const promise = new Promise((resolve, reject) => {
          self.getBookmarksByIds(ids).then(bms => {
            let k = bms.length;
            bms.forEach(bm => {
              self.chr.bookmarks.remove(bm.id, () => {
                k--;
                if (k == 0)
                  resolve(bms);
              });
            });
          });
        });

      return promise;
    }

    createBookmarks(bms) {
      const withArray = Array.isArray(bms);
      if (!withArray) {
        bms = [bms];
      }
      const browser = ApiWrapper.getBrowser();
      if (browser.isFirefox) {
        bms.reverse();
      }
      const self = this;
      const promise = new Promise((resolve, reject) => {
          if (!self.chr.bookmarks?.create) {
            reject("This platform doesn't support the create bookmarks API!");
            return;
          };
          const nodes = [];
          let k = bms.length;
          bms.forEach(bm => {
            self.chr.bookmarks.create({
              parentId: bm.parentId,
              index: bm.index,
              title: bm.title,
              url: bm.url
            }, node => {
              nodes.push(node);
              k--;
              if (k == 0)
                resolve(withArray ? nodes : nodes[0]);
            });
          });
        });
      return promise;
    }

    updateBookmark(id, changes) {
      const self = this;
      const promise = new Promise((resolve, reject) => {
          if (!self.chr.bookmarks?.update) {
            reject("This platform doesn't support the update bookmarks API!");
            return;
          };
          self.chr.bookmarks.update(id, changes, resolve);
        });
      return promise;
    }

    async ensureCleanDeletedBookmarks(arr) {
      const self = this;
      if (!arr?.bookmarks) {
        return;
      }
      const settings = await self.getSettings();
      if (!settings.daysAutoClearDeleted) {
        return;
      }
      const now = new Date();
      const newbms = arr.bookmarks.filter(obj => {
          const time = obj.time || new Date('2016-06-26').getTime();
          return (now - time) <= 86400000 * settings.daysAutoClearDeleted;
        });
      if (newbms.length == arr.bookmarks.length) {
        return;
      }
      arr.bookmarks = newbms;
      return await self.setData(self.deletedBookmarksKey, arr);
    }

    async getDeletedBookmarksSize() {
      const self = this;
      return await self.getDataSize(self.deletedBookmarksKey);
    }

    async getDeletedBookmarks() {
      const self = this;
      const arr = await self.getData(self.deletedBookmarksKey);
      if (!arr?.bookmarks?.length) {
        return null;
      } else {
        await self.ensureCleanDeletedBookmarks(arr);
        return arr.bookmarks;
      }
    }

    async addDeletedBookmarks(bookmarks) {
      const self = this;
      let arr = await self.getData(self.deletedBookmarksKey);
      if (!arr?.bookmarks?.length)
        arr = {
          bookmarks: []
        };
      arr.bookmarks.push({
        time: new Date().getTime(),
        items: bookmarks
      });
      return await self.setData(self.deletedBookmarksKey, arr);
    }

    async removeDeletedBookmarksByIds(ids) {
      const self = this;
      const arr = await self.getData(self.deletedBookmarksKey);
      if (!arr?.bookmarks?.length) {
        return null;
      }
      arr.bookmarks.forEach(obj => {
        let i = 0;
        while (i < obj.bookmarks?.length || 0) {
          if (ids.includes(obj.bookmarks[i].id)) {
            obj.bookmarks.splice(i, 1);
          } else {
            i++;
          }
        }
      });
      arr.bookmarks = arr.bookmarks.filter(obj => !!obj.bookmarks?.length);
      return await self.setData(self.deletedBookmarksKey, arr);
    }

    async removeAllDeletedBookmarks() {
      const self = this;
      const arr = {
        bookmarks : []
      };
      return await self.setData(self.deletedBookmarksKey, arr);
    }

    createMenuItem(id, title, parentId) {
      let contexts = ["all"];
      if (typeof(id) == 'object') {
        const options = id;
        id = options.id;
        title = options.title;
        parentId = options.parentId;
        contexts = options.contexts || contexts;
      }
      const self = this;
      const promise = new Promise((resolve, reject) => {
          if (!self.chr.contextMenus?.create) {
            reject("This platform doesn't support the create context menu API!");
            return;
          };
          const itm = {
            "id": id,
            "title": title,
            "contexts": contexts
          };
          if (parentId)
            itm.parentId = parentId;
          self.chr.contextMenus.create(itm, () => {
            self.log(self.getError());
            resolve(itm);
          });
        });
      return promise;
    }

    removeMenuItem(id) {
      const self = this;
      const promise = new Promise((resolve, reject) => {
          if (!self.chr.contextMenus?.remove) {
            reject("This platform doesn't support the remove context menu API!");
            return;
          };
          self.chr.contextMenus.remove(id, function () {
            self.log(self.getError());
            resolve(arguments);
          });
        });
      return promise;
    }

    sendMessage(data) {
      const self = this;
      const promise = new Promise((resolve, reject) => {
          if (!self.chr.runtime?.sendMessage) {
            reject("This platform doesn't support the runtime sendMessage API!");
            return;
          };
          const d = data || {};
          let time = 0;
          if (self.sendMessageInterval) {
            clearInterval(self.sendMessageInterval);
          }
          const f = () => {
            self.chr.runtime.sendMessage(null, d, null, function (val) {
              self.log(self.getError());
              if (val === undefined)
                return;
              setTimeout(() => {
                clearInterval(self.sendMessageInterval);
              }, 50);
              resolve.apply(this, arguments);
            });
            time += 100;
            if (time >= self.sendMessageTimeout) {
              if (self.sendMessageInterval) {
                clearInterval(self.sendMessageInterval);
              }
              resolve();
            }
          };
          f();
          if (!data?.sendOnce) {
            self.sendMessageInterval = setInterval(f, 100);
          }
        });
      return promise;
    }

    sendTabMessage(tabId, data) {
      const self = this;
      const promise = new Promise((resolve, reject) => {
          if (!self.chr.tabs?.sendMessage) {
            reject("This platform doesn't support the tabs sendMessage API!");
            return;
          };
          const d = data || {};
          let time = 0;
          if (self.sendMessageInterval) {
            clearInterval(self.sendMessageInterval);
          }
          const f = () => {
            self.chr.tabs.sendMessage(tabId, d, null, function (val) {
              self.log(self.getError());
              if (val === undefined)
                return;
              setTimeout(() => {
                clearInterval(self.sendMessageInterval);
              }, 50);
              resolve.apply(this, arguments);
            });
            time += 100;
            if (time >= self.sendMessageTimeout) {
              if (self.sendMessageInterval) {
                clearInterval(self.sendMessageInterval);
              }
              resolve();
            }
          };
          if (data?.sendOnce) {
            f();
          } else {
            self.sendMessageInterval = setInterval(f, 100);
          }
        });
      return promise;
    }

    async pushUrlForTab(tabId, url) {
      const self = this;
      let history = await self.getData(self.urlHistoryKey);
      history = history || {};
      let list = history[tabId];
      if (!list) {
        list = [];
        history[tabId] = list;
      }
      list.push(url);
      await self.setData(self.urlHistoryKey, history);
      return url;
    }

    async getListOfUrls(tabId) {
      const self = this;
      let history = await self.getData(self.urlHistoryKey);
      history = history || {};
      const list = history[tabId];
      if (!list)
        self.log(`No history for tab ${tabId}`);
      return list;
    }

    async clearUrlHistory(tabId) {
      const self = this;
      let history = await self.getData(self.urlHistoryKey);
      history = history || {};
      if (tabId) {
        const exists = !!history[tabId];
        delete history[tabId];
        await self.setData(self.urlHistoryKey, history);
        return exists;
      } else {
        const tabs = await self.getAllTabs();
        const hids = Object.keys(history);
        const tids = tabs.map(tab => `${tab.id}`);
        hids.forEach(id => {
          if (!tids.includes(id)) {
            delete history[id];
          }
        });
        await self.setData(self.urlHistoryKey, history);
        return true;
      }
    }

    async getLastTabBookmarkedUrl(tabId) {
      const self = this;
      const list = await self.getListOfUrls(tabId);
      let i = list.length;
      const f = async() => {
        i--;
        if (i < 0) {
          self.log(`No bookmarked tab in the history of tab ${tabId}`);
          return;
        }
        const url = list[i];
        const bms = await self.getBookmarksByUrl(url);
        if (!bms?.length) {
          return f();
        }
        return url;
      };
      return f();
    }

    onUpdatedTab(listener) {
      if (!this.chr.tabs?.onUpdated)
        return;
      const eh = new EventHandler(this.chr.tabs.onUpdated, listener);
      this.handlers.push(eh);
      return eh;
    }

    onCreatedTab(listener) {
      if (!this.chr.tabs?.onCreated)
        return;
      const eh = new EventHandler(this.chr.tabs.onCreated, listener);
      this.handlers.push(eh);
      return eh;
    }

    onRemovedTab(listener) {
      if (!this.chr.tabs?.onRemoved)
        return;
      const eh = new EventHandler(this.chr.tabs.onRemoved, listener);
      this.handlers.push(eh);
      return eh;
    }

    onActivatedTab(listener) {
      if (!this.chr.tabs?.onActivated)
        return;
      const eh = new EventHandler(this.chr.tabs.onActivated, listener);
      this.handlers.push(eh);
      return eh;
    }

    onCreatedBookmark(listener) {
      if (!this.chr.bookmarks?.onCreated)
        return;
      const eh = new EventHandler(this.chr.bookmarks.onCreated, listener);
      this.handlers.push(eh);
      return eh;
    }

    onRemovedBookmark(listener) {
      if (!this.chr.bookmarks?.onRemoved)
        return;
      const eh = new EventHandler(this.chr.bookmarks.onRemoved, listener);
      this.handlers.push(eh);
      return eh;
    }

    onChangedBookmark(listener) {
      if (!this.chr.bookmarks?.onChanged)
        return;
      const eh = new EventHandler(this.chr.bookmarks.onChanged, listener);
      this.handlers.push(eh);
      return eh;
    }

    onMovedBookmark(listener) {
      if (!this.chr.bookmarks?.onMoved)
        return;
      const eh = new EventHandler(this.chr.bookmarks.onMoved, listener);
      this.handlers.push(eh);
      return eh;
    }

    onChildrenReorderedBookmark(listener) {
      if (!this.chr.bookmarks?.onChildrenReordered)
        return;
      const eh = new EventHandler(this.chr.bookmarks.onChildrenReordered, listener);
      this.handlers.push(eh);
      return eh;
    }

    onImportEndedBookmark(listener) {
      if (!this.chr.bookmarks?.onImportEnded)
        return;
      const eh = new EventHandler(this.chr.bookmarks.onImportEnded, listener);
      this.handlers.push(eh);
      return eh;
    }

    onCommand(listener) {
      const self = this;
      if (!self.chr.commands?.onCommand)
        return;
      const handler = new EventHandler();
      handler.commandListener = command => {
        listener(command);
      };
      self.chr.commands.onCommand.addListener(handler.commandListener);
      handler.contextMenuListener = (info, tab) => {
        listener(info.menuItemId, info);
      }
      self.chr.contextMenus.onClicked.addListener(handler.contextMenuListener);
      handler.remove = function () {
        if (this.disposed)
          return;
        self.chr.commands.onCommand.removeListener(handler.commandListener);
        self.chr.contextMenus.onClicked.removeListener(handler.contextMenuListener);
        this.disposed = true;
      }
      self.handlers.push(handler);
      return handler;
    }

    onMessage(listener) {
      if (!this.chr.runtime?.onMessage)
        return;
      const eh = new EventHandler(this.chr.runtime.onMessage, (request, sender, sendResponse) => {
          const result = listener(request);
          if (typeof(sendResponse) == 'function') {
            if (result?.then) {
              result.then(result => sendResponse({
                  result
                }));
            } else {
              sendResponse({
                result
              });
            }
          }
          return true;
        });
      this.handlers.push(eh);
      return eh;
    }

    getWebStoreUrl() {
      return `https://chrome.google.com/webstore/detail/${this.chr.runtime.id}`;
    }

    dispose() {
      if (!this.handlers)
        return;
      this.handlers.forEach(eh => {
        eh.remove();
      });
      this.handlers = null;
    }

    getError() {
      if (this.chr?.runtime)
        return this.chr.runtime.lastError;
    }

    openOptions() {
      return new Promise((resolve, reject) => {
        chrome.runtime.openOptionsPage(resolve);
      });
    }
  }
  ApiWrapper.urlComparisonDefault = '<default>';
  ApiWrapper._comparisonOptions = {};

  global.ApiWrapper = ApiWrapper;
})();
