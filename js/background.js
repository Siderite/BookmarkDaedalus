(function () {

  const global = this;
  const context = global.testContext || global;
  if (global.importScripts) {
    importScripts('apiWrapper.js');
    importScripts('bookmarkExplorer.js');
  }

  global.api = new ApiWrapper(global.chrome);
  global.app = new BookmarkExplorer(api);

})();