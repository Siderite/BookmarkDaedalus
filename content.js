(function() {
    const global = this;
    const context = global.testContext || global;
    

    global.api = new ApiWrapper(global.chrome);

    api.onMessage(data=>{
      switch (data?.action || data) {
        case 'preload':
            const preloadFrameId = 'ifrPreload';
            const preloadLinkId = 'lnkPreload';
            const url = data.url;
            let fr = document.getElementById(preloadFrameId);
            if (!fr) {
                fr = document.createElement('iframe');
                fr.id = preloadFrameId;
                fr.style.display = 'none';
                fr.setAttribute('sandbox', 'allow-same-origin'); //allow-scripts
                document.body.appendChild(fr);
            }
            fr.setAttribute('src', url);
            let frl = document.getElementById(preloadLinkId);
            if (!frl) {
                frl = document.createElement('link');
                frl.id = preloadLinkId;
                frl.setAttribute('rel', 'prefetch');
                frl.setAttribute('as', 'document');
                document.body.appendChild(frl);
            }
            frl.setAttribute('href', url);
          break;
        case 'confirm':
            return new Promise((resolve)=>resolve(confirm(data.message)));
          break;
      }
    });

})();